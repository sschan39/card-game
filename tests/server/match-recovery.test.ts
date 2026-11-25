import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { createHash, randomUUID } from 'node:crypto';
import { io, type Socket } from 'socket.io-client';
import type { OwnedChoiceView, PlayerActionReceipt, SnapshotMessage, ViewDelta } from '@card-game/protocol';
import { createGameApplication } from '@server/application';
import { SqliteStore } from '@server/stores/sqlite-store';
import { SyncService } from '@server/rooms/sync-service';
import { GameEngine } from '@engine/game-engine';
import { instantiateCard } from '@library/card-factory';
import { declarationPlayer } from '@rules/turn-utils';
import { createTestRoom } from '../helpers/test-room-factory';
import { MatchInputs, openStoredMatch, recordMatchCommand, recoverMatch, type StoredMatchCommand } from '@server/rooms/match-recovery';

const Database = createRequire(resolve('apps/server/package.json'))('better-sqlite3') as typeof import('better-sqlite3');

const version = { protocolVersion: 1 as const };
const developmentDeck = ['land-red', 'land-red', 'land-red', 'land-red', 'empire-servant', 'land-red', 'choice-practice'];
const setup = { startingLife: 20, openingHandSize: 3, firstPlayerDrawsOnFirstTurn: false, developmentDeck, shuffleDevelopmentDeck: false };

function receive<T>(socket: Socket, event: string, matches: (value: T) => boolean = () => true): Promise<T> {
  return new Promise((resolve, reject) => {
    const cleanup = () => { clearTimeout(timer); socket.off(event, listener); };
    const listener = (value: T) => { if (matches(value)) { cleanup(); resolve(value); } };
    const timer = setTimeout(() => { cleanup(); reject(new Error('Timed out waiting for ' + event)); }, 3000);
    socket.on(event, listener);
  });
}

