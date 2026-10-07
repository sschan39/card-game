// Read-only diagnostics against compiled production modules. Run npm run build first.
// These record known gaps; they are not passing conformance tests.
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
const load = (name) => require(path.join(root, 'dist', name));
const { createRoom, joinRoom } = load('engine/room-factory');
const { instantiateCard } = load('library/card-factory');
const { gameReducer } = load('engine/game-reducer');
const { GameEngine } = load('engine/game-engine');
const { StateMachine } = load('engine/state-machine');
const { EventBus } = load('engine/event-bus');
const { ManaPool } = load('engine/mana-pool');
const { parseManaCost } = load('library/card-parser');
const { checkStateBasedActions } = load('engine/state-based-actions');
const { CardCharacteristicService } = load('engine/card-characteristic-service');
const { EffectRegistry } = load('engine/effect-registry');
const { registerAction } = load('engine/action-registry');
const { playCardHandler } = load('engine/handlers/play-card-handler');
const { io } = require('socket.io-client');
const results = [];
const record = (id, evidence) => results.push({ id, ...evidence });
function room() {
  const r = createRoom('audit', 'p1');
  joinRoom(r, 'p2');
  Object.assign(r, { status: 'playing', priorityPlayerId: 'p1', activeTurnPlayerId: 'p1' });
  r.players.p1.mana.red = 5;
  r.players.p2.mana.red = 5;
  return r;
}
function creature(power, owner = 'p1') {
  const c = instantiateCard('empire-servant');
  c.blueprint = { ...c.blueprint, power, toughness: 5 };
  Object.assign(c.state, { zone: 'battlefield', ownerId: owner, controllerId: owner, summoningSickness: false });
  return c;
}
const fold = (r, mutations) => mutations.reduce(gameReducer, r);
const damage = (r) => fold(r, new StateMachine(r, new EventBus(r.roomId)).transition(r, 'combatDamageStep'));

function engineProbes() {
  {
    const r = room();
    r.phase = 'declareBlockersStep';
    const a = creature(2), b = creature(3);
    r.battlefield = [a, b];
    r.combat = [a, b].map((c) => ({ uuid: c.uuid, attacker: c, attackerPower: c.blueprint.power, blockers: [] }));
    const life = damage(r).players.p2.life;
    assert.equal(life, 17);
    record('combat-total', { expectedLife: 15, actualLife: life });
  }
  {
    const r = room();
    r.phase = 'declareBlockersStep';
    const a = creature(1);
    r.battlefield = [a];
    r.combat = [{ uuid: a.uuid, attacker: a, attackerPower: 1, blockers: [] }];
    r.continuousEffectPool.push({ source: 'emblem', layer: 7, effect: { type: 'STAT_DELTA', power: 3 }, scope: { cardUuid: a.uuid }, duration: 'END_OF_TURN' });
    const effectivePower = CardCharacteristicService.resolvePower(r, a);
    const life = damage(r).players.p2.life;
    assert.equal(effectivePower, 4);
    assert.equal(life, 19);
    record('combat-current-power', { effectivePower, expectedLife: 16, actualLife: life });
  }
  {
    const r = room();
    r.players.p2.life = 0;
    const first = checkStateBasedActions(r);
    const ended = fold(r, first);
    const again = checkStateBasedActions(ended);
    assert.equal(ended.status, 'gameOver');
    assert.deepEqual(again, [{ type: 'SET_STATUS', status: 'gameOver' }]);
    record('terminal-sba', { statusAfterFirstCheck: ended.status, repeatedMutation: again[0], note: 'The GameEngine SBA while-loop repeats this forever; no hanging call is executed here.' });
  }
  {
    const r = room();
    r.players.p1.mana.red = 2;
    const cost = parseManaCost('{2}');
    const canPay = ManaPool.canPay(r.players.p1.mana, cost);
    assert.equal(canPay, false);
    record('generic-mana', { redMana: 2, parsedCost: cost, expectedCanPay: true, actualCanPay: canPay });
  }
  {
    const r = room();
    const a = creature(1);
    const spell = instantiateCard('broken-fireball');
    Object.assign(spell.state, { zone: 'graveyard', ownerId: 'p1', controllerId: 'p1' });
    r.battlefield = [a];
    r.players.p1.graveyard = [spell];
    const effect = { action: 'MODIFY_STATS', params: { power: 2 }, targets: [{ targetType: 'permanent', cardUuid: a.uuid }], tags: [] };
    const changed = fold(r, EffectRegistry.MODIFY_STATS(r, { source: spell }, effect));
    const power = CardCharacteristicService.resolvePower(changed, a);
    assert.equal(changed.continuousEffectPool.length, 1);
    assert.equal(power, 1);
    record('resolved-spell-buff', { fixture: 'Synthetic +2/+0 spell using the existing MODIFY_STATS primitive', poolEntries: 1, expectedPower: 3, actualPower: power });
  }
  {
    registerAction('cast_spell', playCardHandler);
    const r = room();
    const c = instantiateCard('empire-servant');
    Object.assign(c.state, { zone: 'hand', ownerId: 'p2', controllerId: 'p2' });
    c.blueprint = { ...c.blueprint, castRequirements: { ...c.blueprint.castRequirements, speed: 'instant' } };
    r.players.p2.hand = [c];
    const engine = new GameEngine(r);
    engine.initRoom();
    assert.equal(engine.passPriority('p1').success, true);
    assert.equal(engine.proposeAndStack('p2', 'cast_spell', { cardUuid: c.uuid }).success, true);
    const rememberedPass = engine.roomState.lastPassedPlayerId;
    assert.equal(engine.roomState.stack.length, 1);
    assert.equal(engine.passPriority('p2').success, true);
    assert.equal(engine.roomState.stack.length, 0);
    record('pass-reset', { rememberedPassAfterNewSpell: rememberedPass, expectedStackAfterCasterPass: 1, actualStackAfterCasterPass: 0, note: 'p1 never received a response window for the new spell.' });
    engine.dispose();
  }
  {
    const counts = [];
    for (const initialized of [false, true]) {
      const r = room();
      const a = creature(1);
      a.blueprint = { ...a.blueprint, abilities: [{ type: 'triggered', triggerCondition: 'ON_ATTACK', castSpeed: 'instant', effect: { action: 'DRAW', params: { amount: 1 }, tags: [], targeting: { type: 'self', required: false } } }] };
      r.battlefield = [a];
      const engine = new GameEngine(r);
      if (initialized) engine.initRoom();
      engine.applyMutations([{ type: 'DECLARE_ATTACKERS', declarations: [{ uuid: a.uuid, attacker: a, attackerPower: 1, blockers: [] }] }]);
      counts.push(engine.roomState.stack.length);
      engine.dispose();
    }
    assert.deepEqual(counts, [0, 1]);
    record('trigger-init', { uninitializedTriggerCount: counts[0], initializedTriggerCount: counts[1], note: 'server.ts replaces the engine in joinRoom without initRoom().' });
  }
}

