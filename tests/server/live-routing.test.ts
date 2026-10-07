import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { io as connect, type Socket } from 'socket.io-client';
import { GameEngine } from '../../src/engine/game-engine';
import { EventBus } from '../../src/engine/event-bus';
import { instantiateCard } from '../../src/library/card-factory';
import { applyDeltaChanges } from '../../src/client/store/deltaReducer';
import type { GameRoom } from '../../src/types/game.room.types';
import type { StateDelta } from '../../src/types/delta.types';
import type { CardInstance, TriggerEvent } from '../../src/types/card.types';

// Vitest loads src/server.ts directly in this isolated worker. No dist/build,
// route mocks, injected server factory, or production fixture API is involved.
describe('actual server routing', () => {
  let live: typeof import('../../src/server');
  let url: string;
  const clients: Socket[] = [];
  const initialized: GameEngine[] = [];
  const observed = new Map<string, GameEngine>();
  const roomTimers: ReturnType<typeof setTimeout>[] = [];
  const originalPort = process.env.PORT;
  let initSpy: ReturnType<typeof vi.spyOn>;
  let disposeSpy: ReturnType<typeof vi.spyOn>;
  let clearSpy: ReturnType<typeof vi.spyOn>;

  beforeAll(async () => {
    process.env.PORT = '0';
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
      expect(b.room?.phase).toBe('stateMainPhase');
    }, { timeout: 2500 });
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
    }
    await action(m, m.a, 'resolve_stack');
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
    await action(m, m.b, 'declare_blockers', { assignments: [] });
    expect(m.a.room!.players[m.p2].life).toBe(0);
    expect(m.a.room!.combat[0].attacker.uuid).toBe(attacker.uuid);
    expect(m.a.room!.battlefield[0].uuid).toBe(attacker.uuid);
    await terminal(m);
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
    expect(m.a.room!.phase).toBe('beginCombatStep');
    await action(m, m.a, 'pass_priority');
    await action(m, m.b, 'pass_priority');
    expect(m.a.room!.phase).toBe('declareAttackersStep');
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