describe('durable match restart', () => {
  const sockets: Socket[] = [];
  let directory: string, databasePath: string, url: string;
  let app: ReturnType<typeof createGameApplication> | undefined;

  async function start(autoPassDelayMs = 5000) {
    app = createGameApplication({
      databasePath, environment: { NODE_ENV: 'development', DELTA_LOG_PATH: '' },
      configuration: { fixturesEnabled: true, debugMode: 'flow', rooms: { autoPassDelayMs } },
      gameplay: () => ({ setup, debugMode: 'flow' }),
    });
    await app.ready;
    await new Promise<void>(resolve => app!.server.listen(0, '127.0.0.1', resolve));
    url = 'http://127.0.0.1:' + (app.server.address() as { port: number }).port;
  }

  async function stop() {
    sockets.splice(0).forEach(socket => socket.disconnect());
    if (app) await new Promise<void>(resolve => app!.io.close(() => resolve()));
    app = undefined;
  }

  async function connect(token: string, roomId?: string) {
    const socket = io(url, { transports: ['websocket'], reconnection: false, autoConnect: false, auth: { ...version, token, roomId } });
    sockets.push(socket);
    const ready = receive(socket, 'sessionReady');
    const snapshot = roomId ? receive<SnapshotMessage>(socket, 'roomSnapshot') : undefined;
    socket.connect();
    await ready;
    return { socket, snapshot: await snapshot };
  }

  async function openLobby(autoPassDelayMs?: number) {
    directory = mkdtempSync(join(tmpdir(), 'card-game-restart-'));
    databasePath = join(directory, 'game.sqlite');
    await start(autoPassDelayMs);
    const a = app!.auth.guest();
    const account = await app!.auth.register({ username: 'recovery-seat', password: 'maple tower cedar river' });
    const parent = app!.auth.sessions.issue({ kind: 'account', id: account.account!.id }, 'game', { kind: 'browser' });
    const b = app!.auth.gameTab(parent.record);
    const sibling = app!.auth.gameTab(parent.record);
    return { ...await seatLobby(a.token, b.token), a, b, sibling };
  }

  async function seatLobby(firstToken: string, secondToken: string) {
    const one = await connect(firstToken), two = await connect(secondToken);
    const created = receive<{ roomId: string }>(one.socket, 'roomCreated');
    one.socket.emit('createRoom', version);
    const { roomId } = await created;
    const joined = receive(two.socket, 'roomJoined');
    two.socket.emit('joinRoom', { ...version, roomId });
    await joined;
    return { roomId, one, two };
  }

  async function pickStarter({ roomId, one, two }: Awaited<ReturnType<typeof seatLobby>>) {
    const started = receive(one.socket, 'startGame');
    one.socket.emit('submitRps', { ...version, roomId, pick: 'rock' });
    two.socket.emit('submitRps', { ...version, roomId, pick: 'scissors' });
    await started;
  }

  async function match() {
    const lobby = await openLobby();
    await pickStarter(lobby);
    return lobby;
  }

  function packet(roomId: string, actionId: string, data: Record<string, unknown> = {}) {
    return { ...version, roomId, actionId, commandId: randomUUID(), ...data };
  }

  async function send(socket: Socket, action: ReturnType<typeof packet>): Promise<ViewDelta> {
    const delta = receive<ViewDelta>(socket, 'stateDelta', value => value.commandId === action.commandId);
    socket.emit('playerAction', action);
    return delta;
  }

  function listedChoice(delta: ViewDelta) {
    const choice = delta.changes.find(change => change.path === 'pendingChoice')?.value as OwnedChoiceView | undefined;
    if (!choice || choice.kind === 'number') throw new Error('Expected listed choice');
    return choice;
  }

  afterEach(async () => { vi.restoreAllMocks(); await stop(); if (directory) rmSync(directory, { recursive: true, force: true }); });

  it('acknowledges No attacks after auto-passed combat entry with a tapped land', async () => {
    const lobby = await openLobby(25);
    const { roomId, one, two, a } = lobby;
    await pickStarter(lobby);
    const room = () => app!.store.getRoom(roomId)!;
    while (room().phase !== 'stateMainPhase') {
      await send(room().priorityPlayerId === room().player1Id ? one.socket : two.socket, packet(roomId, 'pass_priority'));
    }
    const land = room().players[room().player1Id].hand.find(card => card.blueprint.id === 'land-red')!;
    await send(one.socket, packet(roomId, 'play_land', { cardUuid: land.uuid, zoneRevision: land.state.zoneRevision ?? 0 }));
    await send(one.socket, packet(roomId, 'tapForMana', { cardUuid: land.uuid }));
    one.socket.emit('setAutoPass', { ...version, roomId, enabled: true });
    two.socket.emit('setAutoPass', { ...version, roomId, enabled: true });
    await send(one.socket, packet(roomId, 'enter_battle'));
    await vi.waitFor(() => expect(room().phase).toBe('declareAttackersStep'));
    expect(room().priorityPlayerId).toBeNull();
    expect(room().battlefield[0].state.isTapped).toBe(true);

    const command = packet(roomId, 'declare_attackers', { attackers: [] });
    const committed = receive<ViewDelta>(two.socket, 'stateDelta', value => value.commandId === command.commandId);
    const reachedEnd = (delta: ViewDelta) => delta.changes.some(change => change.path === 'phase' && change.value === 'endCombatStep');
    const reachedBoth = Promise.all([receive(one.socket, 'stateDelta', reachedEnd), receive(two.socket, 'stateDelta', reachedEnd)]);
    const receipt: PlayerActionReceipt = await one.socket.timeout(2000).emitWithAck('playerAction', command);
    expect(receipt).toEqual({ accepted: true });
    expect((await committed).changes).toContainEqual(expect.objectContaining({
      path: 'combatDeclarations', value: { attackers: true, blockers: false },
    }));
    await reachedBoth;

    const offline = receive<{ connected: boolean }>(two.socket, 'opponentPresence', value => !value.connected);
    one.socket.disconnect();
    expect(await offline).toMatchObject({ connected: false });
    const online = receive<{ connected: boolean }>(two.socket, 'opponentPresence', value => value.connected);
    expect((await connect(a.token, roomId)).snapshot).toMatchObject({ opponentConnected: true, room: { roomId } });
    expect(await online).toMatchObject({ connected: true });
  });

  it('restores priority, a private choice and an open stack and reconnects both seats through the match outcome', async () => {
    const { roomId, a, b, sibling, one } = await match();
    const room = () => app!.store.getRoom(roomId)!;
    const first = room().player1Id, second = room().player2Id!;
    const initial = JSON.stringify(room());
    await stop();
    await start();
    expect(JSON.stringify(room())).toBe(initial);
    let left = await connect(a.token, roomId), right = await connect(b.token, roomId);
    expect(left.snapshot).toMatchObject({ seq: 0, room: { viewerId: first, priorityPlayerId: first } });
    expect(right.snapshot!.room.players[first].hand).toEqual([]);
    expect(right.snapshot!.room.viewerId).toBe(second);
    const otherTab = await fetch(url + '/api/rooms/' + roomId + '/resume', { headers: { Authorization: 'Bearer ' + sibling.token } });
    expect(otherTab.status).toBe(404);
    expect(one.socket.connected).toBe(false);
    let seq = 0;
    for (let index = 0; room().phase !== 'stateMainPhase' && index < 12; index++) {
      const actor = room().priorityPlayerId === first ? left : right;
      const delta = await send(actor.socket, packet(roomId, 'pass_priority'));
      expect(delta.seq).toBe(++seq);
    }
    expect(room().phase).toBe('stateMainPhase');

    const land = room().players[first].hand.find(card => card.blueprint.id === 'land-red')!;
    await send(left.socket, packet(roomId, 'play_land', { cardUuid: land.uuid, zoneRevision: land.state.zoneRevision ?? 0 }));
    await send(left.socket, packet(roomId, 'tapForMana', { cardUuid: land.uuid }));
    const spell = room().players[first].hand.find(card => card.blueprint.id === 'choice-practice')!;
    await send(left.socket, packet(roomId, 'cast_spell', { cardUuid: spell.uuid }));
    const firstChoice = room().pendingChoice!;
    await send(left.socket, packet(roomId, 'choose', { choiceId: firstChoice.id, number: 2 }));
    const savedChoice = room().pendingChoice!;
    seq += 4;
    const beforeChoice = JSON.stringify(room());
    await stop();
    await start();
    expect(JSON.stringify(room())).toBe(beforeChoice);
    left = await connect(a.token, roomId);
    right = await connect(b.token, roomId);
    expect(left.snapshot!.seq).toBe(seq);
    expect(right.snapshot!.room.pendingChoice).toEqual({ kind: 'waiting', playerId: first });

    const offered = left.snapshot!.room.pendingChoice;
    if (offered?.kind !== 'options') throw new Error('Expected restored payment routes');
    expect(offered.id).toBe(savedChoice.id);
    const life = offered.options.find(value => value.label.startsWith('Pay life'))!;
    const route = await send(left.socket, packet(roomId, 'choose', { choiceId: offered.id, choices: [life.id] }));
    expect(route.seq).toBe(++seq);
    const target = listedChoice(route);
    const discard = listedChoice(await send(left.socket, packet(roomId, 'choose', { choiceId: target.id, choices: [target.options[0].id] })));
    const discardPacket = packet(roomId, 'choose', { choiceId: discard.id, choices: [discard.options[0].id] });
    const stacked = await send(left.socket, discardPacket);
    const stackUuid = room().stack[0].uuid;
    expect(room().players[first].life).toBe(18);

    await stop();
    await start();
    expect(room().stack.map(item => item.uuid)).toEqual([stackUuid]);
    left = await connect(a.token, roomId);
    right = await connect(b.token, roomId);
    expect(left.snapshot).toMatchObject({ seq: stacked.seq, room: { stack: [{ uuid: stackUuid }] } });
    const receipt = receive<SnapshotMessage>(left.socket, 'roomSnapshot');
    left.socket.emit('playerAction', discardPacket);
    expect((await receipt).seq).toBe(stacked.seq);
    expect(room().players[first].life).toBe(18);
    expect(room().stack).toHaveLength(1);

    for (let index = 0; index < 2; index++) {
      const actor = room().priorityPlayerId === first ? left : right;
      const passed = await send(actor.socket, packet(roomId, 'pass_priority'));
      expect(passed.seq).toBe(stacked.seq + index + 1);
    }
    expect(room().players[second].life).toBe(18);
    expect(room().stack).toEqual([]);
    await send(right.socket, packet(roomId, 'concede'));
    expect(room().outcome).toMatchObject({ winnerId: first });
    await stop();
    await start();
    expect(room().outcome).toMatchObject({ winnerId: first });
  });

  it('restores a periodic checkpoint and replays only the commands committed after it', async () => {
    const { roomId, a, b, one, two } = await match();
    const room = () => app!.store.getRoom(roomId)!;
    const append = vi.spyOn(SqliteStore.prototype, 'appendMatchCommand');
    const firstPacket = packet(roomId, 'pass_priority');
    await send(one.socket, firstPacket);
    for (let ordinal = 2; ordinal <= 35; ordinal++) {
      const current = room();
      const declaring = declarationPlayer(current);
      const actor = (declaring ?? current.priorityPlayerId) === current.player1Id ? one : two;
      const command = declaring
        ? current.phase === 'declareAttackersStep'
          ? packet(roomId, 'declare_attackers', { attackers: [] })
          : packet(roomId, 'declare_blockers', { assignments: [] })
        : packet(roomId, 'pass_priority');
      expect((await send(actor.socket, command)).seq).toBe(ordinal);
    }
    expect(append.mock.lastCall?.[2]).toMatchObject({ checkpointOrdinal: 32, ordinal: 35, viewSeq: 35 });
    const position = JSON.stringify(room());
    await stop();
    const tail = vi.spyOn(SqliteStore.prototype, 'matchCommands');
    await start();
    expect(tail).toHaveBeenCalledWith(roomId, 32);
    expect(tail.mock.results[0].value.map((record: StoredMatchCommand) => record.ordinal)).toEqual([33, 34, 35]);
    expect(JSON.stringify(room())).toBe(position);
    const left = await connect(a.token, roomId);
    const right = await connect(b.token, roomId);
    expect(left.snapshot?.seq).toBe(35);
    expect(right.snapshot?.seq).toBe(35);
    const duplicate = receive<SnapshotMessage>(left.socket, 'roomSnapshot');
    left.socket.emit('playerAction', firstPacket);
    expect((await duplicate).seq).toBe(35);
    const reusedId = receive<{ commandId: string; message: string }>(left.socket, 'error', value => value.commandId === firstPacket.commandId);
    left.socket.emit('playerAction', { ...firstPacket, actionId: 'concede' });
    expect((await reusedId).message).toBe('Command ID already used');
    expect(JSON.stringify(room())).toBe(position);
  });


  it('keeps a waiting lobby usable when its opening checkpoint cannot be written', async () => {
    const { roomId, a, one, two } = await openLobby();
    const invalid = receive<{ message: string }>(two.socket, 'error');
    two.socket.emit('submitRps', { ...version, roomId, pick: 'lizard' });
    expect(await invalid).toMatchObject({ message: 'Invalid opening pick' });
    const create = vi.spyOn(SqliteStore.prototype, 'createMatch')
      .mockImplementationOnce(() => { throw new Error('disk write'); });
    const error = receive<{ message: string }>(two.socket, 'error', value => value.message.includes('save the match'));
    one.socket.emit('submitRps', { ...version, roomId, pick: 'rock' });
    two.socket.emit('submitRps', { ...version, roomId, pick: 'scissors' });
    expect((await error).message).toContain('Retry your opening pick');
    const waiting = app!.store.getRoom(roomId)!;
    expect(waiting.status).toBe('waiting');
    expect(waiting.players[waiting.player1Id].hand).toEqual([]);
    expect(waiting.players[waiting.player2Id!].hand).toEqual([]);

    const started = receive(one.socket, 'startGame');
    two.socket.emit('submitRps', { ...version, roomId, pick: 'scissors' });
    await started;
    expect(create).toHaveBeenCalledTimes(2);
    const position = app!.store.getRoom(roomId)!;
    expect(position).toMatchObject({ status: 'playing', priorityPlayerId: waiting.player1Id });
    expect(position.players[position.player1Id].hand).toHaveLength(setup.openingHandSize);
    await stop();
    await start();
    const { snapshot } = await connect(a.token, roomId);
    expect(snapshot).toMatchObject({ seq: 0, room: { status: 'playing', priorityPlayerId: waiting.player1Id } });
    expect(app!.store.getRoom(roomId)).toEqual(JSON.parse(JSON.stringify(position)));
  });

  it('keeps the old position and allows a retry when a durable command write fails', async () => {
    const { roomId, one } = await match();
    const before = JSON.stringify(app!.store.getRoom(roomId));
    const write = vi.spyOn(SqliteStore.prototype, 'appendMatchCommand').mockImplementationOnce(() => { throw new Error('disk write'); });
    const pass = packet(roomId, 'pass_priority');
    const error = receive<{ commandId: string; message: string }>(one.socket, 'error', value => value.commandId === pass.commandId);
    one.socket.emit('playerAction', pass);
    expect((await error).message).toContain('Could not save');
    expect(JSON.stringify(app!.store.getRoom(roomId))).toBe(before);
    expect((await send(one.socket, pass)).seq).toBe(1);
    expect(write).toHaveBeenCalledTimes(2);
    await stop();
    await start();
    expect(app!.store.getRoom(roomId)?.priorityPlayerId).toBe(app!.store.getRoom(roomId)?.player2Id);
  });


  it('keeps a committed action recoverable when the live delta cannot be published', async () => {
    const { roomId, a, one, two } = await match();
    const publish = vi.spyOn(SyncService.prototype, 'broadcast');
    const resend = async (socket: Socket, expectedSeq: number) => {
      const snapshot = receive<SnapshotMessage>(socket, 'roomSnapshot', value => value.seq === expectedSeq);
      socket.emit('requestRoomSnapshot', { ...version, roomId });
      return snapshot;
    };

    publish.mockImplementationOnce(() => { throw new Error('delivery failed'); });
    const first = packet(roomId, 'pass_priority');
    one.socket.emit('playerAction', first);
    const recovered = await resend(one.socket, 1);
    expect(recovered.room.priorityPlayerId).toBe(recovered.room.player2Id);

    publish.mockImplementationOnce(() => { throw 'transport unavailable'; });
    two.socket.emit('playerAction', packet(roomId, 'pass_priority'));
    const second = await resend(two.socket, 2);
    expect(second.room.phase).not.toBe(recovered.room.phase);
    expect(second.room.priorityPlayerId).toBe(second.room.player1Id);
    expect(publish).toHaveBeenCalledTimes(2);

    await stop();
    await start();
    const reconnected = await connect(a.token, roomId);
    expect(reconnected.snapshot?.room.phase).toBe(second.room.phase);
    expect(reconnected.snapshot?.seq).toBe(2);
  });

  it('refuses an incomplete journal and resumes an unrelated healthy match from the same database', async () => {
    const { roomId, one, a } = await match();
    await send(one.socket, packet(roomId, 'pass_priority'));

    const healthyHost = app!.auth.guest(), healthyGuest = app!.auth.guest();
    const healthy = await seatLobby(healthyHost.token, healthyGuest.token);
    await pickStarter(healthy);
    await send(healthy.one.socket, packet(healthy.roomId, 'pass_priority'));
    const healthyPosition = app!.store.getRoom(healthy.roomId)!;
    const healthyBefore = JSON.stringify(healthyPosition);

    await stop();
    const database = new Database(databasePath);
    try {
      const removed = database.prepare('DELETE FROM match_commands WHERE room_id = ? AND ordinal = ?').run(roomId, 1);
      expect(removed.changes).toBe(1);
    } finally { database.close(); }
    await start();

    expect(app!.store.getRoom(roomId)).toBeUndefined();
    const missing = await fetch(url + '/api/rooms/' + roomId + '/resume', { headers: { Authorization: 'Bearer ' + a.token } });
    expect(missing.status).toBe(404);
    expect(JSON.stringify(app!.store.getRoom(healthy.roomId))).toBe(healthyBefore);
    const restored = await connect(healthyGuest.token, healthy.roomId);
    expect(restored.snapshot).toMatchObject({ seq: 1, room: { priorityPlayerId: healthyPosition.player2Id } });
    expect((await send(restored.socket, packet(healthy.roomId, 'pass_priority'))).seq).toBe(2);
    const owner = await connect(healthyHost.token, healthy.roomId);
    for (const seat of [owner, restored]) {
      const left = receive<{ roomId: string }>(seat.socket, 'roomLeft', value => value.roomId === healthy.roomId);
      seat.socket.emit('leaveRoom', { ...version, roomId: healthy.roomId });
      await left;
    }
    expect(app!.store.getRoom(healthy.roomId)).toBeUndefined();
    await stop();
    await start();
    expect(app!.store.getRoom(healthy.roomId)).toBeUndefined();
  });
});