function waitEvent(socket, event, predicate = () => true, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { socket.off(event, listener); reject(new Error(`Timed out waiting for ${event}`)); }, timeoutMs);
    const listener = (data) => { if (!predicate(data)) return; clearTimeout(timer); socket.off(event, listener); resolve(data); };
    socket.on(event, listener);
  });
}
async function socketProbe() {
  const child = spawn(process.execPath, ['-e', "const {server}=require('./dist/server');server.on('listening',()=>console.log('AUDIT_PORT:'+server.address().port));"], { cwd: root, env: { ...process.env, PORT: '0' }, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  const clients = [];
  try {
    const port = await new Promise((resolve, reject) => {
      let output = '';
      const timer = setTimeout(() => reject(new Error('Server startup timeout')), 8000);
      child.stdout.on('data', (data) => { output += data; const match = output.match(/AUDIT_PORT:(\d+)/); if (match) { clearTimeout(timer); resolve(Number(match[1])); } });
      child.once('error', (error) => { clearTimeout(timer); reject(error); });
      child.once('exit', (code) => { clearTimeout(timer); reject(new Error(`Server exited: ${code}; ${output}`)); });
    });
    const a = io(`http://127.0.0.1:${port}`, { autoConnect: false, transports: ['websocket'], auth: { playerId: 'audit-p1' } });
    const b = io(`http://127.0.0.1:${port}`, { autoConnect: false, transports: ['websocket'], auth: { playerId: 'audit-p2' } });
    clients.push(a, b);
    const connectA = waitEvent(a, 'connect'), connectB = waitEvent(b, 'connect');
    a.connect(); b.connect();
    await Promise.all([connectA, connectB]);
    const created = waitEvent(a, 'roomCreated');
    a.emit('createRoom');
    const { roomId } = await created;
    const rps = waitEvent(a, 'roomSnapshot', (d) => d.room.status === 'RPS');
    b.emit('joinRoom', { roomId });
    const { room: rpsRoom } = await rps;
    const rock = rpsRoom.players['audit-p1'].hand.find((c) => c.blueprint.id === 'rock');
    const scissors = rpsRoom.players['audit-p2'].hand.find((c) => c.blueprint.id === 'scissors');
    const started = waitEvent(a, 'roomSnapshot', (d) => d.room.status === 'playing');
    a.emit('playerAction', { roomId, actionId: 'rpsPlay', cardUuid: rock.uuid });
    b.emit('playerAction', { roomId, actionId: 'rpsPlay', cardUuid: scissors.uuid });
    const { room: liveRoom } = await started;
    const opponent = liveRoom.players['audit-p2'];
    assert.equal(opponent.hand.length, 4);
    assert.equal(opponent.deck.length, 5);
    record('live-snapshot', { transport: 'Two Socket.IO clients against the actual dist/server.js', status: liveRoom.status, phase: liveRoom.phase, opponentHandCardsReceived: opponent.hand.length, opponentDeckCardsReceived: opponent.deck.length, note: 'Private card definitions and UUIDs are included in the received snapshot.' });
  } finally {
    clients.forEach((socket) => socket.close());
    child.kill();
  }
}

(async () => {
  engineProbes();
  await socketProbe();
  console.log(JSON.stringify({ baseline: '8d6176c', probes: results }, null, 2));
})().catch((error) => { console.error(error); process.exitCode = 1; });
