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
import { CardCharacteristicService as characteristics } from '../../src/engine/card-characteristic-service';
import { structuralTargetLegal, targetPermissionsAllow } from '../../src/shared/target-legality';
import type { EffectDefinition } from '../../src/types/effect.types';
import { GameLogger } from '../../src/shared/game-logger';
import { gameConfig, triggerTestSetup, st01aTestSetup } from '../../src/config';

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

  async function match(prefix: string, useFixture = true) {
    const a = await client(`${prefix}1`);
    const b = await client(`${prefix}2`);
    const created = once<{ roomId: string }>(a.socket, 'roomCreated');
    a.socket.emit('createRoom');
    const { roomId } = await created;
    await vi.waitFor(() => expect(a.room?.status).toBe('waiting'), { timeout: 2500 });
    const oldEngine = observed.get(roomId)!;
    if (useFixture) oldEngine.roomState.players[`${prefix}1`].life = 17;
    b.socket.emit('joinRoom', { roomId });
    await vi.waitFor(() => {
      expect(a.room?.status).toBe('RPS');
      expect(b.room?.status).toBe('RPS');
    }, { timeout: 2500 });
    expect(a.room!.players[`${prefix}1`].life).toBe(useFixture ? 17 : 20);
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
    if (useFixture) observed.get(roomId)!.roomState.debugMode = 'flow';
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
  function genericSpell(ownerId: string, effects: EffectDefinition[], speed: 'instant' | 'sorcery' = 'instant') {
    const spell = card(ownerId);
    spell.blueprint = { ...spell.blueprint, id: 'generic-engine-spell', name: 'Generic engine spell', cardTypes: [speed === 'instant' ? 'Instant' : 'Sorcery'],
      colors: [], keywords: [], abilities: [], onEnterEffects: [], onCastEffects: effects, castRequirements: { allowedZones: ['hand'], speed, cost: {} } };
    return spell;
  }
  function prepare(m: Match, setup: (room: GameRoom) => void) {
    // Setup only data; every cast, resolve, pass, attack and block uses sockets.
    setup(m.engine.roomState);
    // Existing raw debug snapshots deliberately seed the actual client reducer.
    live.io.to(m.roomId).emit('roomSnapshot', { room: m.engine.roomState });
  }

  async function action(m: Match, view: Match['a'], actionId: string, data: Record<string, unknown> = {}, waitMs = 2500) {
    const lengths = [m.a.deltas.length, m.b.deltas.length];
    const errors = view.errors.length;
    view.socket.emit('playerAction', { roomId: m.roomId, actionId, ...data });
    await vi.waitFor(() => {
      expect(view.errors.slice(errors)).toEqual([]);
      expect(m.a.deltas.length).toBeGreaterThan(lengths[0]);
      expect(m.b.deltas.length).toBeGreaterThan(lengths[1]);
    }, { timeout: waitMs });
  }

  it('finishes a fresh match using real ST01A mana, creatures and damage spells without editing game state', async () => {
    const originalSetup = gameConfig.setup;
    gameConfig.setup = st01aTestSetup;
    const m = await match('st01a-play', false).finally(() => { gameConfig.setup = originalSetup; });
    expect(m.a.room!.setup?.developmentDeck).toEqual(st01aTestSetup.developmentDeck);
    expect(m.a.room!.players[m.p1].hand.filter(c => c.blueprint.id === 'musketeer-infantry')[0].blueprint).toMatchObject({ power: 4, toughness: 5 });
    const viewFor = (pid: string) => pid === m.p1 ? m.a : m.b;
    // This complete 60-card match retains a much larger history than short fixtures.
    const send = (view: Match['a'], id: string, data: Record<string, unknown> = {}) => action(m, view, id, data, 10_000);
    const played = new Set<string>(), triggered = new Set<string>();
    const observeStack = () => {
      for (const item of m.a.room!.stack) {
        expect(m.b.room!.stack.find(s => s.uuid === item.uuid)).toEqual(item);
        if (item.type === 'triggered' && item.ability) triggered.add(item.ability.id);
      }
    };
    async function passBoth() {
      observeStack();
      const first = viewFor(m.a.room!.priorityPlayerId!);
      await send(first, 'pass_priority'); await send(first === m.a ? m.b : m.a, 'pass_priority');
    }
    async function settle() {
      for (let i = 0; i < 20; i++) {
        observeStack();
        const c = m.a.room!.pendingChoice;
        if (c) {
          expect(['targets', 'optional', 'ordering']).toContain(c.kind);
          if (c.kind === 'number') throw new Error('Expected listed trigger choice');
          await send(viewFor(c.playerId), 'choose', { choiceId: c.id, choices: c.kind === 'ordering' ? c.options.map(o => o.id)
            : [c.kind === 'optional' ? c.options.find(o => o.value === true)!.id : c.options[0].id] });
        } else if (m.a.room!.stack.length) await passBoth();
        else return;
      }
      throw new Error('ST01A trigger chain did not finish');
    }
    async function produce(view: Match['a'], amount: number) {
      const pid = view === m.a ? m.p1 : m.p2;
      const sources = view.room!.battlefield.filter(c => c.state.controllerId === pid && !c.state.isTapped &&
        (c.blueprint.id === 'land-red' || c.blueprint.id === 'empire-servant' && !c.state.summoningSickness));
      expect(sources.length).toBeGreaterThanOrEqual(amount);
      for (const card of sources.slice(0, amount)) await send(view, 'tapForMana', { cardUuid: card.uuid });
    }
    async function cast(view: Match['a'], id: string, amount: number, targets?: Record<string, unknown>[]) {
      const pid = view === m.a ? m.p1 : m.p2;
      await produce(view, amount);
      const source = view.room!.players[pid].hand.find(c => c.blueprint.id === id)!;
      expect(source).toBeTruthy();
      await send(view, 'cast_spell', { cardUuid: source.uuid, ...(targets ? { targets } : {}) });
      expect(m.b.room!.stack.some(s => s.source.uuid === source.uuid)).toBe(true);
      played.add(id); await settle(); return source.uuid;
    }
    let aTurns = 0, bTurns = 0, attacker = '', rebel = '';
    for (let step = 0; step < 120 && m.a.room!.status !== 'gameOver'; step++) {
      const room = m.a.room!, view = viewFor(room.activeTurnPlayerId), pid = room.activeTurnPlayerId;
      if (room.phase === 'stateMainPhase') {
        const turn = pid === m.p1 ? ++aTurns : ++bTurns;
        if (turn <= 4) {
          const land = view.room!.players[pid].hand.find(c => c.blueprint.id === 'land-red')!;
          await send(view, 'play_land', { cardUuid: land.uuid, zoneRevision: land.state.zoneRevision ?? 0 });
        }
        if (pid === m.p1 && turn === 1) await cast(view, 'empire-servant', 1);
        if (pid === m.p2 && turn === 1) await cast(view, 'musketeer-infantry', 1);
        if (pid === m.p1 && turn === 2) {
          attacker = await cast(view, 'musketeer-infantry', 1);
          await cast(view, 'fireball', 2, [{ targetType: 'player', playerId: m.p2 }]);
          for (const v of [m.a, m.b]) expect(v.room!.players[m.p2].life).toBe(15);
        }
        if (pid === m.p1 && turn === 3) {
          rebel = await cast(view, 'worlds-rebel', 3);
          await cast(view, 'broken-fireball', 1, [{ targetType: 'player', playerId: m.p2 }]);
          for (const v of [m.a, m.b]) expect(v.room!.players[m.p2].life).toBe(12);
        }
        if (pid === m.p1 && turn === 4) {
          await cast(view, 'awakened-blood-mountain', 2);
          const land = m.a.room!.battlefield.find(c => c.state.controllerId === m.p2 && c.blueprint.id === 'land-red')!;
          const hand = m.a.room!.players[m.p1].hand.length;
          await cast(view, 'flame-fangs', 2, [{ targetType: 'permanent', cardUuid: land.uuid }]);
          expect(m.a.room!.players[m.p1].hand).toHaveLength(hand);
          expect(m.b.room!.players[m.p2].graveyard.some(c => c.uuid === land.uuid)).toBe(true);
        }
        await passBoth();
      } else if (room.phase === 'declareAttackersStep' && !room.combatDeclarations?.attackers) {
        await send(view, 'declare_attackers', { attackers: pid === m.p1 && aTurns >= 3 ? [attacker, ...(aTurns >= 4 ? [rebel] : [])].map(cardUuid => ({ cardUuid })) : [] });
      } else if (room.phase === 'declareBlockersStep' && !room.combatDeclarations?.blockers) {
        await send(viewFor(pid === m.p1 ? m.p2 : m.p1), 'declare_blockers', { assignments: [] });
      } else if (room.pendingChoice) {
        const c = room.pendingChoice;
        if (c.kind !== 'distribution') { await settle(); continue; }
        expect(c.kind).toBe('distribution'); if (c.kind === 'number') throw new Error('Expected damage allocation');
        await send(viewFor(c.playerId), 'choose', { choiceId: c.id, allocations: { [c.options[0].id]: c.total } });
      } else await passBoth();
    }
    expect(aTurns).toBe(5); expect(m.a.room!.players[m.p2].life).toBeLessThanOrEqual(0);
    expect([...played].sort()).toEqual(['empire-servant', 'musketeer-infantry', 'fireball', 'broken-fireball', 'worlds-rebel', 'awakened-blood-mountain', 'flame-fangs'].sort());
    expect([...triggered].sort()).toEqual(['attack-destroy', 'opponent-life-loss-draw']);
    await terminal(m);
  }, 180_000);

  it('plays the authored trigger probe through cast, watchers, targeted attack, block, death chains and stale targets on both clients', async () => {
    const originalSetup = gameConfig.setup, originalLogging = gameConfig.logging.appliedEvents;
    const debug = vi.spyOn(GameLogger.prototype, 'debug');
    gameConfig.setup = triggerTestSetup; gameConfig.logging.appliedEvents = true;
    try {
      const m = await match('probe-play', false);
      expect(m.a.room!.setup?.developmentDeck).toEqual(triggerTestSetup.developmentDeck);
      const playerId = (view: Match['a']) => view === m.a ? m.p1 : m.p2;
      const actor = () => m.a.room!.activeTurnPlayerId === m.p1 ? m.a : m.b;
      const viewFor = (id: string) => id === m.p1 ? m.a : m.b;
      const field = (id: string) => m.a.room!.battlefield.filter(c => c.state.controllerId === id && c.blueprint.id === 'trigger-probe');
      const seen = new Map<string, NonNullable<GameRoom['stack']>[number]>();
      const capture = () => {
        for (const item of m.a.room!.stack) {
          seen.set(item.uuid, structuredClone(item));
          expect(m.b.room!.stack.find(s => s.uuid === item.uuid)).toEqual(item);
        }
      };
      async function passBoth() {
        const first = viewFor(m.a.room!.priorityPlayerId!);
        await action(m, first, 'pass_priority'); await action(m, first === m.a ? m.b : m.a, 'pass_priority'); capture();
      }
      async function settle() {
        for (let step = 0; step < 40; step++) {
          capture();
          const choice = m.a.room!.pendingChoice;
          if (choice) {
            expect(['ordering', 'targets']).toContain(choice.kind);
            if (choice.kind === 'number') throw new Error('Unexpected number choice');
            await action(m, viewFor(choice.playerId), 'choose', { choiceId: choice.id,
              choices: choice.kind === 'ordering' ? choice.options.map(o => o.id) : [choice.options[0].id] });
          } else if (m.a.room!.stack.length) await passBoth();
          else return;
        }
        throw new Error('Probe trigger chain did not finish');
      }
      async function playProbe() {
        const view = actor(), pid = playerId(view);
        const land = view.room!.players[pid].hand.find(c => c.blueprint.id === 'land-red')!;
        await action(m, view, 'play_land', { cardUuid: land.uuid, zoneRevision: land.state.zoneRevision ?? 0 });
        const ready = view.room!.battlefield.find(c => c.state.controllerId === pid && c.blueprint.id === 'land-red' && !c.state.isTapped)!;
        await action(m, view, 'tapForMana', { cardUuid: ready.uuid });
        const probe = view.room!.players[pid].hand.find(c => c.blueprint.id === 'trigger-probe')!;
        await action(m, view, 'cast_spell', { cardUuid: probe.uuid }); await settle();
        expect(field(pid).some(c => c.uuid === probe.uuid)).toBe(true); return probe.uuid;
      }
      async function nextMain() {
        const previous = m.a.room!.activeTurnPlayerId;
        for (let step = 0; step < 15; step++) {
          await settle();
          if (m.a.room!.phase === 'stateMainPhase' && m.a.room!.activeTurnPlayerId !== previous) return;
          if (m.a.room!.phase === 'declareAttackersStep' && !m.a.room!.combatDeclarations?.attackers)
            await action(m, actor(), 'declare_attackers', { attackers: [] });
          else await passBoth();
        }
        throw new Error('Probe game did not reach next main phase');
      }
      const a1 = await playProbe(); await nextMain();
      const b1 = await playProbe(); await nextMain();
      const a2 = await playProbe();
      expect([...seen.values()].filter(s => s.source.uuid === a1).map(s => s.ability?.id)).toEqual(expect.arrayContaining(['probe-entry', 'probe-draw', 'probe-other-cast', 'probe-other-entry']));
      await passBoth(); await passBoth();
      const beforeAttackLife = m.b.room!.players[m.p2].life;
      await action(m, m.a, 'declare_attackers', { attackers: [{ cardUuid: a1 }] });
      expect(m.a.room!.pendingChoice?.kind).toBe('targets');
      await settle();
      expect(m.b.room!.players[m.p2].life).toBe(beforeAttackLife - 1);
      expect([...seen.values()].find(s => s.ability?.id === 'probe-attack')?.effects[0].targets).toEqual([{ targetType: 'player', playerId: m.p2 }]);
      await passBoth();
      const lifeB = m.b.room!.players[m.p2].life;
      await action(m, m.b, 'declare_blockers', { assignments: [{ attackerUuid: a1, blockerUuids: [b1] }] });
      await settle(); expect(m.b.room!.players[m.p2].life).toBe(lifeB + 1);
      await passBoth();
      for (let index = 0; index < 2; index++) {
        const c = m.a.room!.pendingChoice!;
        expect(c.kind).toBe('distribution'); if (c.kind === 'number') throw new Error('Expected combat choice');
        await action(m, viewFor(c.playerId), 'choose', { choiceId: c.id, allocations: { [c.options[0].id]: c.total } });
      }
      for (const view of [m.a, m.b]) for (const uuid of [a1, b1])
        expect(view.room!.battlefield.find(c => c.uuid === uuid)?.state.damageTaken).toBe(3);
      await passBoth(); await passBoth();
      const readyLand = m.a.room!.battlefield.find(c => c.state.controllerId === m.p1 && c.blueprint.id === 'land-red' && !c.state.isTapped)!;
      await action(m, m.a, 'tapForMana', { cardUuid: readyLand.uuid });
      const handA = m.a.room!.players[m.p1].hand.length, lifeA = m.a.room!.players[m.p1].life;
      await action(m, m.a, 'activate_ability', { cardUuid: a1, abilityId: 'probe-destroy', targets: [{ targetType: 'permanent', cardUuid: a2 }] });
      await settle();
      expect(m.a.room!.players[m.p1].hand).toHaveLength(handA + 2);
      for (const view of [m.a, m.b]) {
        expect(view.room!.players[m.p1].life).toBe(lifeA + 2);
        expect(view.room!.players[m.p1].graveyard.filter(c => c.uuid === a2)).toHaveLength(1);
      }
      await nextMain(); await nextMain();
      const lands = m.a.room!.battlefield.filter(c => c.state.controllerId === m.p1 && c.blueprint.id === 'land-red');
      for (const land of lands) await action(m, m.a, 'tapForMana', { cardUuid: land.uuid });
      const target = { targetType: 'permanent', cardUuid: b1 };
      await action(m, m.a, 'activate_ability', { cardUuid: a1, abilityId: 'probe-destroy', targets: [target] });
      const staleId = m.a.room!.stack.at(-1)!.uuid;
      await action(m, m.a, 'activate_ability', { cardUuid: a1, abilityId: 'probe-destroy', targets: [target] });
      const handB = m.b.room!.players[m.p2].hand.length;
      await settle();
      expect(m.b.room!.players[m.p2].hand).toHaveLength(handB + 1);
      expect(m.b.room!.players[m.p2].graveyard.filter(c => c.uuid === b1)).toHaveLength(1);
      const emitted = debug.mock.calls.filter(([name]) => name === 'event:emitted');
      const events = vi.mocked(EventBus.prototype.emit).mock.calls.map(([event]) => event).filter(e => e.roomId === m.roomId);
      expect(events.find(e => e.eventId === 'STACK_ITEM_RESOLVED' && (e.payload.stackObj as { uuid: string })?.uuid === staleId)?.payload)
        .toMatchObject({ fizzled: true, skipped: 'object_failed' });
      const triggers = [...seen.values()].filter(s => s.type === 'triggered');
      expect(new Set(triggers.map(s => s.ability?.id))).toEqual(new Set(['probe-entry', 'probe-draw', 'probe-other-cast', 'probe-other-entry', 'probe-attack', 'probe-block', 'probe-death', 'probe-other-death']));
      for (const s of triggers) {
        expect(s.triggeringEvent?.eventUuid).toBeTruthy();
        expect(events.some(e => e.eventUuid === s.triggeringEvent?.eventUuid && e.eventId === s.triggeringEvent?.eventId)).toBe(true);
        expect(debug.mock.calls.some(([name, , data]) => name === 'trigger:queued' && data?.stackUuid === s.uuid && data?.eventUuid === s.triggeringEvent?.eventUuid)).toBe(true);
        expect(debug.mock.calls.some(([name, , data]) => name === 'trigger:received' && data?.eventUuid === s.triggeringEvent?.eventUuid)).toBe(true);
        expect(events.some(e => e.eventId === 'STACK_UPDATED' && (e.payload.newAction as { uuid?: string })?.uuid === s.uuid)).toBe(true);
        expect(events.find(e => e.eventId === 'STACK_ITEM_RESOLVED' && (e.payload.stackObj as { uuid: string })?.uuid === s.uuid)?.payload)
          .toMatchObject({ fizzled: false });
        expect(emitted.some(([, , data]) => data?.eventId === 'STACK_RESOLVED' && (data.payload as { stackObj?: { uuid: string } })?.stackObj?.uuid === s.uuid)).toBe(true);
      }
      expect(m.a.room!.battlefield).toEqual(m.b.room!.battlefield);
      expect(m.a.room!.stack).toEqual(m.b.room!.stack);
    } finally { gameConfig.setup = originalSetup; gameConfig.logging.appliedEvents = originalLogging; debug.mockRestore(); }
  }, 60_000);

  it('plays ordinary single-block, unblocked and multi-block combat through cleanup, reconnect and next land play', async () => {
    const m = await match('combat-play', false);
    const diagnostic = vi.spyOn(GameLogger.prototype, 'info');
    const actor = () => m.a.room!.activeTurnPlayerId === m.p1 ? m.a : m.b;
    const opponent = () => actor() === m.a ? m.b : m.a;
    const playerId = (view: Match['a']) => view === m.a ? m.p1 : m.p2;
    const field = (id: string) => m.a.room!.battlefield.filter(card => card.state.controllerId === id && card.blueprint.cardTypes.includes('Creature'));
    async function passBoth() {
      const first = m.a.room!.priorityPlayerId === m.p1 ? m.a : m.b;
      await action(m, first, 'pass_priority'); await action(m, first === m.a ? m.b : m.a, 'pass_priority');
    }
    async function playCreature(playLand = false) {
      const view = actor(), id = playerId(view);
      if (playLand) {
        const land = view.room!.players[id].hand.find(card => card.blueprint.cardTypes.includes('Land'))!;
        await action(m, view, 'play_land', { cardUuid: land.uuid, zoneRevision: land.state.zoneRevision ?? 0 });
      }
      const land = view.room!.battlefield.find(card => card.state.controllerId === id && card.blueprint.cardTypes.includes('Land') && !card.state.isTapped)!;
      await action(m, view, 'tapForMana', { cardUuid: land.uuid });
      const creature = view.room!.players[id].hand.find(card => card.blueprint.cardTypes.includes('Creature'))!;
      await action(m, view, 'cast_spell', { cardUuid: creature.uuid }); await passBoth();
      expect(view.room!.battlefield.find(card => card.uuid === creature.uuid)?.state.summoningSickness).toBe(true);
      return creature.uuid;
    }
    async function attackers(uuids: string[]) {
      await passBoth(); await passBoth(); expect(m.a.room!.phase).toBe('declareAttackersStep');
      await action(m, actor(), 'declare_attackers', { attackers: uuids.map(cardUuid => ({ cardUuid })) });
      await passBoth();
    }
    async function finishTurn() {
      const previous = m.a.room!.activeTurnPlayerId;
      for (let step = 0; step < 8; step++) {
        if (m.a.room!.phase === 'stateMainPhase' && m.a.room!.activeTurnPlayerId !== previous) return;
        await passBoth();
      }
      throw new Error('Ordinary handoff did not reach the next main phase');
    }
    async function allocate(expected: number, pick?: string) {
      for (let index = 0; index < expected; index++) {
        const choice = m.a.room!.pendingChoice!;
        expect(choice.kind).toBe('distribution'); expect(choice.continuation.type).toBe('combat');
        if (choice.kind === 'number') throw new Error('Expected listed damage choice');
        const selected = pick && choice.options.find(option => (option.value as { cardUuid?: string }).cardUuid === pick) || choice.options[0];
        await action(m, choice.playerId === m.p1 ? m.a : m.b, 'choose', { choiceId: choice.id, allocations: { [selected.id]: choice.total! } });
        if (index < expected - 1) expect(m.a.room!.combatDamage?.completed).toBe(false);
      }
      expect(m.a.room!.pendingChoice).toBeNull(); expect(m.b.room!.combatDamage?.completed).toBe(true);
    }
    const a1 = await playCreature(true);
    await passBoth(); await passBoth();
    const rejected = once<{ message: string }>(m.a.socket, 'error'), count = m.a.deltas.length;
    m.a.socket.emit('playerAction', { roomId: m.roomId, actionId: 'declare_attackers', attackers: [{ cardUuid: a1 }] });
    expect((await rejected).message).toBe(field(m.p1)[0].blueprint.name + ' has summoning sickness');
    expect(m.a.deltas).toHaveLength(count); expect(m.a.room!.combatDeclarations?.attackers).toBe(false);
    await action(m, m.a, 'declare_attackers', { attackers: [] }); await passBoth(); await finishTurn();
    const b1 = await playCreature(true); await attackers([]); await finishTurn();
    const a2 = await playCreature(true); await attackers([a1]);
    await action(m, opponent(), 'declare_blockers', { assignments: [{ attackerUuid: a1, blockerUuids: [b1] }] }); await passBoth();
    await allocate(2); expect(field(m.p1).map(card => card.uuid)).toEqual([a2]); expect(field(m.p2)).toEqual([]);
    for (const [id, uuid] of [[m.p1, a1], [m.p2, b1]]) expect(m.b.room!.players[id].graveyard.some(card => card.uuid === uuid)).toBe(true);
    await finishTurn(); const b2 = await playCreature(); await attackers([]); await finishTurn();
    const a3 = await playCreature(); await attackers([a2]);
    await action(m, opponent(), 'declare_blockers', { assignments: [] }); await passBoth(); await allocate(1);
    expect(m.b.room!.players[m.p2].life).toBe(19);
    await finishTurn(); const b3 = await playCreature(); await attackers([]); await finishTurn();
    await attackers([a2, a3]);
    const badBlocks = once<{ message: string }>(m.b.socket, 'error'), beforeBlocks = m.a.deltas.length;
    m.b.socket.emit('playerAction', { roomId: m.roomId, actionId: 'declare_blockers', assignments: [
      { attackerUuid: a2, blockerUuids: [b2] }, { attackerUuid: a3, blockerUuids: [b2] },
    ] });
    expect((await badBlocks).message).toBe(field(m.p2).find(card => card.uuid === b2)!.blueprint.name + ' is already assigned to another attacker'); expect(m.a.deltas).toHaveLength(beforeBlocks);
    expect(m.a.room!.combatDeclarations?.blockers).toBe(false);
    await action(m, opponent(), 'declare_blockers', { assignments: [{ attackerUuid: a2, blockerUuids: [b2, b3] }] }); await passBoth();
    expect(m.a.room!.pendingChoice!.kind).toBe('distribution');
    if (m.a.room!.pendingChoice!.kind === 'number') throw new Error('Expected listed choice');
    expect(m.a.room!.pendingChoice!.options).toHaveLength(2);
    const boardBefore = structuredClone(m.a.room!.battlefield);
    const firstChoice = m.a.room!.pendingChoice!;
    await action(m, m.a, 'choose', { choiceId: firstChoice.id, allocations: { [firstChoice.options[0].id]: 1, [firstChoice.options[1].id]: 0 } });
    expect(diagnostic).toHaveBeenCalledWith('command:received', 'Player action received', expect.objectContaining({
      choiceId: firstChoice.id, allocationTotal: 1, allocationChoices: [{ id: firstChoice.options[0].id, amount: 1 }],
    }));
    expect(m.a.room!.battlefield).toEqual(boardBefore); // No damage until every source has assigned.
    await allocate(3);
    expect(field(m.p1).map(card => card.uuid)).toEqual([a3]); expect(field(m.p2).map(card => card.uuid)).toEqual([b3]);
    expect(m.a.room!.players[m.p2].life).toBe(18);
    expect(diagnostic.mock.calls.some(([event, , details]) => event === 'command:received' && (details as { attackers?: unknown[] })?.attackers?.length === 2)).toBe(true);
    expect(diagnostic.mock.calls.some(([event, , details]) => event === 'command:received' && (details as { assignments?: unknown[] })?.assignments?.length === 1)).toBe(true);
    expect(diagnostic.mock.calls.some(([event, , details]) => event === 'command:accepted' &&
      (details as { phase?: string; priorityPlayerId?: string })?.phase === 'declareBlockersStep' &&
      (details as { priorityPlayerId?: string })?.priorityPlayerId === m.p1)).toBe(true);
    m.b.socket.disconnect(); const recovered = await client(m.p2, m.roomId);
    await vi.waitFor(() => expect(recovered.room?.phase).toBe('combatDamageStep'), { timeout: 2500 });
    expect(recovered.room!.battlefield).toEqual(m.a.room!.battlefield); m.b = recovered;
    await finishTurn(); expect(m.a.room!.activeTurnPlayerId).toBe(m.p2);
    const survivor = m.b.room!.battlefield.find(card => card.uuid === b3)!;
    expect(survivor.state.isTapped).toBe(false); expect(survivor.state.summoningSickness).toBe(false); expect(survivor.state.damageTaken).toBe(0);
    expect(m.b.room!.turnHistory?.landPlays?.[m.p2] ?? 0).toBe(0);
    const land = m.b.room!.players[m.p2].hand.find(card => card.blueprint.cardTypes.includes('Land'))!;
    await action(m, m.b, 'play_land', { cardUuid: land.uuid, zoneRevision: land.state.zoneRevision ?? 0 });
    expect(m.a.room!.turnHistory?.landPlays?.[m.p2]).toBe(1); expect(m.a.room!.outcome).toBeFalsy();
  }, 30_000);

  it('plays a normal development land, produces mana and resolves a targeted spell with ordinary passes', async () => {
    const m = await match('basic-play');
    const lands = m.a.room!.players[m.p1].hand.filter(card => card.blueprint.cardTypes.includes('Land'));
    const spell = m.a.room!.players[m.p1].hand.find(card => card.blueprint.id === 'broken-fireball')!;
    expect(lands).toHaveLength(2); expect(spell).toBeDefined();
    await action(m, m.a, 'play_land', { cardUuid: lands[0].uuid, zoneRevision: lands[0].state.zoneRevision ?? 0, commandId: 'direct-land-trace' });
    expect(m.a.room!.stack).toEqual([]); expect(m.a.room!.turnHistory?.landPlays?.[m.p1]).toBe(1);
    expect(m.b.room!.battlefield[0].uuid).toBe(lands[0].uuid);
    expect(m.a.deltas.at(-1)?.commandId).toBe('direct-land-trace');
    const rejected = once<{ message: string }>(m.a.socket, 'error'); const lengths = [m.a.deltas.length, m.b.deltas.length];
    m.a.socket.emit('playerAction', { roomId: m.roomId, actionId: 'play_land', cardUuid: lands[1].uuid, zoneRevision: lands[1].state.zoneRevision ?? 0 });
    expect((await rejected).message).toContain('land play');
    expect([m.a.deltas.length, m.b.deltas.length]).toEqual(lengths);
    await action(m, m.a, 'tapForMana', { cardUuid: lands[0].uuid });
    expect(m.a.room!.players[m.p1].mana.red).toBe(1);
    const life = m.a.room!.players[m.p2].life;
    await action(m, m.a, 'cast_spell', { cardUuid: spell.uuid, targets: [{ targetType: 'player', playerId: m.p2 }] });
    expect(m.b.room!.stack).toHaveLength(1); expect(m.b.room!.players[m.p1].mana.red).toBe(0);
    await action(m, m.a, 'pass_priority'); await action(m, m.b, 'pass_priority');
    expect(m.a.room!.stack).toEqual([]); expect(m.a.room!.players[m.p2].life).toBe(life - 3);
    expect(m.b.room!.players[m.p2].life).toBe(life - 3);
    // Snapshots have recipient-specific hand views; compare the committed
    // public zones and bookkeeping rather than demanding identical views.
    for (const key of ['battlefield', 'stack', 'phase', 'priorityPlayerId', 'turnHistory'] as const) expect(m.a.room![key]).toEqual(m.b.room![key]);
    for (const id of [m.p1, m.p2]) {
      expect(m.a.room!.players[id].mana).toEqual(m.b.room!.players[id].mana);
      expect(m.a.room!.players[id].graveyard).toEqual(m.b.room!.players[id].graveyard);
    }
  });

  it.each(['base', 'alternative'] as const)('runs loaded choice-practice through %s, cancellation, invalid input and payment reconnect', async kind => {
    const m = await match('loaded-' + kind); const actor = m.a.room!.players[m.p1];
    const diagnostic = vi.spyOn(GameLogger.prototype, 'info');
    const spell = actor.hand.find(card => card.blueprint.id === 'choice-practice')!;
    const land = actor.hand.find(card => card.blueprint.cardTypes.includes('Land'))!;
    const discard = actor.hand.find(card => card.blueprint.id === 'empire-servant')!;
    expect(spell).toBeDefined();
    await action(m, m.a, 'play_land', { cardUuid: land.uuid, zoneRevision: land.state.zoneRevision ?? 0 });
    await action(m, m.a, 'tapForMana', { cardUuid: land.uuid });
    const before = { life: m.a.room!.players[m.p1].life, hand: m.a.room!.players[m.p1].hand.map(c => c.uuid) };
    await action(m, m.a, 'cast_spell', { cardUuid: spell.uuid, choosePayment: true });
    await action(m, m.a, 'choose', { choiceId: m.a.room!.pendingChoice!.id, cancel: true });
    expect(m.a.room!.players[m.p1].mana.red).toBe(1); expect(m.a.room!.players[m.p1].hand.map(c => c.uuid)).toEqual(before.hand);
    await action(m, m.a, 'cast_spell', { cardUuid: spell.uuid, choosePayment: true });
    const pendingId = m.a.room!.pendingChoice!.id; const rejection = once<{ message: string }>(m.a.socket, 'error');
    m.a.socket.emit('playerAction', { roomId: m.roomId, actionId: 'choose', choiceId: pendingId, number: 5 });
    expect((await rejection).message).toContain('Invalid'); expect(m.a.room!.pendingChoice!.id).toBe(pendingId);
    const x = kind === 'base' ? 0 : 2;
    await action(m, m.a, 'choose', { choiceId: pendingId, number: x });
    await action(m, m.a, 'choose', { choiceId: m.a.room!.pendingChoice!.id, choices: [kind === 'base' ? 'base' : 'alternative:life'] });
    const targets = m.a.room!.pendingChoice!; if (targets.kind === 'number') throw new Error('Expected targets');
    await action(m, m.a, 'choose', { choiceId: targets.id, choices: [targets.options.find(option => (option.value as any).playerId === m.p2)!.id] });
    await action(m, m.a, 'choose', { choiceId: m.a.room!.pendingChoice!.id, choices: [discard.uuid] });
    expect(m.a.room!.pendingChoice?.kind).toBe('payment'); expect(m.a.room!.players[m.p1].life).toBe(before.life);
    expect(m.a.room!.players[m.p1].hand.map(c => c.uuid)).toEqual(before.hand); expect(m.a.room!.players[m.p1].mana.red).toBe(1);
    const paymentId = m.a.room!.pendingChoice!.id; m.a.socket.disconnect();
    const recovered = await client(m.p1, m.roomId);
    await vi.waitFor(() => expect(recovered.room?.pendingChoice?.id).toBe(paymentId), { timeout: 2500 });
    const current = { ...m, a: recovered };
    await action(current, recovered, 'choose', { choiceId: paymentId, allocations: { red: 1 } });
    expect(recovered.room!.stack[0].numericBindings).toEqual({ X: x });
    expect(recovered.room!.players[m.p1].life).toBe(before.life - (kind === 'alternative' ? 2 : 0));
    expect(recovered.room!.players[m.p1].mana.red).toBe(0);
    await action(current, recovered, 'pass_priority'); await action(current, m.b, 'pass_priority');
    expect(recovered.room!.players[m.p2].life).toBe(20 - x); expect(m.b.room!.players[m.p2].life).toBe(20 - x);
    expect(recovered.room!.stack).toEqual([]); expect(m.b.room!.pendingChoice).toBeNull();
    expect(diagnostic).toHaveBeenCalledWith('command:received', 'Player action received', expect.objectContaining({ number: x }));
    expect(diagnostic).toHaveBeenCalledWith('command:received', 'Player action received', expect.objectContaining({ allocationTotal: 1 }));
    diagnostic.mockRestore();
  });

  it('retains an announced number through socket choice, reconnect, payment and resolution', async () => {
    const m = await match('numeric');
    const x = { numeric: { kind: 'binding', name: 'X' } } as const;
    const spell = genericSpell(m.p1, [{ action: 'MODIFY_LIFE', params: { amount: x }, targeting: { type: 'self', required: false } }]);
    spell.blueprint = { ...spell.blueprint, numericDeclarations: [{ name: 'X', min: 0, max: 5 }],
      castRequirements: { allowedZones: ['hand'], speed: 'instant', cost: { mana: { generic: x } } } };
    prepare(m, room => { room.players[m.p1].hand = [spell]; room.players[m.p1].life = 20; room.players[m.p1].mana.red = 5; });
    await action(m, m.a, 'cast_spell', { cardUuid: spell.uuid, choosePayment: true });
    expect(m.a.room!.pendingChoice).toMatchObject({ kind: 'number', range: { min: 0, max: 5 } });
    expect(m.b.room!.pendingChoice?.id).toBe(m.a.room!.pendingChoice?.id);
    expect(m.a.room!.players[m.p1].mana.red).toBe(5);
    m.a.socket.disconnect();
    const reconnected = await client(m.p1, m.roomId);
    await vi.waitFor(() => expect(reconnected.room?.pendingChoice?.kind).toBe('number'), { timeout: 2500 });
    const continued = { ...m, a: reconnected };
    await action(continued, reconnected, 'choose', { choiceId: reconnected.room!.pendingChoice!.id, number: 3 });
    expect(reconnected.room!.pendingChoice?.kind).toBe('payment');
    await action(continued, reconnected, 'choose', { choiceId: reconnected.room!.pendingChoice!.id, allocations: { red: 3 } });
    expect(reconnected.room!.stack[0]).toMatchObject({ numericBindings: { X: 3 } });
    expect(reconnected.room!.players[m.p1].mana.red).toBe(2);
    await action(continued, reconnected, 'resolve_stack');
    expect(reconnected.room!.players[m.p1].life).toBe(23); expect(m.b.room!.players[m.p1].life).toBe(23);
    expect(reconnected.room!.stack).toEqual([]); expect(m.b.room!.pendingChoice).toBeNull();
  });

  it('correlates a choice, cancellation and rejection without forwarding tracing fields to rules', async () => {
    const m = await match('trace'); const spell = genericSpell(m.p1, [{ action: 'MODIFY_LIFE', params: { amount: 1 }, targeting: { type: 'player', required: true } }]);
    prepare(m, room => { room.players[m.p1].hand = [spell]; });
    await action(m, m.a, 'cast_spell', { cardUuid: spell.uuid, commandId: 'trace-open' });
    expect(m.a.deltas.at(-1)?.commandId).toBe('trace-open'); expect(m.b.deltas.at(-1)?.commandId).toBe('trace-open');
    expect(m.a.room!.pendingChoice?.continuation).not.toHaveProperty('data.commandId');
    const before = [m.a.deltas.length, m.b.deltas.length];
    const rejected = once<{ message: string; commandId: string; action: string }>(m.b.socket, 'error');
    m.b.socket.emit('playerAction', { roomId: m.roomId, actionId: 'choose', choiceId: m.a.room!.pendingChoice!.id, choices: [], commandId: 'trace-reject' });
    expect(await rejected).toMatchObject({ commandId: 'trace-reject', action: 'choose', message: expect.any(String) });
    expect([m.a.deltas.length, m.b.deltas.length]).toEqual(before);
    await action(m, m.a, 'choose', { choiceId: m.a.room!.pendingChoice!.id, cancel: true, commandId: 'trace-cancel' });
    expect(m.a.deltas.at(-1)?.commandId).toBe('trace-cancel'); expect(m.a.room!.stack).toEqual([]);
  });

  it('retains a selected payment route through reconnect and mandatory discard payment', async () => {
    const m = await match('cost-routes');
    const spell = genericSpell(m.p1, [{ action: 'MODIFY_LIFE', params: { amount: 1 }, targeting: { type: 'self', required: false } }]);
    const discarded = card(m.p1);
    spell.blueprint = { ...spell.blueprint, castRequirements: { allowedZones: ['hand'], speed: 'instant', cost: { mana: { generic: 99 } },
      alternativeCosts: [{ id: 'life', label: 'Pay two life', cost: { life: 2 } }], additionalCost: { discard: 1 } } };
    prepare(m, room => { room.players[m.p1].hand = [spell, discarded]; room.players[m.p1].life = 20; });
    await action(m, m.a, 'cast_spell', { cardUuid: spell.uuid });
    expect(m.a.room!.pendingChoice?.kind).toBe('options');
    await action(m, m.a, 'choose', { choiceId: m.a.room!.pendingChoice!.id, choices: ['alternative:life'] });
    expect(m.a.room!.players[m.p1].life).toBe(20); expect(m.a.room!.pendingChoice?.kind).toBe('discard');
    m.a.socket.disconnect(); const reconnected = await client(m.p1, m.roomId);
    await vi.waitFor(() => expect(reconnected.room?.pendingChoice?.kind).toBe('discard'), { timeout: 2500 });
    expect(reconnected.room!.pendingChoice?.continuation).toMatchObject({ data: { costRoute: { kind: 'alternative', id: 'life' } } });
    const continued = { ...m, a: reconnected };
    await action(continued, reconnected, 'choose', { choiceId: reconnected.room!.pendingChoice!.id, choices: [discarded.uuid] });
    expect(reconnected.room!.players[m.p1].life).toBe(18); expect(m.b.room!.players[m.p1].life).toBe(18);
    expect(reconnected.room!.players[m.p1].graveyard.map(c => c.uuid)).toContain(discarded.uuid);
    await action(continued, reconnected, 'resolve_stack'); expect(reconnected.room!.players[m.p1].life).toBe(19);
  });

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

  it('commits an empty-library shuffle through ordinary casting, triggers and reconnect', async () => {
    const m = await match('shuffle');
    const watcher = card(m.p1);
    watcher.state.zone = 'battlefield';
    watcher.blueprint = { ...watcher.blueprint, onEnterEffects: [], abilities: [{ id: 'shuffle-watch', type: 'triggered', triggerCondition: 'ON_SHUFFLE',
      castSpeed: 'instant', effect: { action: 'MODIFY_LIFE', params: { amount: 2 }, tags: [], targeting: { type: 'self' } } }] };
    const spell = genericSpell(m.p1, [{ action: 'SHUFFLE', params: {}, tags: [], targeting: { type: 'self' } }]);
    const actualEvents: string[] = [];
    const bus = (m.engine as unknown as { eventBus: EventBus }).eventBus;
    bus.on('LIBRARY_SHUFFLED', event => actualEvents.push(event.eventUuid!));
    prepare(m, room => { room.players[m.p1].deck = []; room.players[m.p1].hand = [spell]; room.battlefield = [watcher]; });
    await action(m, m.a, 'cast_spell', { cardUuid: spell.uuid });
    await action(m, m.a, 'pass_priority');
    await action(m, m.b, 'pass_priority');
    expect(actualEvents).toHaveLength(1);
    for (const view of [m.a, m.b]) {
      expect(view.room!.turnHistory?.counts.LIBRARY_SHUFFLED).toBe(1);
      expect(view.room!.stack).toHaveLength(1);
      expect(view.room!.stack[0].ability?.triggerCondition).toBe('ON_SHUFFLE');
    }
    m.b.socket.disconnect();
    const recovered = await client(m.p2, m.roomId);
    await vi.waitFor(() => expect(recovered.room?.stack[0].ability?.triggerCondition).toBe('ON_SHUFFLE'), { timeout: 2500 });
    const current = { ...m, b: recovered };
    await action(current, m.a, 'pass_priority');
    await action(current, recovered, 'pass_priority');
    expect(m.a.room!.players[m.p1].life).toBe(19);
    expect(recovered.room!.players[m.p1].life).toBe(19);
    expect(m.engine.roomState.players[m.p1].deck).toEqual([]);
    expect(actualEvents).toHaveLength(1);
  });

  it('casts generic ordered library effects, syncs draws and restores deck order on reconnect', async () => {
    const m = await match('library-order');
    const deck = Array.from({ length: 4 }, () => { const instance = card(m.p1); instance.state.zone = 'library'; return instance; });
    const [x, y, z, w] = deck;
    const [a, b] = [card(m.p1), card(m.p1)];
    const spell = genericSpell(m.p1, [
      { action: 'REORDER_LIBRARY', params: { placement: 'top' }, tags: [], targeting: { type: 'self' }, choice: { kind: 'search', zone: 'library', min: 2, max: 2, ordered: true } },
      { action: 'MOVE_ZONE', params: { destination: 'library', libraryPlacement: 'bottom' }, tags: [], targeting: { type: 'self' }, choice: { kind: 'search', zone: 'hand', min: 2, max: 2, ordered: true } },
      { action: 'DRAW', params: { amount: 2 }, tags: [], targeting: { type: 'self' } },
    ]);
    prepare(m, room => { room.players[m.p1].deck = deck; room.players[m.p1].hand = [spell, a, b]; room.battlefield = []; });
    await action(m, m.a, 'cast_spell', { cardUuid: spell.uuid });
    await action(m, m.a, 'pass_priority');
    await action(m, m.b, 'pass_priority');
    expect(m.a.room!.pendingChoice).toMatchObject({ kind: 'ordering', min: 2, max: 2 });
    expect(m.a.room!.pendingChoice!.options).toHaveLength(4);
    expect(m.a.room!.pendingChoice!.prompt).toContain('top-to-bottom');
    const pending = JSON.parse(JSON.stringify(m.a.room!.pendingChoice));
    m.a.socket.disconnect();
    m.a = await client(m.p1, m.roomId);
    await vi.waitFor(() => expect(m.a.room?.pendingChoice).toEqual(pending), { timeout: 2500 });
    await action(m, m.a, 'choose', { choiceId: m.a.room!.pendingChoice!.id, choices: [w.uuid, y.uuid] });
    expect(m.engine.roomState.players[m.p1].deck.map(instance => instance.uuid)).toEqual([x.uuid, z.uuid, y.uuid, w.uuid]);
    expect(m.a.room!.players[m.p1].deck.map(instance => instance.uuid)).toEqual([x.uuid, z.uuid, y.uuid, w.uuid]);
    expect(m.b.deltas.at(-1)!.changes.some(change => change.path.startsWith(`players.${m.p1}.deck`))).toBe(false);
    await action(m, m.a, 'choose', { choiceId: m.a.room!.pendingChoice!.id, choices: [a.uuid, b.uuid] });
    expect(m.a.room!.players[m.p1].deck.map(instance => instance.uuid)).toEqual([b.uuid, a.uuid, x.uuid, z.uuid]);
    expect(m.a.room!.players[m.p1].hand.map(instance => instance.uuid)).toEqual([w.uuid, y.uuid]);
    expect(m.a.room!.players[m.p1].deck[0].state.zoneRevision).toBe(1);
    expect(m.b.deltas.at(-1)!.changes).toContainEqual({ path: `players.${m.p1}.handCount`, op: 'update', value: 2 });
    for (const view of [m.a, m.b]) expect(view.room!.stack).toEqual([]);
    m.b.socket.disconnect();
    const recovered = await client(m.p2, m.roomId);
    await vi.waitFor(() => expect(recovered.room?.players[m.p1].deck.map(instance => instance.uuid)).toEqual([b.uuid, a.uuid, x.uuid, z.uuid]), { timeout: 2500 });
    expect(recovered.room).toEqual(JSON.parse(JSON.stringify(m.engine.roomState)));
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
    expect(m.b.room!.continuousEffectPool).toContainEqual(expect.objectContaining({ scope: { objects: [{ cardUuid: hellkite.uuid, zoneRevision: 0 }] }, effect: { type: 'STAT_DELTA', power: 1 } }));
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
      expect(await rejected).toMatchObject({ message: 'Game is over', action: actionId, commandId: expect.any(String) });
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

  it('retains nonlethal combat damage through reconnect and clears it only at ordinary cleanup', async () => {
    const m = await match('combat-retained');
    prepare(m, room => {
      room.debugMode = 'off'; room.phase = 'declareAttackersStep'; room.priorityPlayerId = null;
      room.battlefield = [combatCreature('survivor', m.p1, 3, 5), combatCreature('fallen', m.p2, 1, 2)];
    });
    const graveyardBefore = Object.fromEntries([m.p1, m.p2].map(id => [id, m.a.room!.players[id].graveyard.length]));
    const lifeBefore = [m.a.room!.players[m.p1].life, m.a.room!.players[m.p2].life];
    await action(m, m.a, 'declare_attackers', { attackers: [{ cardUuid: 'survivor' }] });
    await action(m, m.a, 'pass_priority'); await action(m, m.b, 'pass_priority');
    await action(m, m.b, 'declare_blockers', { assignments: [{ attackerUuid: 'survivor', blockerUuids: ['fallen'] }] });
    await action(m, m.a, 'pass_priority'); await action(m, m.b, 'pass_priority');
    for (const [view, amount] of [[m.a, 3], [m.b, 1]] as const) {
      const choice = view.room!.pendingChoice!;
      await action(m, view, 'choose', { choiceId: choice.id, allocations: { [choice.options[0].id]: amount } });
      if (amount === 3) expect(m.a.room!.battlefield.map(card => card.state.damageTaken)).toEqual([0, 0]);
    }
    function assertResult(view: Match['a'], damage: number) {
      expect(view.room!.battlefield).toHaveLength(1);
      expect(view.room!.battlefield[0]).toMatchObject({ uuid: 'survivor', blueprint: { power: 3, toughness: 5 },
        state: { zone: 'battlefield', zoneRevision: 0, damageTaken: damage } });
      expect(view.room!.players[m.p1].graveyard).toHaveLength(graveyardBefore[m.p1]);
      const graveyard = view.room!.players[m.p2].graveyard;
      expect(graveyard).toHaveLength(graveyardBefore[m.p2] + 1);
      expect(graveyard.filter(card => card.uuid === 'fallen')).toHaveLength(1);
      expect(graveyard.find(card => card.uuid === 'fallen')).toMatchObject({ blueprint: { power: 1, toughness: 2 },
        state: { ownerId: m.p2, zone: 'graveyard', zoneRevision: 1, damageTaken: 0 } });
      expect([view.room!.players[m.p1].life, view.room!.players[m.p2].life]).toEqual(lifeBefore);
    }
    for (const view of [m.a, m.b]) assertResult(view, 1);
    m.a.socket.disconnect(); const restored = await client(m.p1, m.roomId);
    await vi.waitFor(() => expect(restored.room?.phase).toBe('combatDamageStep'), { timeout: 2500 });
    assertResult(restored, 1);
    const current = { ...m, a: restored };
    for (const phase of ['endCombatStep', 'postcombatMainPhase', 'stateEndPhase']) {
      await action(current, restored, 'pass_priority'); await action(current, m.b, 'pass_priority');
      for (const view of [restored, m.b]) { expect(view.room!.phase).toBe(phase); assertResult(view, 1); }
    }
    await action(current, restored, 'pass_priority'); await action(current, m.b, 'pass_priority');
    for (const view of [restored, m.b]) {
      expect(view.room!.phase).toBe('upkeepStep'); expect(view.room!.activeTurnPlayerId).toBe(m.p2); assertResult(view, 0);
    }
    expect(restored.room!.battlefield[0].state.isTapped).toBe(true); // Opponent's untap does not untap this attacker.
    restored.socket.disconnect(); const afterCleanup = await client(m.p1, m.roomId);
    await vi.waitFor(() => expect(afterCleanup.room?.phase).toBe('upkeepStep'), { timeout: 2500 });
    assertResult(afterCleanup, 0);
  }, 15_000);

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

  it('revalidates gained Hexproof at resolution and retains permission effects on reconnect', async () => {
    const m = await match('m6-target'); const target = combatCreature('m6-target', m.p2, 2, 5);
    const targeting = { type: 'permanent' as const, required: true, cardTypes: ['Creature'], maxTargets: 1 };
    const spell = genericSpell(m.p1, [{ action: 'TAP', params: {}, tags: [], targeting }]);
    const laterSpell = genericSpell(m.p1, [{ action: 'TAP', params: {}, tags: [], targeting }]);
    const protection = genericSpell(m.p2, [{ action: 'CREATE_CONTINUOUS_EFFECT', params: { effect: { type: 'ABILITY', addKeywords: ['Hexproof'] }, duration: 'END_OF_TURN' }, tags: [], targeting }]);
    prepare(m, room => { room.debugMode = 'off'; room.battlefield = [target]; room.players[m.p1].hand = [spell, laterSpell]; room.players[m.p2].hand = [protection]; });
    const selected = { targetType: 'permanent' as const, cardUuid: target.uuid };
    await action(m, m.a, 'cast_spell', { cardUuid: spell.uuid, targets: [selected] });
    await action(m, m.a, 'pass_priority');
    await action(m, m.b, 'cast_spell', { cardUuid: protection.uuid, targets: [selected] });
    await action(m, m.b, 'pass_priority'); await action(m, m.a, 'pass_priority');
    for (const view of [m.a, m.b]) {
      expect(view.room!.stack).toHaveLength(1);
      expect(view.room!.continuousEffectPool).toEqual(m.engine.roomState.continuousEffectPool);
      expect(structuralTargetLegal(view.room!, m.p1, selected, targeting)).toBe(true);
      expect(targetPermissionsAllow(view.room!, m.p1, spell, selected)).toBe(false);
      expect(targetPermissionsAllow(view.room!, m.p2, protection, selected)).toBe(true);
    }
    m.b.socket.disconnect(); const recovered = await client(m.p2, m.roomId);
    await vi.waitFor(() => expect(recovered.room?.continuousEffectPool).toEqual(m.engine.roomState.continuousEffectPool));
    const current = { ...m, b: recovered };
    await action(current, m.a, 'pass_priority'); await action(current, recovered, 'pass_priority');
    for (const view of [m.a, recovered]) { expect(view.room!.stack).toEqual([]); expect(view.room!.battlefield[0].state.isTapped).toBe(false); }
    const before = structuredClone(m.engine.roomState), counts = [m.a.deltas.length, recovered.deltas.length];
    const error = once<{ message: string }>(m.a.socket, 'error');
    m.a.socket.emit('playerAction', { roomId: m.roomId, actionId: 'cast_spell', cardUuid: laterSpell.uuid, targets: [selected] });
    expect((await error).message).toContain('Target is not legal');
    expect(m.engine.roomState).toEqual(before); expect([m.a.deltas.length, recovered.deltas.length]).toEqual(counts);
  });

  it('syncs frozen resolved buffs, dynamic static entrants, source departure and exact cleanup', async () => {
    const m = await match('m6-lifetime'); const subject = combatCreature('m6-subject', m.p1, 2, 8), anthem = card(m.p1), entrant = card(m.p1);
    anthem.state.zone = 'battlefield';
    anthem.blueprint = { ...anthem.blueprint, id: 'generic-static-source', name: 'Generic static source', cardTypes: ['Enchantment'], onEnterEffects: [], onCastEffects: [],
      abilities: [{ id: 'anthem', type: 'static', effects: [{ layer: 7, effect: { type: 'STAT_DELTA', power: 1 }, scope: { cardTypes: ['Creature'], controller: 'self' } }] }] };
    entrant.blueprint = { ...entrant.blueprint, id: 'generic-entrant', name: 'Generic entrant', cardTypes: ['Creature'], power: 2, toughness: 8, abilities: [], onEnterEffects: [], onCastEffects: [] };
    const buff = genericSpell(m.p1, [{ action: 'GRANT_STATS', params: { power: 2, toughness: 1 }, tags: [], targeting: { type: 'permanent', required: false, all: true, cardTypes: ['Creature'], controller: 'self' } }], 'sorcery');
    const bounce = genericSpell(m.p1, [{ action: 'MOVE_ZONE', params: { origin: 'battlefield', destination: 'hand' }, tags: [], targeting: { type: 'permanent', required: true, maxTargets: 1 } }]);
    prepare(m, room => { room.battlefield = [subject, anthem]; room.players[m.p1].hand = [buff, entrant, bounce]; });
    await action(m, m.a, 'cast_spell', { cardUuid: buff.uuid }); await action(m, m.a, 'resolve_stack');
    const ids = m.engine.roomState.continuousEffectPool.map(e => e.id);
    expect(new Set(ids).size).toBe(2);
    await action(m, m.a, 'cast_spell', { cardUuid: entrant.uuid }); await action(m, m.a, 'resolve_stack');
    for (const view of [m.a, m.b]) {
      expect(characteristics.resolvePower(view.room!, view.room!.battlefield.find(c => c.uuid === subject.uuid)!)).toBe(5);
      expect(characteristics.resolvePower(view.room!, view.room!.battlefield.find(c => c.uuid === entrant.uuid)!)).toBe(3);
      expect(view.room!.continuousEffectPool).toEqual(m.engine.roomState.continuousEffectPool);
      expect(view.room!.effectTimestamp).toBe(m.engine.roomState.effectTimestamp);
      expect(view.room!.effectSequence).toBe(m.engine.roomState.effectSequence);
    }
    await action(m, m.a, 'cast_spell', { cardUuid: bounce.uuid, targets: [{ targetType: 'permanent', cardUuid: anthem.uuid }] }); await action(m, m.a, 'resolve_stack');
    for (const view of [m.a, m.b]) {
      expect(characteristics.resolvePower(view.room!, view.room!.battlefield.find(c => c.uuid === subject.uuid)!)).toBe(4);
      expect(characteristics.resolvePower(view.room!, view.room!.battlefield.find(c => c.uuid === entrant.uuid)!)).toBe(2);
      expect(view.room!.continuousEffectPool.map(e => e.id)).toEqual(ids);
    }
    await action(m, m.a, 'end_turn');
    for (const view of [m.a, m.b]) { expect(view.room!.continuousEffectPool).toEqual([]); expect(view.room!.battlefield).toEqual(m.engine.roomState.battlefield); }
  });

  it('advertises effective Flash, casting restrictions and granted mana abilities through real sockets', async () => {
    const m = await match('m6-permission'); const source = card(m.p1), lock = card(m.p1), host = card(m.p1);
    for (const permanent of [source, lock, host]) permanent.state.zone = 'battlefield';
    source.blueprint = { ...source.blueprint, id: 'generic-permission-source', name: 'Generic permission source', cardTypes: ['Enchantment'], onEnterEffects: [],
      abilities: [{ id: 'timing', type: 'static', effects: [{ layer: 6, effect: { type: 'PERMISSION', rules: [{ action: 'cast', mode: 'instant', players: 'self' }] }, scope: { zones: ['hand'], cardTypes: ['Sorcery'], controller: 'self' } }] },
        { id: 'mana-grant', type: 'static', effects: [{ layer: 6, effect: { type: 'ABILITY', add: [{ id: 'granted-red', type: 'activated', castSpeed: 'instant', cost: { tap: true }, effect: { action: 'ADD_MANA', params: { colors: ['red'], amount: 1 }, tags: [], targeting: { type: 'self', required: false } } }] }, scope: { cardUuid: host.uuid } }] }] };
    lock.blueprint = { ...lock.blueprint, id: 'generic-restriction-source', name: 'Generic restriction source', cardTypes: ['Enchantment'], onEnterEffects: [],
      abilities: [{ id: 'restriction', type: 'static', effects: [{ layer: 6, effect: { type: 'PERMISSION', rules: [{ action: 'cast', mode: 'prohibit', players: 'self' }] }, scope: { zones: ['hand'], cardTypes: ['Sorcery'] } }] }] };
    host.blueprint = { ...host.blueprint, id: 'generic-mana-host', name: 'Generic mana host', cardTypes: ['Artifact'], abilities: [], onEnterEffects: [] };
    const spell = genericSpell(m.p1, [], 'sorcery'); spell.blueprint.castRequirements.cost = { mana: { red: 1 } };
    const removal = () => genericSpell(m.p1, [{ action: 'MOVE_ZONE', params: { origin: 'battlefield', destination: 'hand' }, tags: [], targeting: { type: 'permanent', required: true, maxTargets: 1 } }]);
    const unlock = removal(), removeGrant = removal();
    prepare(m, room => { room.battlefield = [source, lock, host]; room.activeTurnPlayerId = m.p2; room.priorityPlayerId = m.p1; room.players[m.p1].hand = [spell, unlock, removeGrant]; });
    const options = (cardUuid: string, zone: 'hand' | 'battlefield') => m.a.socket.timeout(2500).emitWithAck('getOptions', { roomId: m.roomId, cardUuid, zone });
    expect((await options(spell.uuid, 'hand'))[0]).toMatchObject({ disabled: true });
    const manaOption = (await options(host.uuid, 'battlefield'))[0];
    expect(manaOption).toMatchObject({ actionId: 'tapForMana', disabled: false, data: { abilityId: expect.stringContaining('granted-red@') } });
    await action(m, m.a, 'cast_spell', { cardUuid: unlock.uuid, targets: [{ targetType: 'permanent', cardUuid: lock.uuid }] }); await action(m, m.a, 'resolve_stack');
    await action(m, m.b, 'pass_priority');
    await action(m, m.a, 'tapForMana', { cardUuid: host.uuid, ...manaOption.data });
    expect((await options(spell.uuid, 'hand'))[0]).toMatchObject({ disabled: false });
    await action(m, m.a, 'cast_spell', { cardUuid: spell.uuid }); await action(m, m.a, 'resolve_stack');
    for (const view of [m.a, m.b]) { expect(view.room!.players[m.p1].mana.red).toBe(0); expect(view.room!.players[m.p1].graveyard.some(c => c.uuid === spell.uuid)).toBe(true); }
    await action(m, m.b, 'pass_priority');
    await action(m, m.a, 'cast_spell', { cardUuid: removeGrant.uuid, targets: [{ targetType: 'permanent', cardUuid: source.uuid }] }); await action(m, m.a, 'resolve_stack');
    expect(await options(host.uuid, 'battlefield')).toEqual([]);
    for (const view of [m.a, m.b]) expect(characteristics.resolveAbilities(view.room!, view.room!.battlefield.find(c => c.uuid === host.uuid)!)).toEqual([]);
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

  it.each([['double', 7], ['prevent', 4]])('resumes replacement order %s after reconnect with actual damage and lifelink', async (first, actual) => {
    const m = await match(`m7-${first}`);
    const spell = genericSpell(m.p1, [{ action: 'MODIFY_LIFE', params: { amount: -5 }, tags: ['damage'], targeting: { type: 'player', required: true, maxTargets: 1 } }]);
    spell.blueprint = { ...spell.blueprint, keywords: ['Lifelink'] };
    prepare(m, room => {
      room.players[m.p1].life = 20; room.players[m.p2].life = 20; room.players[m.p1].hand = [spell];
      room.replacementEffects = [
        { id: 'double', label: 'Double', operation: { type: 'damage_scale', factor: 2 }, match: { kinds: ['damage'] } },
        { id: 'prevent', label: 'Prevent three', operation: { type: 'prevent_damage', amount: 3 }, match: { kinds: ['damage'] } },
      ];
    });
    await action(m, m.a, 'cast_spell', { cardUuid: spell.uuid, targets: [{ targetType: 'player', playerId: m.p2 }] });
    await action(m, m.a, 'resolve_stack');
    for (const view of [m.a, m.b]) {
      expect(view.room!.pendingChoice?.continuation.type).toBe('replacement');
      expect(view.room!.priorityPlayerId).toBeNull(); expect(view.room!.players[m.p2].life).toBe(20);
    }
    m.b.socket.disconnect();
    const recovered = await client(m.p2, m.roomId);
    await vi.waitFor(() => expect(recovered.room?.pendingChoice?.id).toBe(m.engine.roomState.pendingChoice?.id));
    const current = { ...m, b: recovered };
    await action(current, recovered, 'choose', { choiceId: recovered.room!.pendingChoice!.id, choices: [first] });
    for (const view of [m.a, recovered]) {
      expect(view.room!.pendingChoice).toBeNull(); expect(view.room!.stack).toEqual([]);
      expect(view.room!.players[m.p1].life).toBe(20 + actual); expect(view.room!.players[m.p2].life).toBe(20 - actual);
      expect(view.room!.battlefield).toEqual(m.engine.roomState.battlefield);
      expect(view.room!.turnHistory).toEqual(m.engine.roomState.turnHistory);
    }
    await action(current, m.a, 'pass_priority');
    expect(recovered.room!.priorityPlayerId).toBe(m.p2);
  });

  it('restores legend selection after reconnect and settles before returning priority', async () => {
    const m = await match('m7-legend');
    const a = combatCreature('legend-a', m.p1), b = combatCreature('legend-b', m.p1);
    for (const card of [a, b]) card.blueprint = { ...card.blueprint, name: 'Generic legend', superTypes: ['Legendary'] };
    prepare(m, room => { room.battlefield = [a, b]; });
    await action(m, m.a, 'pass_priority');
    expect(m.b.room!.pendingChoice?.continuation.type).toBe('state_based');
    expect(m.b.room!.battlefield).toHaveLength(2);
    m.a.socket.disconnect(); const recovered = await client(m.p1, m.roomId);
    await vi.waitFor(() => expect(recovered.room?.pendingChoice?.id).toBe(m.engine.roomState.pendingChoice?.id));
    const current = { ...m, a: recovered };
    await action(current, recovered, 'choose', { choiceId: recovered.room!.pendingChoice!.id, choices: [b.uuid] });
    for (const view of [recovered, m.b]) {
      expect(view.room!.battlefield.map(c => c.uuid)).toEqual([b.uuid]);
      expect(view.room!.players[m.p1].graveyard.map(c => c.uuid)).toContain(a.uuid);
      expect(view.room!.pendingChoice).toBeNull(); expect(view.room!.priorityPlayerId).toBe(m.p2);
      expect(view.room!.battlefield).toEqual(m.engine.roomState.battlefield);
    }
  });
});