it('rejects mismatched checkpoint metadata before restoring a position', () => {
  const room = createTestRoom();
  const engine = new GameEngine(room);
  engine.initRoom();
  try {
    const saved = openStoredMatch(engine);
    expect(recoverMatch(saved, []).room).toEqual(JSON.parse(saved.checkpoint).room);
    expect(() => recoverMatch({ ...saved, version: saved.version + 1 }, [])).toThrow('Unsupported match format');
    expect(() => recoverMatch({ ...saved, checkpoint: saved.checkpoint + ' ' }, [])).toThrow('Match checkpoint checksum failed');
    expect(() => recoverMatch({ ...saved, checkpointSeq: saved.viewSeq + 1 }, [])).toThrow('Invalid match checkpoint position');
    expect(() => recoverMatch({ ...saved, roomId: 'different-match' }, [])).toThrow('Invalid match checkpoint');
    expect(() => recoverMatch({ ...saved, viewSeq: saved.viewSeq + 1 }, [])).toThrow('Match journal head mismatch');
  } finally { engine.dispose(); }
});

it('upgrades checkpoints written before rules definitions were pinned', () => {
  const { matchContent: _currentContent, ...oldRoom } = createTestRoom();
  const checkpoint = JSON.stringify({ room: { ...oldRoom, setup } });
  const hash = createHash('sha256').update(checkpoint).digest('hex');
  const legacy = {
    roomId: oldRoom.roomId, version: 1, checkpoint, checkpointHash: hash,
    checkpointOrdinal: 0, checkpointSeq: 0, ordinal: 0, viewSeq: 0, stateHash: hash,
  };

  const loaded = recoverMatch(legacy, []);
  expect(loaded.room.setup).toEqual({ firstPlayerDrawsOnFirstTurn: false });
  expect(loaded.room.matchContent?.tokenBlueprints['token-angel-1-1']).toMatchObject({ power: 1, toughness: 1 });
  const engine = new GameEngine(loaded.room);
  engine.initRoom();
  try {
    const { head } = recordMatchCommand(legacy, engine, { roomId: oldRoom.roomId, actionId: 'pass_priority', data: {} },
      oldRoom.player1Id, 'first-new-command', [], [], false);
    expect(head.version).toBe(2);
    expect(head.checkpointOrdinal).toBe(head.ordinal);
    expect(recoverMatch(head, []).room).toEqual(JSON.parse(head.checkpoint).room);
  } finally {
    engine.dispose();
  }
});

