import { describe, expect, it, vi } from 'vitest';
import { GameEngine } from '../../src/engine/game-engine';
import { gameReducer, reduceGameOperation } from '../../src/engine/game-reducer';
import { resolveEffects } from '../../src/engine/effect-resolver';
import { SyncService } from '../../src/server/sync-service';
import { applyDeltaChanges } from '../../src/client/store/deltaReducer';
import { createTestRoom, fillTestLibraries } from '../helpers/test-room-factory';
import type { GameMutation } from '../../src/types/game-mutation.types';
import type { StackObject } from '../../src/types/effect.types';
import { planLibraryShuffle } from '../../src/engine/library-operations';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const shuffle = (order: { cardUuid: string; zoneRevision: number }[], playerId = 'player1'): GameMutation =>
  ({ type: 'SHUFFLE_LIBRARY', playerId, order });
const reference = (card: ReturnType<typeof createTestRoom>['players'][string]['deck'][number]) =>
  ({ cardUuid: card.uuid, zoneRevision: card.state.zoneRevision ?? 0 });

describe('committed operation outcomes', () => {
  it('plans a generic shuffle with injected randomness and draws from the resulting top', () => {
    const room = createTestRoom();
    fillTestLibraries(room, 3);
    const [a, b, c] = room.players.player1.deck;
    const object: StackObject = { type: 'activated', uuid: 'effect', source: room.players.player1.hand[0], controllerId: 'player1', countered: false,
      effects: ['SHUFFLE', 'DRAW'].map(action => ({ action, params: action === 'DRAW' ? { amount: 1 } : {}, tags: [],
        targeting: { type: 'self' }, targets: [{ targetType: 'player', playerId: 'player1' }] })) };
    const mutations = resolveEffects(room, object, [], false, { random: () => 0 });
    expect(mutations[0]).toEqual(shuffle([b, c, a].map(reference)));
    const next = mutations.reduce(gameReducer, room);
    expect(next.players.player1.hand.at(-1)?.uuid).toBe(a.uuid);
    expect(next.players.player1.deck).toEqual([b, c]);
    expect(room.players.player1.deck).toEqual([a, b, c]);
  });

  it('schedules a shuffle trigger for an empty library and records its actual event history', () => {
    const room = createTestRoom();
    const watcher = room.players.player1.hand.pop()!;
    watcher.state.zone = 'battlefield';
    watcher.blueprint = { ...watcher.blueprint, onEnterEffects: [], abilities: [{ id: 'watch', type: 'triggered', triggerCondition: 'ON_SHUFFLE',
      castSpeed: 'instant', effect: { action: 'MODIFY_LIFE', params: { amount: 1 }, tags: [], targeting: { type: 'self' } } }] };
    room.battlefield = [watcher];
    const engine = new GameEngine(room);
    engine.initRoom();
    try {
      engine.applyMutations([shuffle([])]);
      expect(engine.roomState.stack).toHaveLength(1);
      expect(engine.roomState.turnHistory?.counts.LIBRARY_SHUFFLED).toBe(1);
      expect(engine.roomState.stack[0].type).toBe('triggered');
      engine.resolveTopOfStack();
      expect(engine.roomState.players.player1.life).toBe(21);
    } finally { engine.dispose(); }
  });

  it('resumes a serialized resolution choice using runtime dependencies supplied to the recovered engine', () => {
    const room = createTestRoom();
    fillTestLibraries(room, 3);
    const [a, b, c] = room.players.player1.deck;
    room.stack = [{ type: 'activated', uuid: 'optional', source: room.players.player1.hand[0], controllerId: 'player1', countered: false,
      effects: [{ action: 'SHUFFLE', params: {}, tags: [], targeting: { type: 'self' },
        choice: { kind: 'optional', prompt: 'Shuffle?' }, targets: [{ targetType: 'player', playerId: 'player1' }] }] }];
    const unused = vi.fn(() => 0.9);
    const original = new GameEngine(room, { random: unused });
    original.resolveTopOfStack();
    expect(unused).not.toHaveBeenCalled();
    const recoveredRandom = vi.fn(() => 0);
    const recovered = new GameEngine(JSON.parse(JSON.stringify(original.roomState)), { random: recoveredRandom });
    original.dispose();
    try {
      const choice = recovered.roomState.pendingChoice!;
      expect(recovered.executePlayerAction(choice.playerId, 'choose', { choiceId: choice.id, choices: ['yes'] }).success).toBe(true);
      expect(recoveredRandom).toHaveBeenCalledTimes(2);
      expect(recovered.roomState.players.player1.deck.map(card => card.uuid)).toEqual([b.uuid, c.uuid, a.uuid]);
      expect(recovered.drainEventBatches().flatMap(batch => batch.events).filter(event => event.eventId === 'LIBRARY_SHUFFLED')).toHaveLength(1);
    } finally { recovered.dispose(); }
  });

  it('keeps a prepared shuffle inside a paused transaction without early events or rerolling', () => {
    const room = createTestRoom({ replacementEffects: [{ id: 'cancel', label: 'Optional cancellation', match: { kinds: ['life_change'] },
      operation: { type: 'cancel_event' }, optional: true }] });
    fillTestLibraries(room, 3);
    const originalIds = room.players.player1.deck.map(card => card.uuid);
    const random = vi.fn(() => 0);
    const prepared = planLibraryShuffle(room, 'player1', random);
    const original = new GameEngine(room);
    original.applyMutations([...prepared, { type: 'CHANGE_LIFE', playerId: 'player2', amount: 1 }]);
    expect(original.roomState.players.player1.deck.map(card => card.uuid)).toEqual(originalIds);
    expect(original.drainEventBatches().flatMap(batch => batch.events).some(event => event.eventId === 'LIBRARY_SHUFFLED')).toBe(false);
    const neverReroll = vi.fn(() => { throw new Error('Prepared operation rerolled'); });
    const recovered = new GameEngine(JSON.parse(JSON.stringify(original.roomState)), { random: neverReroll });
    original.dispose();
    try {
      const choice = recovered.roomState.pendingChoice!;
      expect(recovered.executePlayerAction(choice.playerId, 'choose', { choiceId: choice.id, choices: ['skip:cancel'] }).success).toBe(true);
      expect(recovered.roomState.players.player1.deck.map(card => card.uuid)).toEqual([originalIds[1], originalIds[2], originalIds[0]]);
      expect(recovered.roomState.players.player2.life).toBe(21);
      expect(neverReroll).not.toHaveBeenCalled();
      expect(recovered.drainEventBatches().flatMap(batch => batch.events).filter(event => event.eventId === 'LIBRARY_SHUFFLED')).toHaveLength(1);
      expect(random).toHaveBeenCalledTimes(2);
    } finally { recovered.dispose(); }
  });

  it('rejects a semantic operation after game end and exposes explicit rejection reasons', () => {
    const room = createTestRoom();
    expect(reduceGameOperation(room, shuffle([], 'gone'))).toMatchObject({ status: 'rejected', state: room, reason: expect.any(String) });
    const terminal = { ...room, status: 'gameOver' as const };
    expect(reduceGameOperation(terminal, shuffle([]))).toMatchObject({ status: 'rejected', state: terminal, reason: 'Game is over' });
    expect(gameReducer(terminal, shuffle([]))).toBe(terminal);
  });

  it.each([-1, 1, NaN, Infinity])('rejects invalid random sample %s before changing library state', sample => {
    const room = createTestRoom();
    fillTestLibraries(room, 2);
    const before = JSON.stringify(room);
    expect(() => planLibraryShuffle(room, 'player1', () => sample)).toThrow('Random source');
    expect(JSON.stringify(room)).toBe(before);
  });
  it.each([0, 1, 3])('records a successful same-order shuffle of %i cards without artificial state changes', count => {
    const room = createTestRoom();
    fillTestLibraries(room, count);
    const deck = room.players.player1.deck;
    const instruction = shuffle(deck.map(reference));
    const engine = new GameEngine(room);
    try {
      expect(engine.applyMutations([instruction]).filter(mutation => mutation.type === 'SHUFFLE_LIBRARY')).toEqual([instruction]);
      expect(engine.roomState.players).toBe(room.players);
      expect(engine.roomState.players.player1.deck).toBe(deck);
      const batches = engine.drainEventBatches();
      expect(batches).toHaveLength(1);
      expect(batches[0].events.slice(0, 2).map(event => event.eventId)).toEqual(['MUTATION_APPLIED', 'LIBRARY_SHUFFLED']);
      expect(batches[0].events[1].payload).toEqual({ playerId: 'player1', controllerId: 'player1' });
      expect(new Set(batches[0].events.map(event => event.eventUuid)).size).toBe(batches[0].events.length);
      expect(gameReducer(room, instruction)).toBe(room);
    } finally { engine.dispose(); }
  });

  it('commits an explicit permutation while preserving every card incarnation', () => {
    const room = createTestRoom();
    fillTestLibraries(room, 3);
    const [a, b, c] = room.players.player1.deck;
    const instruction = shuffle([b, c, a].map(reference));
    const engine = new GameEngine(room);
    try {
      engine.applyMutations([instruction]);
      expect(engine.roomState.players.player1.deck).toEqual([b, c, a]);
      expect(engine.roomState.players.player1.deck[0]).toBe(b);
      expect(room.players.player1.deck).toEqual([a, b, c]);
      expect(engine.drainEventBatches().flatMap(batch => batch.events).filter(event => event.eventId === 'LIBRARY_SHUFFLED')).toHaveLength(1);
      const sync = new SyncService({} as never);
      const delta = sync.buildDelta(room, [instruction], { action: 'test', playerId: 'player1' });
      expect(applyDeltaChanges(room, delta.changes)).toEqual(gameReducer(room, instruction));
      expect(delta.changes.map(change => change.path)).toEqual(['players.player1.deck']);
    } finally { engine.dispose(); }
  });

  it.each(['missing-player', 'duplicate', 'stale', 'missing-card', 'wrong-zone'])('rejects %s permutation without state or success events', kind => {
    const room = createTestRoom();
    fillTestLibraries(room, 2);
    const order = room.players.player1.deck.map(reference);
    if (kind === 'duplicate') order[1] = order[0];
    if (kind === 'stale') order[0] = { ...order[0], zoneRevision: 1 };
    if (kind === 'missing-card') order.pop();
    if (kind === 'wrong-zone') room.players.player1.deck[0].state.zone = 'hand';
    const instruction = shuffle(order, kind === 'missing-player' ? 'gone' : 'player1');
    const engine = new GameEngine(room);
    try {
      expect(engine.applyMutations([instruction])).toEqual([]);
      expect(engine.roomState).toBe(room);
      expect(engine.drainEventBatches()).toEqual([]);
    } finally { engine.dispose(); }
  });

  it('retains existing redundant-setter and changed-setter semantics', () => {
    const room = createTestRoom();
    const engine = new GameEngine(room);
    try {
      expect(engine.applyMutations([{ type: 'SET_LIFE', playerId: 'player1', amount: 20 }])).toEqual([]);
      expect(engine.drainEventBatches()).toEqual([]);
      engine.applyMutations([{ type: 'SET_LIFE', playerId: 'player1', amount: 21 }]);
      expect(engine.drainEventBatches().flatMap(batch => batch.events).filter(event => event.eventId === 'LIFE_GAINED')).toHaveLength(1);
    } finally { engine.dispose(); }
  });

  it('retains semantic success inside an atomic damage result without duplicating events', () => {
    const room = createTestRoom();
    const source = room.players.player1.hand[0];
    const engine = new GameEngine(room);
    try {
      const instruction: GameMutation = { type: 'APPLY_DAMAGE_BATCH', replacementProcessed: true,
        assignments: [{ source: { card: source, power: 1, toughness: 1 }, recipient: { kind: 'player', playerId: 'player2' }, amount: 1, combat: false }],
        results: [shuffle([])] };
      engine.applyMutations([instruction]);
      expect(gameReducer(room, instruction)).toBe(room);
      expect(engine.roomState.players).toBe(room.players);
      expect(engine.roomState.turnHistory?.counts.DAMAGE_DEALT).toBe(1);
      const events = engine.drainEventBatches().flatMap(batch => batch.events);
      expect(events.filter(event => event.eventId === 'LIBRARY_SHUFFLED')).toHaveLength(1);
      expect(events.filter(event => event.eventId === 'DAMAGE_DEALT')).toHaveLength(1);
    } finally { engine.dispose(); }
  });

  it('syncs equal-state semantic commits as timeline data without a fabricated state delta', () => {
    const room = createTestRoom();
    const engine = new GameEngine(room);
    try {
      const mutations = engine.applyMutations([shuffle([])]);
      const batches = engine.drainEventBatches();
      const delta = new SyncService({} as never).buildDelta(room, mutations, { action: 'test', playerId: 'player1', batches });
      expect(delta.changes.map(change => change.path)).toEqual(['turnHistory']);
      expect(delta.batches?.flatMap(batch => batch.events).filter(event => event.eventId === 'LIBRARY_SHUFFLED')).toHaveLength(1);
      expect(applyDeltaChanges(room, delta.changes)).toEqual(engine.roomState);
      const encoded = JSON.parse(JSON.stringify(delta));
      const replayed = encoded.batches.flatMap((batch: { events: { eventId: string; payload: { mutation?: GameMutation } }[] }) =>
        batch.events.filter(event => event.eventId === 'MUTATION_APPLIED').map(event => event.payload.mutation));
      expect(replayed.reduce(gameReducer, room)).toEqual(engine.roomState);
    } finally { engine.dispose(); }
  });

  it('retains semantic events through the actual JSONL writer and reader', () => {
    const room = createTestRoom();
    const engine = new GameEngine(room);
    const directory = mkdtempSync(join(tmpdir(), 'card-game-outcome-'));
    try {
      const mutations = engine.applyMutations([shuffle([])]);
      const sync = new SyncService({} as never, join(directory, 'timeline.jsonl'));
      const delta = sync.buildDelta(room, mutations, { action: 'test', playerId: 'player1', batches: engine.drainEventBatches() });
      sync.appendToLog(delta);
      const [recorded] = sync.replay(room.roomId);
      expect(recorded.batches?.flatMap(batch => batch.events).filter(event => event.eventId === 'LIBRARY_SHUFFLED')).toHaveLength(1);
      expect(applyDeltaChanges(JSON.parse(JSON.stringify(room)), recorded.changes)).toEqual(JSON.parse(JSON.stringify(engine.roomState)));
    } finally { engine.dispose(); rmSync(directory, { recursive: true, force: true }); }
  });
});
