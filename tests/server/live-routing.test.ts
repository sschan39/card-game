import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { io as connect, type Socket } from 'socket.io-client';
import { GameEngine } from '../../src/engine/game-engine';
import { EventBus } from '../../src/engine/event-bus';
import { instantiateCard } from '../../src/library/card-factory';
import { applyDeltaChanges } from '../../src/client/store/deltaReducer';
import type { GameRoom } from '../../src/types/game.room.types';
import type { StateDelta } from '../../src/types/delta.types';
import type { CardInstance, TriggerEvent, TriggeredAbility } from '../../src/types/card.types';
import { creature as combatCreature } from '../helpers/combat-fixture';

// Vitest loads src/server.ts directly in this isolated worker. No dist/build,
// route mocks, injected server factory, or production fixture API is involved.
describe('actual server routing', () => {
  let live: typeof import('../../src/server');
  let url: string;
  const clients: Socket[] = [];
  const initialized: GameEngine[] = [];
  const observed = new Map<string, GameEngine>();
  const committedRpsSnapshots: { roomId: string; before: GameRoom; after: GameRoom; beforeJson: string; afterJson: string }[] = [];
  const roomTimers: ReturnType<typeof setTimeout>[] = [];
  const originalPort = process.env.PORT;
  let initSpy: ReturnType<typeof vi.spyOn>;
  let disposeSpy: ReturnType<typeof vi.spyOn>;
  let clearSpy: ReturnType<typeof vi.spyOn>;

  beforeAll(async () => {
    process.env.PORT = '0';
    const emit = EventBus.prototype.emit;
    vi.spyOn(EventBus.prototype, 'emit').mockImplementation(function (this: EventBus, event, context) {
      if (context && event.eventId === 'MUTATION_APPLIED' && event.payload.mutation &&
          (event.payload.mutation as { type: string; status?: string }).type === 'SET_STATUS' &&
          (event.payload.mutation as { status?: string }).status === 'playing') {
        committedRpsSnapshots.push({ roomId: event.roomId, before: context.before, after: context.after,
          beforeJson: JSON.stringify(context.before), afterJson: JSON.stringify(context.after) });
      }
      return emit.call(this, event, context);
    });
    const init = GameEngine.prototype.initRoom;
    initSpy = vi.spyOn(GameEngine.prototype, 'initRoom').mockImplementation(function (this: GameEngine) {
      initialized.push(this);
      observed.set(this.roomState.roomId, this);
      init.call(this);
    });
    // A call-through observation is the only fixture seam: retain the real
    // engine used by the real RPS route and edit its authoritative room data.
    const handle = GameEngine.prototype.handleAction;
    vi.spyOn(GameEngine.prototype, 'handleAction').mockImplementation(function (this: GameEngine, ...args) {
      observed.set(this.roomState.roomId, this);
      return handle.apply(this, args);
    });
    disposeSpy = vi.spyOn(GameEngine.prototype, 'dispose');
    clearSpy = vi.spyOn(globalThis, 'clearTimeout');
    const schedule = globalThis.setTimeout;
    vi.spyOn(globalThis, 'setTimeout').mockImplementation(((callback, ms, ...args) => {
      const timer = schedule(callback, ms, ...args);
      const stack = new Error().stack ?? '';
      if (ms === 30_000 && /src[\\/]server\.ts/.test(stack)) roomTimers.push(timer);
      return timer;
    }) as typeof setTimeout);
    live = await import('../../src/server');
    if (!live.server.listening) await new Promise<void>(resolve => live.server.once('listening', resolve));
    const address = live.server.address();
    if (!address || typeof address === 'string') throw new Error('Expected ephemeral TCP port');
    url = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    try {
      clients.forEach(socket => socket.disconnect());
      if (live) await new Promise<void>(resolve => live.io.close(() => resolve()));
      // Server close must own cleanup, including disconnect grace timers.
      for (const timer of roomTimers) expect(clearSpy).toHaveBeenCalledWith(timer);
      for (const engine of new Set(initialized)) {
        expect(disposeSpy.mock.contexts.filter(context => context === engine)).toHaveLength(1);
        emitEnter(engine);
        expect(engine.mutationCollector).toEqual([]);
      }
    } finally {
      // Failure-path cleanup also covers a server implementation missing cleanup.
      roomTimers.forEach(timer => clearTimeout(timer));
      new Set([...initialized, ...observed.values()]).forEach(engine => engine.dispose());
      vi.restoreAllMocks();
      if (originalPort === undefined) delete process.env.PORT;
      else process.env.PORT = originalPort;
    }
  });

  function once<T>(socket: Socket, event: string): Promise<T> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { socket.off(event, listener); reject(new Error(`Timed out waiting for ${event}`)); }, 2500);
      const listener = (value: T) => { clearTimeout(timer); resolve(value); };
      socket.once(event, listener);
    });
  }

  async function client(playerId: string, roomId?: string) {
    const socket = connect(url, { auth: { playerId, roomId }, transports: ['websocket'], autoConnect: false, reconnection: false });
    clients.push(socket);
    const view = { socket, room: undefined as GameRoom | undefined, deltas: [] as StateDelta[], errors: [] as string[] };
    socket.on('roomSnapshot', ({ room }) => { view.room = room; });
    socket.on('stateDelta', (delta: StateDelta) => {
      view.deltas.push(delta);
      if (view.room) view.room = applyDeltaChanges(view.room, delta.changes);
    });
    socket.on('error', ({ message }) => view.errors.push(message));
    const connected = once(socket, 'connect');
    socket.connect();
    await connected;
    return view;
  }

  async function match(prefix: string) {
    const a = await client(`${prefix}1`);
    const b = await client(`${prefix}2`);
    const created = once<{ roomId: string }>(a.socket, 'roomCreated');
    a.socket.emit('createRoom');
    const { roomId } = await created;
    await vi.waitFor(() => expect(a.room?.status).toBe('waiting'), { timeout: 2500 });
    const oldEngine = observed.get(roomId)!;
    oldEngine.roomState.players[`${prefix}1`].life = 17;
    b.socket.emit('joinRoom', { roomId });
    await vi.waitFor(() => {
      expect(a.room?.status).toBe('RPS');
      expect(b.room?.status).toBe('RPS');
    }, { timeout: 2500 });
    expect(a.room!.players[`${prefix}1`].life).toBe(17);
    for (const view of [a, b]) {
      const pid = view === a ? `${prefix}1` : `${prefix}2`;
      const rock = view.room!.players[pid].hand.find(card => card.blueprint.id === 'rock')!;
      view.socket.emit('playerAction', { roomId, actionId: 'rpsPlay', cardUuid: rock.uuid });
      if (view === a) await vi.waitFor(() => expect(a.room!.rpsState.playedCards[pid]).toBe('rock'), { timeout: 2500 });
    }
    await vi.waitFor(() => {
      expect(a.room?.status).toBe('playing');
      expect(b.room?.phase).toBe('upkeepStep');
    }, { timeout: 2500 });
    for (let step = 0; step < 2; step++) {
      await action({ a, b, roomId } as Match, a, 'pass_priority');
      await action({ a, b, roomId } as Match, b, 'pass_priority');
    }
    expect(b.room?.phase).toBe('stateMainPhase');
    const rpsBatch = committedRpsSnapshots.find(snapshot => snapshot.roomId === roomId)!;
    expect(rpsBatch).toBeDefined();
    expect(JSON.stringify(rpsBatch.before)).toBe(rpsBatch.beforeJson);
    expect(JSON.stringify(rpsBatch.after)).toBe(rpsBatch.afterJson);
    // Fixtures that use development shortcuts choose their mode explicitly.
    observed.get(roomId)!.roomState.debugMode = 'flow';
    expect(a.room!.activeTurnPlayerId).toBe(`${prefix}1`);
    return { a, b, roomId, oldEngine, engine: observed.get(roomId)!, p1: `${prefix}1`, p2: `${prefix}2` };
  }

  type Match = Awaited<ReturnType<typeof match>>;
  function card(ownerId: string, id = 'empire-servant'): CardInstance {
    const instance = instantiateCard(id);
    instance.blueprint = structuredClone(instance.blueprint);
    instance.blueprint = { ...instance.blueprint, castRequirements: { ...instance.blueprint.castRequirements, cost: {} } };
    instance.state.ownerId = ownerId;
    instance.state.controllerId = ownerId;
    instance.state.zone = 'hand';
    return instance;
  }

  function emitEnter(engine: GameEngine) {
    const source = card(engine.roomState.player1Id);
    source.blueprint = { ...source.blueprint, onEnterEffects: [draw] };
    const bus = (engine as unknown as { eventBus: EventBus }).eventBus;
    bus.emit({ eventId: 'PERMANENT_ENTERED', roomId: engine.roomState.roomId, payload: { card: source, controllerId: source.state.controllerId } });
  }

  const draw = { action: 'DRAW', params: { amount: 1 }, tags: [], targeting: { type: 'self' as const, required: false } };
  function prepare(m: Match, setup: (room: GameRoom) => void) {
    // Setup only data; every cast, resolve, pass, attack and block uses sockets.
    setup(m.engine.roomState);
    // Existing raw debug snapshots deliberately seed the actual client reducer.
    live.io.to(m.roomId).emit('roomSnapshot', { room: m.engine.roomState });
  }

  async function action(m: Match, view: Match['a'], actionId: string, data: Record<string, unknown> = {}) {
    const lengths = [m.a.deltas.length, m.b.deltas.length];
    const errors = view.errors.length;
    view.socket.emit('playerAction', { roomId: m.roomId, actionId, ...data });
    await vi.waitFor(() => {
      expect(view.errors.slice(errors)).toEqual([]);
      expect(m.a.deltas.length).toBeGreaterThan(lengths[0]);
      expect(m.b.deltas.length).toBeGreaterThan(lengths[1]);
    }, { timeout: 2500 });
  }

  it('joins with exactly one initialized replacement and releases the old manager', async () => {
    const m = await match('join');
    expect(m.engine).not.toBe(m.oldEngine);
    expect(initialized.filter(engine => engine === m.engine)).toHaveLength(1);
    expect(disposeSpy.mock.contexts.filter(engine => engine === m.oldEngine)).toHaveLength(1);
    emitEnter(m.oldEngine);
    expect(m.oldEngine.mutationCollector).toEqual([]);
    expect(m.a.room!.rpsState.status).toBe('resolved');
    expect(m.b.room!.players[m.p1].life).toBe(17);
  });

  it('activates Hellkite through its advertised option and resolves without moving the source', async () => {
    const m = await match('hellkite');
    const hellkite = card(m.p1, 'card_09876_core_set');
    hellkite.state.zone = 'battlefield';
    prepare(m, room => { room.battlefield = [hellkite]; room.players[m.p1].mana.red = 2; });
    const optionsEvent = once<{ options: { actionId: string; data: Record<string, unknown> }[] }>(m.a.socket, 'optionsForCard');
    m.a.socket.emit('getOptions', { roomId: m.roomId, cardUuid: hellkite.uuid, zone: 'battlefield' });
    const { options } = await optionsEvent;
    expect(options[0]).toMatchObject({ actionId: 'activate_ability', data: { abilityId: 'firebreathing' } });
    await action(m, m.a, options[0].actionId, { cardUuid: hellkite.uuid, ...options[0].data });
    expect(m.b.room!.stack[0]).toMatchObject({ type: 'activated', ability: { id: 'firebreathing' } });
    expect(m.b.room!.players[m.p1].mana.red).toBe(1);
    expect(m.b.room!.battlefield.map(c => c.uuid)).toEqual([hellkite.uuid]);
    await action(m, m.a, 'pass_priority');
    await action(m, m.b, 'pass_priority');
    expect(m.b.room!.stack).toEqual([]);
    expect(m.b.room!.battlefield.map(c => c.uuid)).toEqual([hellkite.uuid]);
    expect(m.b.room!.continuousEffectPool).toContainEqual(expect.objectContaining({ scope: { cardUuid: hellkite.uuid, zoneRevision: 0 }, effect: { type: 'STAT_DELTA', power: 1 } }));
  });

  it('fires cast ETB, attack and death triggers exactly once after join', async () => {
    const m = await match('trigger');
    const creature = card(m.p1);
    const conditions: TriggerEvent[] = ['ON_ENTER_BATTLEFIELD', 'ON_ATTACK', 'ON_DIE'];
    creature.blueprint = { ...creature.blueprint, abilities: conditions.map(triggerCondition => ({ type: 'triggered', triggerCondition, effect: draw, castSpeed: 'instant' })) };
    prepare(m, room => { room.players[m.p1].hand = [creature]; });
    await action(m, m.a, 'cast_spell', { cardUuid: creature.uuid });
    await action(m, m.a, 'resolve_stack');
    for (const view of [m.a, m.b]) {
      expect(view.room!.battlefield.map(c => c.uuid)).toEqual([creature.uuid]);
      expect(view.room!.stack).toHaveLength(1);
      expect(view.room!.stack[0].ability?.triggerCondition).toBe('ON_ENTER_BATTLEFIELD');
    }
    await action(m, m.a, 'resolve_stack');
    prepare(m, room => {
      room.phase = 'declareAttackersStep';
      room.battlefield[0].state.summoningSickness = false;
      room.priorityPlayerId = m.p1;
    });
    await action(m, m.a, 'declare_attackers', { attackers: [{ cardUuid: creature.uuid }] });
    for (const view of [m.a, m.b]) {
      expect(view.room!.combat[0].attacker.uuid).toBe(creature.uuid);
      expect(view.room!.stack).toHaveLength(1);
      expect(view.room!.stack[0].ability?.triggerCondition).toBe('ON_ATTACK');
      expect(view.room!.phase).toBe('declareAttackersStep');
      expect(view.room!.combatDeclarations?.attackers).toBe(true);
    }
    await action(m, m.a, 'resolve_stack');
    await action(m, m.a, 'pass_priority');
    await action(m, m.b, 'pass_priority');
    for (const view of [m.a, m.b]) expect(view.room!.phase).toBe('declareBlockersStep');
    const removal = card(m.p1, 'broken-fireball');
    removal.blueprint = {
      ...removal.blueprint,
      onCastEffects: [{
        action: 'DESTROY',
        params: {},
        tags: [],
        targeting: { type: 'permanent', required: true, minTargets: 1, maxTargets: 1 },
      }],
    };
    prepare(m, room => { room.phase = 'stateMainPhase'; room.priorityPlayerId = m.p1; room.players[m.p1].hand = [removal]; });
    await action(m, m.a, 'cast_spell', { cardUuid: removal.uuid, targets: [{ targetType: 'permanent', cardUuid: creature.uuid }] });
    await action(m, m.a, 'resolve_stack');
    for (const view of [m.a, m.b]) {
      expect(view.room!.battlefield).toHaveLength(0);
      expect(view.room!.players[m.p1].graveyard.some(c => c.uuid === creature.uuid)).toBe(true);
      expect(view.room!.stack).toHaveLength(1);
      expect(view.room!.stack[0].ability?.triggerCondition).toBe('ON_DIE');
    }
  });

  async function terminal(m: Match) {
    const outcome = { type: 'win', winnerId: m.p1, losses: [{ playerId: m.p2, reason: 'life_total' }] };
    const publicState = (room: GameRoom) => JSON.parse(JSON.stringify({ outcome: room.outcome, status: room.status, engineState: room.engineState, priority: room.priorityPlayerId, phase: room.phase, combat: room.combat, stack: room.stack, battlefield: room.battlefield, life: room.players[m.p2].life }));
    for (const view of [m.a, m.b]) {
      expect(view.room!.outcome).toEqual(outcome);
      expect(view.room!.status).toBe('gameOver');
      expect(view.room!.engineState).toBe('game_over');
      expect(view.room!.priorityPlayerId).toBeNull();
      const ending = view.deltas.at(-1)!;
      const finalValues = { outcome, status: 'gameOver', engineState: 'game_over', priorityPlayerId: null, lastPassedPlayerId: null };
      for (const [path, value] of Object.entries(finalValues)) {
        expect(ending.changes.filter(change => change.path === path).at(-1)?.value).toEqual(value);
      }
    }
    expect(publicState(m.a.room!)).toEqual(publicState(m.b.room!));
    const final = structuredClone(publicState(m.a.room!));
    const count = m.a.deltas.length;
    for (const actionId of ['end_turn', 'resolve_stack', 'pass_priority', 'cast_spell', 'rpsPlay', 'declare_attackers']) {
      const rejected = once<{ message: string }>(m.a.socket, 'error');
      m.a.socket.emit('playerAction', { roomId: m.roomId, actionId });
      expect(await rejected).toEqual({ message: 'Game is over' });
    }
    const options = await m.b.socket.timeout(2500).emitWithAck('getOptions', { roomId: m.roomId, cardUuid: 'missing', zone: 'hand' });
    expect(options).toEqual([]);
    expect(m.a.deltas).toHaveLength(count);
    expect(publicState(m.engine.roomState)).toEqual(final);
    m.b.socket.disconnect();
    const recovered = await client(m.p2, m.roomId);
    await vi.waitFor(() => expect(recovered.room?.outcome).toEqual(outcome), { timeout: 2500 });
    expect(publicState(recovered.room!)).toEqual(final);
    expect(initialized.filter(engine => engine === m.engine)).toHaveLength(1);
  }

  it('lethal spell converges both clients, rejects later actions and restores the terminal snapshot on reconnect', async () => {
    const m = await match('spell');
    const fireball = card(m.p1, 'broken-fireball');
    prepare(m, room => { room.players[m.p1].hand = [fireball]; room.players[m.p2].life = 1; });
    await action(m, m.a, 'cast_spell', { cardUuid: fireball.uuid, targets: [{ targetType: 'player', playerId: m.p2 }] });
    await action(m, m.a, 'pass_priority');
    await action(m, m.b, 'pass_priority');
    expect(m.a.room!.players[m.p2].life).toBeLessThanOrEqual(0);
    expect(m.a.room!.stack).toEqual([]);
    await terminal(m);
  });

  it('lethal combat converges both clients and preserves the final combat board', async () => {
    const m = await match('combat');
    const attacker = card(m.p1);
    attacker.state.zone = 'battlefield';
    prepare(m, room => { room.battlefield = [attacker]; room.phase = 'declareAttackersStep'; room.players[m.p2].life = 1; });
    await action(m, m.a, 'declare_attackers', { attackers: [{ cardUuid: attacker.uuid }] });
    await action(m, m.a, 'pass_priority'); await action(m, m.b, 'pass_priority');
    await action(m, m.b, 'declare_blockers', { assignments: [] });
    await action(m, m.a, 'pass_priority'); await action(m, m.b, 'pass_priority');
    for (const view of [m.a, m.b]) {
      expect(view.room!.players[m.p2].life).toBe(1);
      expect(view.room!.priorityPlayerId).toBeNull();
      expect(view.room!.pendingChoice?.continuation.type).toBe('combat');
    }
    const choice = m.a.room!.pendingChoice!;
    await action(m, m.a, 'choose', { choiceId: choice.id, allocations: { [choice.options[0].id]: choice.total } });
    expect(m.a.room!.players[m.p2].life).toBe(0);
    expect(m.a.room!.combat[0].attacker.uuid).toBe(attacker.uuid);
    expect(m.a.room!.battlefield[0].uuid).toBe(attacker.uuid);
    await terminal(m);
  });

  it('resumes multi-blocker allocations after reconnect and commits one damage batch to both clients', async () => {
    const m = await match('combat-choice');
    prepare(m, room => {
      room.debugMode = 'off'; room.phase = 'declareAttackersStep'; room.priorityPlayerId = null;
      room.battlefield = [combatCreature('attacker', m.p1, 5, 9), combatCreature('blocker1', m.p2, 1, 6), combatCreature('blocker2', m.p2, 2, 4)];
    });
    await action(m, m.a, 'declare_attackers', { attackers: [{ cardUuid: 'attacker' }] });
    await action(m, m.a, 'pass_priority'); await action(m, m.b, 'pass_priority');
    await action(m, m.b, 'declare_blockers', { assignments: [{ attackerUuid: 'attacker', blockerUuids: ['blocker1', 'blocker2'] }] });
    await action(m, m.a, 'pass_priority'); await action(m, m.b, 'pass_priority');
    const choice = m.a.room!.pendingChoice!;
    expect(choice.kind).toBe('distribution'); expect(choice.total).toBe(5);
    const allocation = Object.fromEntries(choice.options.map(option => [option.id, option.label === 'blocker1' ? 3 : 2]));
    await action(m, m.a, 'choose', { choiceId: choice.id, allocations: allocation });
    for (const view of [m.a, m.b]) {
      expect(view.room!.priorityPlayerId).toBeNull();
      expect(view.room!.battlefield.every(card => card.state.damageTaken === 0)).toBe(true);
      expect(view.room!.combatDamage).toEqual(m.engine.roomState.combatDamage);
      expect(view.room!.pendingChoice?.playerId).toBe(m.p2);
    }
    m.b.socket.disconnect();
    const recovered = await client(m.p2, m.roomId);
    await vi.waitFor(() => expect(recovered.room?.pendingChoice?.id).toBe(m.engine.roomState.pendingChoice?.id), { timeout: 2500 });
    const current = { ...m, b: recovered };
    for (const amount of [1, 2]) {
      const pending = recovered.room!.pendingChoice!;
      await action(current, recovered, 'choose', { choiceId: pending.id, allocations: { [pending.options[0].id]: amount } });
      if (amount === 1) expect(recovered.room!.battlefield.every(card => card.state.damageTaken === 0)).toBe(true);
    }
    for (const view of [m.a, recovered]) {
      expect(view.room!.battlefield.map(card => card.state.damageTaken)).toEqual([3, 3, 2]);
      expect(view.room!.pendingChoice).toBeNull();
      expect(view.room!.priorityPlayerId).toBe(m.p1);
      expect(view.room!.combatDamage).toEqual(m.engine.roomState.combatDamage);
      expect(view.room!.phase).toBe('combatDamageStep');
    }
  });

  it('destroying an unjoined room unregisters its manager', async () => {
    const view = await client('destroy1');
    const created = once<{ roomId: string }>(view.socket, 'roomCreated');
    view.socket.emit('createRoom');
    const { roomId } = await created;
    const engine = observed.get(roomId)!;
    view.socket.disconnect();
    await vi.waitFor(() => expect(disposeSpy.mock.contexts.filter(context => context === engine)).toHaveLength(1), { timeout: 2500 });
    emitEnter(engine);
    expect(engine.mutationCollector).toEqual([]);
    const rejoin = await client('destroy1', roomId);
    const empty = await rejoin.socket.timeout(2500).emitWithAck('getOptions', { roomId, cardUuid: 'missing', zone: 'hand' });
    expect(empty).toEqual([]);
    expect(rejoin.room).toBeUndefined();
  });

  it('rejects disabled debug controls without deltas', async () => {
    const m = await match('debug-off');
    prepare(m, room => { room.debugMode = 'off'; });
    await vi.waitFor(() => expect(m.a.room?.debugMode).toBe('off'));
    const before = structuredClone(m.engine.roomState);
    const counts = [m.a.deltas.length, m.b.deltas.length];
    for (const actionId of ['end_turn', 'resolve_stack']) {
      const error = once<{ message: string }>(m.a.socket, 'error');
      m.a.socket.emit('playerAction', { roomId: m.roomId, actionId });
      expect((await error).message).toContain('disabled');
    }
    expect(m.engine.roomState).toEqual(before);
    expect([m.a.deltas.length, m.b.deltas.length]).toEqual(counts);
  });

  it('stack mode lets either player resolve but refuses end-turn, including after reconnect', async () => {
    const m = await match('debug-stack');
    const creature = card(m.p1);
    prepare(m, room => { room.debugMode = 'stack'; room.players[m.p1].hand = [creature]; });
    await action(m, m.a, 'cast_spell', { cardUuid: creature.uuid });
    const error = once<{ message: string }>(m.b.socket, 'error');
    m.b.socket.emit('playerAction', { roomId: m.roomId, actionId: 'end_turn' });
    expect((await error).message).toContain('disabled');
    // After the cast player1 retains priority; player2 uses the debug bypass.
    expect(m.engine.roomState.priorityPlayerId).toBe(m.p1);
    await action(m, m.b, 'resolve_stack');
    for (const view of [m.a, m.b]) {
      expect(view.room!.battlefield.some(c => c.uuid === creature.uuid)).toBe(true);
      expect(view.room!.debugMode).toBe('stack');
    }
    m.b.socket.disconnect();
    const recovered = await client(m.p2, m.roomId);
    await vi.waitFor(() => expect(recovered.room?.debugMode).toBe('stack'));
    expect(recovered.room!.battlefield.map(c => c.uuid)).toEqual(m.a.room!.battlefield.map(c => c.uuid));
  });

  it('flow mode lets the nonactive player end the active turn with cleanup', async () => {
    const m = await match('debug-flow');
    const creature = card(m.p1);
    creature.state.zone = 'battlefield';
    creature.state.damageTaken = 0;
    creature.state.isTapped = true;
    prepare(m, room => { room.debugMode = 'flow'; room.battlefield = [creature]; });
    await action(m, m.b, 'end_turn');
    for (const view of [m.a, m.b]) {
      expect(view.room!.activeTurnPlayerId).toBe(m.p2);
      expect(view.room!.phase).toBe('stateMainPhase');
    }
  });

  it('keeps normal mana and combat routing available with debug off', async () => {
    const m = await match('ordinary-off');
    const land = card(m.p1, 'land-red');
    land.state.zone = 'battlefield';
    prepare(m, room => { room.debugMode = 'off'; room.battlefield = [land]; });
    await action(m, m.a, 'tapForMana', { cardUuid: land.uuid });
    expect(m.a.room!.players[m.p1].mana.red).toBe(1);
    expect(m.a.room!.battlefield[0].state.isTapped).toBe(true);
    await action(m, m.a, 'enter_battle');
    expect(m.a.room!.phase).toBe('stateMainPhase');
    expect(m.b.room!.priorityPlayerId).toBe(m.p2);
    await action(m, m.b, 'pass_priority');
    expect(m.a.room!.phase).toBe('beginCombatStep');
    await action(m, m.a, 'pass_priority');
    await action(m, m.b, 'pass_priority');
    expect(m.a.room!.phase).toBe('declareAttackersStep');
  });

  it('routes a selected mana option and concrete payment to both clients and reconnect', async () => {
    const m = await match('mana-payment');
    const producer = card(m.p1); producer.state.zone = 'battlefield'; producer.state.isTapped = true;
    producer.blueprint = { ...producer.blueprint, abilities: [
      { id: 'fixture-ability', type: 'activated', castSpeed: 'instant', cost: { life: 1 }, effect: { action: 'ADD_MANA', params: { colors: ['blue', 'green'], amount: 2 }, tags: [], targeting: { type: 'self', required: false } } },
    ] };
    const spell = card(m.p1);
    spell.blueprint = { ...spell.blueprint, castRequirements: { ...spell.blueprint.castRequirements, cost: { mana: { generic: 1 } } } };
    prepare(m, room => { room.battlefield = [producer]; room.players[m.p1].hand = [spell]; });
    const options = await m.a.socket.timeout(2500).emitWithAck('getOptions', { roomId: m.roomId, cardUuid: producer.uuid, zone: 'battlefield' });
    const blue = options.find((option: { data?: { manaColor: string } }) => option.data?.manaColor === 'blue');
    expect(blue.disabled).toBe(false);
    await action(m, m.a, blue.actionId, { cardUuid: producer.uuid, ...blue.data });
    for (const view of [m.a, m.b]) {
      expect(view.room!.players[m.p1].mana.blue).toBe(2);
      expect(view.room!.players[m.p1].life).toBe(16);
      expect(view.room!.battlefield[0].state.isTapped).toBe(true);
      expect(view.room!.stack).toHaveLength(0);
    }
    await action(m, m.a, 'cast_spell', { cardUuid: spell.uuid, payment: { blue: 1 } });
    for (const view of [m.a, m.b]) expect(view.room!.players[m.p1].mana.blue).toBe(1);
    m.b.socket.disconnect();
    const recovered = await client(m.p2, m.roomId);
    await vi.waitFor(() => expect(recovered.room?.players[m.p1].mana.blue).toBe(1), { timeout: 2500 });
    expect(recovered.room!.setup).toEqual(m.engine.roomState.setup);
    expect(recovered.room!.turnNumber).toBe(m.engine.roomState.turnNumber);
  });

  it('keeps both clients aligned through a zero-attacker ordinary turn', async () => {
    const m = await match('ordinary-turn');
    prepare(m, room => { room.debugMode = 'off'; });
    const aligned = (phase: GameRoom['phase'], priority: string | null) => {
      for (const view of [m.a, m.b]) {
        expect(view.room!.phase).toBe(phase);
        expect(view.room!.priorityPlayerId).toBe(priority);
        expect(view.room!.combatDeclarations).toEqual(m.engine.roomState.combatDeclarations);
        expect(view.room!.activeTurnPlayerId).toBe(m.engine.activeTurnPlayerId);
        expect(view.room!.turnNumber).toBe(m.engine.roomState.turnNumber);
      }
    };
    const passes = async () => {
      const first = m.engine.priorityPlayerId === m.p1 ? m.a : m.b;
      const second = first === m.a ? m.b : m.a;
      await action(m, first, 'pass_priority'); await action(m, second, 'pass_priority');
    };
    await passes(); aligned('beginCombatStep', m.p1);
    await passes(); aligned('declareAttackersStep', null);
    await action(m, m.a, 'declare_attackers', { attackers: [] });
    aligned('declareAttackersStep', m.p1);
    await passes(); aligned('endCombatStep', m.p1);
    await passes(); aligned('postcombatMainPhase', m.p1);
    await passes(); aligned('stateEndPhase', m.p1);
    await passes(); aligned('upkeepStep', m.p2);
    await passes(); aligned('stateDrawPhase', m.p2);
    await passes(); aligned('stateMainPhase', m.p2);
    expect(m.a.room!.players[m.p2].life).toBe(20);
  });

  it('sends reset state with stable identity through cast and debug resolution', async () => {
    const m = await match('reset-state');
    const creature = card(m.p1);
    creature.state = { ...creature.state, damageTaken: 1, counters: { stale: 3 }, isTapped: true,
      attackedThisTurn: true, summoningSickness: true, attachedTo: 'old-host' };
    prepare(m, room => { room.players[m.p1].hand = [creature]; });
    await action(m, m.a, 'cast_spell', { cardUuid: creature.uuid });
    for (const view of [m.a, m.b]) {
      expect(view.room!.stack).toHaveLength(1);
      expect(view.room!.stack[0].source.uuid).toBe(creature.uuid);
      expect(view.room!.stack[0].source.state).toMatchObject({ zone: 'stack', counters: {}, damageTaken: 0, isTapped: false });
      expect(view.room!.stack[0].source.state.attachedTo).toBeUndefined();
    }
    await action(m, m.b, 'resolve_stack');
    for (const view of [m.a, m.b]) {
      expect(view.room!.battlefield[0].uuid).toBe(creature.uuid);
      expect(view.room!.battlefield[0].state).toMatchObject({ zone: 'battlefield', counters: {}, damageTaken: 0,
        isTapped: false, summoningSickness: true, attackedThisTurn: false });
    }
    expect(m.a.room!.battlefield).toEqual(m.engine.roomState.battlefield);
    expect(m.b.room!.battlefield).toEqual(m.engine.roomState.battlefield);
    m.b.socket.disconnect();
    const recovered = await client(m.p2, m.roomId);
    await vi.waitFor(() => expect(recovered.room?.battlefield).toEqual(m.engine.roomState.battlefield));
  });

  it('schedules synthetic mixed-controller triggers and restores ordering, modes and targets on reconnect', async () => {
    const m = await match('trigger-order');
    const spell = card(m.p1); spell.blueprint = { ...spell.blueprint, cardTypes: ['Spell'], onCastEffects: [] };
    const watchers = [m.p2, m.p1, m.p1].map((controller, index) => {
      const source = card(controller); source.state.zone = 'battlefield';
      source.blueprint = { ...source.blueprint, onEnterEffects: [], abilities: [{ id: 'synthetic-' + index, type: 'triggered', castSpeed: 'instant', triggerCondition: 'ON_SPELL_CAST', trigger: { controller: 'any' },
        effect: { action: 'MODIFY_LIFE', params: { amount: 0 }, targeting: { type: 'self', required: false } },
        ...(index === 1 ? { modes: [{ id: 'drain', label: 'Drain', effects: [{ action: 'MODIFY_LIFE', params: { amount: -2 }, targeting: { type: 'player', controller: 'opponent', required: true, maxTargets: 1 } }] }] } : {}),
      }] };
      return source;
    });
    prepare(m, room => { room.debugMode = 'off'; room.players[m.p1].hand = [spell]; room.battlefield = watchers; });
    await action(m, m.a, 'cast_spell', { cardUuid: spell.uuid });
    for (const view of [m.a, m.b]) { expect(view.room!.pendingChoice?.kind).toBe('ordering'); expect(view.room!.priorityPlayerId).toBeNull(); expect(view.room!.stack).toHaveLength(1); }
    m.a.socket.disconnect(); const recovered = await client(m.p1, m.roomId);
    await vi.waitFor(() => expect(recovered.room?.pendingChoice?.id).toBe(m.engine.roomState.pendingChoice?.id));
    const current = { ...m, a: recovered };
    const order = recovered.room!.pendingChoice!;
    await action(current, recovered, 'choose', { choiceId: order.id, choices: order.options.map(option => option.id).reverse() });
    expect(recovered.room!.pendingChoice?.kind).toBe('modes');
    await action(current, recovered, 'choose', { choiceId: recovered.room!.pendingChoice!.id, choices: ['drain'] });
    expect(recovered.room!.pendingChoice?.kind).toBe('targets');
    await action(current, recovered, 'choose', { choiceId: recovered.room!.pendingChoice!.id, choices: [recovered.room!.pendingChoice!.options[0].id] });
    for (const view of [recovered, m.b]) {
      expect(view.room!.pendingChoice).toBeNull(); expect(view.room!.triggerQueue).toBeNull(); expect(view.room!.priorityPlayerId).toBe(m.p1);
      expect(view.room!.stack.map(object => object.source.uuid)).toEqual([spell.uuid, watchers[2].uuid, watchers[1].uuid, watchers[0].uuid]);
    }
    for (let index = 0; index < 2; index++) { await action(current, recovered, 'pass_priority'); await action(current, m.b, 'pass_priority'); }
    expect(recovered.room!.players[m.p2].life).toBe(18); expect(m.b.room!.players[m.p2].life).toBe(18);
  });

  const noop = { action: 'MODIFY_LIFE', params: { amount: 0 }, targeting: { type: 'self' as const, required: false } };
  const trigger = (id: string, triggerCondition: TriggerEvent, extra: Partial<TriggeredAbility> = {}): TriggeredAbility => ({ id, type: 'triggered', castSpeed: 'instant', triggerCondition, effect: noop, ...extra });
  async function orderTriggers(m: Match) {
    while (m.engine.roomState.pendingChoice?.kind === 'ordering') {
      const choice = m.engine.roomState.pendingChoice;
      await action(m, choice.playerId === m.p1 ? m.a : m.b, 'choose', { choiceId: choice.id, choices: choice.options.map(option => option.id) });
    }
  }
  const abilityIds = (room: GameRoom) => room.stack.flatMap(object => object.type === 'triggered' ? [object.ability?.id] : []);

  it('separates self-entry from another-creature entry through socket casting', async () => {
    const m = await match('entry-predicates'), entering = card(m.p1), watcher = card(m.p1);
    entering.blueprint = { ...entering.blueprint, onCastEffects: [], onEnterEffects: [], abilities: [trigger('entering-self', 'ON_ENTER_BATTLEFIELD')] };
    watcher.state.zone = 'battlefield'; watcher.blueprint = { ...watcher.blueprint, onEnterEffects: [], abilities: [trigger('watcher-self', 'ON_ENTER_BATTLEFIELD'),
      trigger('another-creature', 'ON_ENTER_BATTLEFIELD', { trigger: { subject: 'another', controller: 'self', cardTypes: ['Creature'] } })] };
    prepare(m, room => { room.battlefield = [watcher]; room.players[m.p1].hand = [entering]; });
    await action(m, m.a, 'cast_spell', { cardUuid: entering.uuid }); await action(m, m.a, 'resolve_stack'); await orderTriggers(m);
    for (const view of [m.a, m.b]) {
      expect(abilityIds(view.room!)).toEqual(['another-creature', 'entering-self']);
      expect(view.room!.stack).toEqual(m.engine.roomState.stack);
    }
  });

  it('routes committed life/draw/discard events and event-history predicates to both clients', async () => {
    const m = await match('semantic-events'), watcher = card(m.p1), spell = card(m.p1), drawn = card(m.p1, 'land-red');
    watcher.state.zone = 'battlefield'; drawn.state.zone = 'library';
    const drawsBefore = m.engine.roomState.turnHistory?.playerCounts[m.p1]?.CARD_DRAWN ?? 0;
    watcher.blueprint = { ...watcher.blueprint, abilities: [trigger('gain', 'ON_LIFE_GAIN'), trigger('loss', 'ON_LIFE_LOSS'),
      trigger('draw', 'ON_DRAW', { trigger: { condition: { op: 'gte', left: { path: 'history.own.CARD_DRAWN' }, right: 1 } } }), trigger('discard', 'ON_DISCARD')] };
    spell.blueprint = { ...spell.blueprint, cardTypes: ['Spell'], onCastEffects: [
      { ...noop, params: { amount: 3 } }, { ...noop, params: { amount: -2 } }, draw, { action: 'DISCARD_HAND', params: {}, targeting: { type: 'self', required: false } },
    ] };
    prepare(m, room => { room.players[m.p1].life = 20; room.battlefield = [watcher]; room.players[m.p1].hand = [spell]; room.players[m.p1].deck = [drawn]; });
    await action(m, m.a, 'cast_spell', { cardUuid: spell.uuid }); await action(m, m.a, 'resolve_stack'); await orderTriggers(m);
    for (const view of [m.a, m.b]) {
      expect(abilityIds(view.room!)).toEqual(['gain', 'loss', 'draw', 'discard']); expect(view.room!.players[m.p1].life).toBe(21);
      expect(view.room!.turnHistory?.playerCounts[m.p1]).toMatchObject({ LIFE_GAINED: 1, LIFE_LOST: 1, CARD_DRAWN: drawsBefore + 1, CARD_DISCARDED: 1, SPELL_CAST: 1 });
      expect(view.room!.turnHistory).toEqual(m.engine.roomState.turnHistory);
      expect(view.room!.stack.map(object => object.type === 'triggered' ? object.triggeringEvent?.payload.amount : undefined)).toEqual([3, 2, undefined, undefined]);
    }
  });

  it.each(['hand', 'exile', 'graveyard'] as const)('routes leave to %s without a false noncreature death', async destination => {
    const m = await match('leave-' + destination), source = card(m.p1), removal = card(m.p1);
    source.state.zone = 'battlefield'; source.blueprint = { ...source.blueprint, cardTypes: ['Artifact'], abilities: [trigger('leave', 'ON_LEAVE_BATTLEFIELD'), trigger('die', 'ON_DIE')] };
    removal.blueprint = { ...removal.blueprint, cardTypes: ['Spell'], onCastEffects: [{ action: 'MOVE_ZONE', params: { origin: 'battlefield', destination }, targeting: { type: 'permanent', required: true } }] };
    prepare(m, room => { room.battlefield = [source]; room.players[m.p1].hand = [removal]; });
    await action(m, m.a, 'cast_spell', { cardUuid: removal.uuid, targets: [{ targetType: 'permanent', cardUuid: source.uuid }] }); await action(m, m.a, 'resolve_stack');
    expect(m.engine.roomState.players[m.p1][destination]?.find(card => card.uuid === source.uuid)?.state).toMatchObject({ zone: destination, zoneRevision: 1 });
    for (const view of [m.a, m.b]) {
      expect(abilityIds(view.room!)).toEqual(['leave']); expect(view.room!.battlefield).toEqual([]);
      if (destination === 'hand' && view === m.b) expect((view.room!.players[m.p1] as unknown as { handCount: number }).handCount).toBe(1);
      else expect(view.room!.players[m.p1][destination]?.find(card => card.uuid === source.uuid)?.state).toMatchObject({ zone: destination, zoneRevision: 1 });
      expect(view.room!.turnHistory!.counts.PERMANENT_DIED).toBe(0);
    }
    m.b.socket.disconnect(); const recovered = await client(m.p2, m.roomId);
    await vi.waitFor(() => expect(recovered.room?.players[m.p1][destination]).toEqual(m.engine.roomState.players[m.p1][destination]));
  });

  it('retains simultaneous dying witnesses before scheduling their triggers on the server', async () => {
    const m = await match('death-witnesses'), sources = [card(m.p1), card(m.p1)], spell = card(m.p1);
    sources.forEach((source, index) => { source.state.zone = 'battlefield'; source.blueprint = { ...source.blueprint, abilities: [trigger('witness-' + index, 'ON_DIE', { trigger: { subject: 'any' } })] }; });
    spell.blueprint = { ...spell.blueprint, cardTypes: ['Spell'], onCastEffects: [{ action: 'MODIFY_STATS', params: { damage: 100 }, tags: ['damage'], targeting: { type: 'permanent', all: true, cardTypes: ['Creature'], required: false } }] };
    prepare(m, room => { room.battlefield = sources; room.players[m.p1].hand = [spell]; });
    await action(m, m.a, 'cast_spell', { cardUuid: spell.uuid }); await action(m, m.a, 'resolve_stack');
    expect(m.a.room!.battlefield).toEqual([]); expect(m.a.room!.pendingChoice?.kind).toBe('ordering'); await orderTriggers(m);
    for (const view of [m.a, m.b]) {
      expect(abilityIds(view.room!).sort()).toEqual(['witness-0', 'witness-0', 'witness-1', 'witness-1']);
      expect(view.room!.stack.every(object => object.sourceInfo?.card.state.zone === 'battlefield')).toBe(true);
      expect(view.room!.turnHistory!.counts.PERMANENT_DIED).toBe(2); expect(view.room!.stack).toEqual(m.engine.roomState.stack);
    }
  });

  it('creates a delayed optional end-step trigger, retains departure information and resumes it after reconnect', async () => {
    const m = await match('delayed-end'), source = card(m.p1), removal = card(m.p1);
    source.state = { ...source.state, zone: 'battlefield', counters: { '+1/+1': 2 }, summoningSickness: false };
    const delayed = trigger('future-end', 'END_OF_TURN', { effect: { action: 'MODIFY_LIFE', params: { amount: 'DYNAMIC:source.power' }, targeting: { type: 'self', required: false }, choice: { kind: 'optional' } } });
    source.blueprint = { ...source.blueprint, abilities: [{ id: 'register', type: 'activated', castSpeed: 'instant', cost: { mana: { red: 1 } }, limitPerTurn: 1,
      effect: { action: 'CREATE_DELAYED_TRIGGER', params: { ability: delayed, lifetime: 'once' }, targeting: { type: 'self', required: false } } }] };
    removal.blueprint = { ...removal.blueprint, cardTypes: ['Spell'], onCastEffects: [{ action: 'MOVE_ZONE', params: { origin: 'battlefield', destination: 'exile' }, targeting: { type: 'permanent', required: true } }] };
    prepare(m, room => { room.players[m.p1].life = 20; room.players[m.p1].mana.red = 2; room.battlefield = [source]; room.players[m.p1].hand = [removal]; });
    await action(m, m.a, 'activate_ability', { cardUuid: source.uuid, abilityId: 'register' }); await action(m, m.a, 'resolve_stack');
    for (const view of [m.a, m.b]) expect(view.room!.delayedTriggers).toEqual(m.engine.roomState.delayedTriggers);
    const before = structuredClone(m.engine.roomState), rejected = once<{ message: string }>(m.a.socket, 'error');
    m.a.socket.emit('playerAction', { roomId: m.roomId, actionId: 'activate_ability', cardUuid: source.uuid, abilityId: 'register' });
    expect((await rejected).message).toContain('limit'); expect(m.engine.roomState).toEqual(before);
    await action(m, m.a, 'cast_spell', { cardUuid: removal.uuid, targets: [{ targetType: 'permanent', cardUuid: source.uuid }] }); await action(m, m.a, 'resolve_stack');
    for (const view of [m.a, m.b]) expect(view.room!.delayedTriggers![0].sourceInfo.power).toBe(3);
    prepare(m, room => { room.phase = 'postcombatMainPhase'; room.debugMode = 'off'; });
    await action(m, m.a, 'pass_priority'); await action(m, m.b, 'pass_priority');
    for (const view of [m.a, m.b]) { expect(abilityIds(view.room!)).toEqual(['future-end']); expect(view.room!.delayedTriggers).toEqual([]); }
    await action(m, m.a, 'pass_priority'); await action(m, m.b, 'pass_priority'); expect(m.a.room!.pendingChoice?.kind).toBe('optional');
    m.a.socket.disconnect(); const recovered = await client(m.p1, m.roomId), current = { ...m, a: recovered };
    await vi.waitFor(() => expect(recovered.room?.pendingChoice?.id).toBe(m.engine.roomState.pendingChoice!.id));
    await action(current, recovered, 'choose', { choiceId: recovered.room!.pendingChoice!.id, choices: ['yes'] });
    for (const view of [recovered, m.b]) { expect(view.room!.players[m.p1].life).toBe(23); expect(view.room!.pendingChoice).toBeNull(); expect(view.room!.stack).toEqual([]); expect(view.room!.turnHistory).toEqual(m.engine.roomState.turnHistory); }
  });

  it('enforces a once-per-turn trigger across socket resolutions and resets it on the next ordinary turn', async () => {
    const m = await match('trigger-limit'), watcher = card(m.p1), first = card(m.p1), second = card(m.p1), third = card(m.p1);
    watcher.state.zone = 'battlefield'; watcher.blueprint = { ...watcher.blueprint, abilities: [trigger('limited-gain', 'ON_LIFE_GAIN', { limitPerTurn: 1 })] };
    for (const spell of [first, second, third]) spell.blueprint = { ...spell.blueprint, cardTypes: ['Spell'], castRequirements: { ...spell.blueprint.castRequirements, speed: 'instant' }, onCastEffects: [{ ...noop, params: { amount: 1 } }] };
    prepare(m, room => { room.battlefield = [watcher]; room.players[m.p1].hand = [first, second, third]; });
    await action(m, m.a, 'cast_spell', { cardUuid: first.uuid }); await action(m, m.a, 'resolve_stack'); expect(abilityIds(m.a.room!)).toEqual(['limited-gain']); await action(m, m.a, 'resolve_stack');
    await action(m, m.a, 'cast_spell', { cardUuid: second.uuid }); await action(m, m.a, 'resolve_stack'); expect(m.a.room!.stack).toEqual([]);
    const oldTurn = m.engine.roomState.turnNumber ?? 1; prepare(m, room => { room.phase = 'stateEndPhase'; room.debugMode = 'off'; });
    await action(m, m.a, 'pass_priority'); await action(m, m.b, 'pass_priority');
    expect(m.a.room!.turnNumber).toBe(oldTurn + 1); expect(m.a.room!.turnHistory!.counts.LIFE_GAINED).toBe(0);
    await action(m, m.b, 'pass_priority'); await action(m, m.a, 'cast_spell', { cardUuid: third.uuid });
    await action(m, m.a, 'pass_priority'); await action(m, m.b, 'pass_priority');
    for (const view of [m.a, m.b]) { expect(abilityIds(view.room!)).toEqual(['limited-gain']); expect(view.room!.turnHistory).toEqual(m.engine.roomState.turnHistory); }
  });

  it('restores a resolution choice on reconnect and resumes through the real socket boundary', async () => {
    const m = await match('choice');
    const spell = card(m.p1);
    spell.blueprint = { ...spell.blueprint, cardTypes: ['Spell'], onCastEffects: [
      { action: 'MODIFY_LIFE', params: { amount: 1 }, targeting: { type: 'self', required: false } },
      { action: 'MODIFY_LIFE', params: { amount: 2 }, targeting: { type: 'self', required: false }, choice: { kind: 'optional', prompt: 'Gain two?' } },
    ] };
    prepare(m, room => { room.players[m.p1].hand = [spell]; room.players[m.p1].life = 20; });
    await action(m, m.a, 'cast_spell', { cardUuid: spell.uuid });
    await action(m, m.a, 'resolve_stack');
    for (const view of [m.a, m.b]) { expect(view.room!.pendingChoice?.kind).toBe('optional'); expect(view.room!.priorityPlayerId).toBeNull(); expect(view.room!.players[m.p1].life).toBe(21); }
    m.a.socket.disconnect();
    const recovered = await client(m.p1, m.roomId);
    await vi.waitFor(() => expect(recovered.room?.pendingChoice?.id).toBe(m.engine.roomState.pendingChoice!.id));
    const request = recovered.room!.pendingChoice!;
    const error = once<{ message: string }>(m.b.socket, 'error');
    m.b.socket.emit('playerAction', { roomId: m.roomId, actionId: 'choose', choiceId: request.id, choices: ['yes'] });
    expect((await error).message).toContain('another player');
    recovered.socket.emit('playerAction', { roomId: m.roomId, actionId: 'choose', choiceId: request.id, choices: ['yes'] });
    await vi.waitFor(() => { for (const view of [recovered, m.b]) { expect(view.room!.pendingChoice).toBeNull(); expect(view.room!.players[m.p1].life).toBe(23); expect(view.room!.stack).toEqual([]); } });
  });
  it('counters an instant through ordinary priority and syncs selected stack removal', async () => {
    const m = await match('counter'); const spell = card(m.p1, 'broken-fireball'), counter = card(m.p2, 'counterspell-fixture');
    prepare(m, room => { room.debugMode = 'off'; room.players[m.p1].hand = [spell]; room.players[m.p2].hand = [counter]; });
    await action(m, m.a, 'cast_spell', { cardUuid: spell.uuid, targets: [{ targetType: 'player', playerId: m.p2 }] });
    const target = m.engine.roomState.stack[0].uuid;
    await action(m, m.a, 'pass_priority');
    await action(m, m.b, 'cast_spell', { cardUuid: counter.uuid, targets: [{ targetType: 'spell', stackUuid: target }] });
    await action(m, m.b, 'pass_priority'); await action(m, m.a, 'pass_priority');
    for (const view of [m.a, m.b]) {
      expect(view.room!.stack).toEqual([]); expect(view.room!.players[m.p2].life).toBe(20);
      expect(view.room!.players[m.p1].graveyard.map(card => card.uuid)).toContain(spell.uuid);
      expect(view.room!.players[m.p2].graveyard.map(card => card.uuid)).toContain(counter.uuid);
      expect(view.room!.stack).toEqual(m.engine.roomState.stack);
    }
  });

  it('sends an ability departure snapshot through deltas and retains it on reconnect', async () => {
    const m = await match('source-info'); const source = card(m.p1, 'card_09876_core_set'), removal = card(m.p2, 'broken-fireball');
    source.state = { ...source.state, zone: 'battlefield', summoningSickness: false, counters: { '+1/+1': 2 } };
    source.blueprint.abilities = [{ id: 'power-life', type: 'activated', cost: {}, castSpeed: 'instant', effect: { action: 'MODIFY_LIFE', params: { amount: 'DYNAMIC:source.power' }, targeting: { type: 'self', required: false } } }];
    removal.blueprint.onCastEffects = [{ action: 'MOVE_ZONE', params: { origin: 'battlefield', destination: 'graveyard' }, targeting: { type: 'permanent', required: true, maxTargets: 1 } }];
    prepare(m, room => { room.battlefield = [source]; room.players[m.p1].life = 20; room.players[m.p2].hand = [removal]; });
    await action(m, m.a, 'activate_ability', { cardUuid: source.uuid, abilityId: 'power-life' });
    await action(m, m.a, 'pass_priority');
    await action(m, m.b, 'cast_spell', { cardUuid: removal.uuid, targets: [{ targetType: 'permanent', cardUuid: source.uuid }] });
    await action(m, m.b, 'pass_priority'); await action(m, m.a, 'pass_priority');
    for (const view of [m.a, m.b]) { expect(view.room!.stack[0].sourceInfo?.power).toBe(7); expect(view.room!.stack).toEqual(m.engine.roomState.stack); expect(view.room!.battlefield).toEqual([]); }
    m.b.socket.disconnect(); const recovered = await client(m.p2, m.roomId);
    await vi.waitFor(() => expect(recovered.room?.stack[0].sourceInfo?.power).toBe(7));
    await action({ ...m, b: recovered }, m.a, 'pass_priority');
    await action({ ...m, b: recovered }, recovered, 'pass_priority');
    await vi.waitFor(() => expect(recovered.room?.players[m.p1].life).toBe(27)); expect(m.a.room!.stack).toEqual([]);
  });

  it('rejects unsafe packets and unknown actors without changing room or emitting deltas', async () => {
    const m = await match('safe-packet');
    const before = structuredClone(m.engine.roomState);
    const counts = [m.a.deltas.length, m.b.deltas.length];
    for (const packet of [null, [], { roomId: m.roomId, actionId: 'declare_attackers', attackers: [null] },
      { roomId: m.roomId, actionId: 'declare_blockers', assignments: [{ attackerUuid: 'a', blockerUuids: null }] },
      { roomId: m.roomId, actionId: 'cast_spell', targets: [null] },
      { roomId: m.roomId, actionId: 'cast_spell', targets: [{ targetType: 'player', playerId: m.p2, all: true, cardTypes: 'Creature' }] },
      { roomId: m.roomId, actionId: 'toString' }]) {
      const error = once<{ message: string }>(m.a.socket, 'error');
      m.a.socket.emit('playerAction', packet);
      expect((await error).message).toBeTypeOf('string');
    }
    const visitor = await client('visitor');
    const error = once<{ message: string }>(visitor.socket, 'error');
    visitor.socket.emit('playerAction', { roomId: m.roomId, actionId: 'end_turn', playerId: m.p1 });
    expect((await error).message).toContain('not in this room');
    expect(await visitor.socket.timeout(2500).emitWithAck('getOptions', { roomId: m.roomId, cardUuid: 'missing', zone: 'hand' })).toEqual([]);
    expect(await m.a.socket.timeout(2500).emitWithAck('getOptions', null)).toEqual([]);
    const options = once<{ options: unknown[] }>(m.a.socket, 'optionsForCard');
    m.a.socket.emit('getOptions', { roomId: m.roomId, cardUuid: 'missing', zone: 'hand' }, 'not-a-function');
    expect((await options).options).toEqual([]);
    expect(m.engine.roomState).toEqual(before);
    expect([m.a.deltas.length, m.b.deltas.length]).toEqual(counts);
  });
});