it('replays a real library shuffle with recorded randomness and checks the resulting events', () => {
  const room = createTestRoom();
  const player = room.players.player1;
  const cardIn = (id: string, zone: 'hand' | 'library') => {
    const card = instantiateCard(id);
    card.state = { ...card.state, zone, ownerId: player.id, controllerId: player.id };
    return card;
  };
  const spell = cardIn('wind-call', 'hand');
  const target = cardIn('swift-spirit-envoy', 'library');
  player.hand = [spell];
  player.deck = [cardIn('land-red', 'library'), cardIn('empire-servant', 'library'), target, cardIn('fireball', 'library')];

  const inputs = new MatchInputs({ uuid: randomUUID, random: () => 0.42 });
  const engine = new GameEngine(room, inputs);
  engine.initRoom();
  let head = openStoredMatch(engine);
  const commands: StoredMatchCommand[] = [];
  const commit = (actor: string, actionId: string, data: Record<string, unknown> = {}) => {
    const commandId = randomUUID();
    const { result, inputs: recorded } = inputs.record(() =>
      engine.withCommandContext(actionId, actor, () => engine.executePlayerAction(actor, actionId, data), commandId));
    if (!result.success) throw new Error(result.reason);
    const saved = recordMatchCommand(head, engine, { roomId: room.roomId, actionId, data }, actor, commandId,
      recorded, engine.drainEventBatches(), Boolean(result.mutations?.length));
    head = saved.head;
    commands.push(saved.command);
    return recorded;
  };

  try {
    commit(player.id, 'cast_spell', { cardUuid: spell.uuid });
    for (let index = 0; index < 2; index++) commit(engine.roomState.priorityPlayerId!, 'pass_priority');
    const choice = engine.roomState.pendingChoice;
    if (!choice || choice.kind !== 'search') throw new Error('Expected a library search');
    const recorded = commit(player.id, 'choose', { choiceId: choice.id, choices: [choice.options[0].id] });
    expect(recorded).toContainEqual(['random', 0.42]);
    const recovered = recoverMatch(head, commands);
    const replayed = recovered.room.players[player.id];
    expect(replayed.hand.map(card => card.uuid)).toEqual([target.uuid]);
    expect(replayed.deck.map(card => card.uuid)).toEqual(engine.roomState.players[player.id].deck.map(card => card.uuid));
    const last = commands.at(-1)!;
    expect(() => recoverMatch(head, [{ ...commands[0], ordinal: 2 }, ...commands.slice(1)])).toThrow('Missing match command');
    const missingRandom = { ...last, entry: JSON.stringify({ ...JSON.parse(last.entry), inputs: recorded.filter(input => input[0] !== 'random') }) };
    expect(() => recoverMatch(head, [...commands.slice(0, -1), missingRandom])).toThrow('Recorded runtime input mismatch');
    const tampered = { ...last, entry: JSON.stringify({ ...JSON.parse(last.entry), eventHash: 'corrupt' }) };
    expect(() => recoverMatch(head, [...commands.slice(0, -1), tampered])).toThrow('Match command replay diverged');
    const entry = JSON.parse(last.entry);
    const wrongSeq = { ...last, entry: JSON.stringify({ ...entry, viewSeq: entry.viewSeq + 1 }) };
    expect(() => recoverMatch(head, [...commands.slice(0, -1), wrongSeq])).toThrow('Match view sequence diverged');
  } finally { engine.dispose(); }
});
