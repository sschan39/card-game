import { describe, expect, it } from 'vitest';
import { gameReducer, reduceGameOperation } from '../../src/engine/game-reducer';
import { GameEngine } from '../../src/engine/game-engine';
import { EffectRegistry } from '../../src/engine/effect-registry';
import * as libraryOperations from '../../src/engine/library-operations';
import { planProposedMutations } from '../../src/engine/proposed-events';
import { SyncService } from '../../src/server/sync-service';
import { applyDeltaChanges } from '../../src/client/store/deltaReducer';
import { createTestRoom, fillTestLibraries } from '../helpers/test-room-factory';
import type { CardInstance } from '../../src/types/card.types';
import type { GameMutation } from '../../src/types/game-mutation.types';
import type { StackEffect, StackObject } from '../../src/types/effect.types';

const ref = (card: CardInstance) => ({ cardUuid: card.uuid, zoneRevision: card.state.zoneRevision ?? 0 });
const pointer = (card: CardInstance) => ({ targetType: 'card' as const, zone: card.state.zone, ...ref(card) });
const reorder = (cards: CardInstance[], playerId = 'player1') => ({ type: 'REORDER_LIBRARY', playerId, order: cards.map(ref) } as GameMutation);
function setup() {
  const room = createTestRoom();
  fillTestLibraries(room, 4);
  const source = room.players.player1.hand[0];
  const object: StackObject = { type: 'activated', uuid: 'order', source, controllerId: 'player1', effects: [], countered: false };
  return { room, object };
}
function effect(action: string, params: Record<string, unknown>, cards: CardInstance[]): StackEffect {
  return { action, params, targets: cards.map(pointer), targeting: { type: 'self', required: false }, tags: [] };
}

describe('ordered library operations', () => {
  it.each(['top', 'bottom'] as const)('reorders a subset to %s without resetting cards and draws in requested order', placement => {
    const { room, object } = setup();
    const [a, b, c, d] = room.players.player1.deck;
    b.state.counters = { retained: 2 };
    b.state.damageTaken = 3;
    const before = structuredClone(room);
    expect(EffectRegistry.REORDER_LIBRARY).toBeTypeOf('function');
    const mutations = EffectRegistry.REORDER_LIBRARY(room, object, effect('REORDER_LIBRARY', { placement }, [b, d]));
    const next = mutations.reduce(gameReducer, room);
    expect(next.players.player1.deck).toEqual(placement === 'top' ? [a, c, d, b] : [d, b, a, c]);
    expect(next.players.player1.deck.find(card => card.uuid === b.uuid)).toBe(b);
    expect(next.players.player1.deck.find(card => card.uuid === b.uuid)?.state).toBe(b.state);
    expect(room).toEqual(before);
    const drawn = gameReducer(next, { type: 'DRAW_CARDS', playerId: 'player1', amount: placement === 'top' ? 2 : 4 });
    expect(drawn.players.player1.hand.slice(-2).map(card => card.uuid)).toEqual([b.uuid, d.uuid]);
  });

  it('records an exact full permutation and distinguishes equal reorder from shuffle', () => {
    const { room } = setup();
    const reversed = [...room.players.player1.deck].reverse();
    const result = reduceGameOperation(room, reorder(reversed));
    expect(result.status).toBe('committed');
    expect(result.state.players.player1.deck).toEqual(reversed);
    expect(result.status === 'committed' && result.events).toEqual([]);
    expect(reduceGameOperation(result.state, reorder(reversed)).status).toBe('unchanged');
    expect(reduceGameOperation(room, { type: 'SHUFFLE_LIBRARY', playerId: 'player1', order: room.players.player1.deck.map(ref) }).status).toBe('committed');
  });

  it.each(['duplicate', 'missing', 'stale', 'negative-revision', 'wrong-owner', 'wrong-zone', 'missing-player', 'malformed'])(
    'rejects a %s permutation without a partial reorder', kind => {
      const { room } = setup();
      const mutation = { type: 'REORDER_LIBRARY', playerId: 'player1', order: room.players.player1.deck.map(ref) };
      if (kind === 'duplicate') mutation.order[1] = mutation.order[0];
      if (kind === 'missing') mutation.order.pop();
      if (kind === 'stale') mutation.order[0].zoneRevision++;
      if (kind === 'negative-revision') mutation.order[0].zoneRevision = -1;
      if (kind === 'wrong-owner') room.players.player1.deck[0].state.ownerId = 'player2';
      if (kind === 'wrong-zone') room.players.player1.deck[0].state.zone = 'hand';
      if (kind === 'missing-player') mutation.playerId = 'gone';
      if (kind === 'malformed') mutation.order = null as never;
      const result = reduceGameOperation(room, mutation as GameMutation);
      expect(result.status).toBe('rejected');
      expect(result.state).toBe(room);
    });

  it('validates selected references before preparing a subset permutation', () => {
    const { room } = setup();
    const [a, b] = room.players.player1.deck;
    expect(libraryOperations.planLibraryReorder).toBeTypeOf('function');
    expect(libraryOperations.planLibraryReorder(room, 'player1', [], 'top')).toEqual([]);
    for (const selection of [[ref(a), ref(a)], [{ ...ref(a), zoneRevision: 9 }], [{ cardUuid: 'gone', zoneRevision: 0 }]]) {
      expect(libraryOperations.planLibraryReorder(room, 'player1', selection, 'top')).toEqual([]);
    }
    expect(libraryOperations.planLibraryReorder(room, 'player1', [ref(b)], 'sideways' as never)).toEqual([]);
  });

  it.each(['top', 'bottom'] as const)('transfers ordered cards to %s through the existing move reducer', placement => {
    const { room, object } = setup();
    const [a, b] = room.players.player2.deck.splice(0, 2);
    for (const card of [a, b]) card.state = { ...card.state, zone: 'hand', ownerId: 'player1', controllerId: 'player1', counters: { stale: 2 } };
    room.players.player1.hand.push(a, b);
    const existing = [...room.players.player1.deck];
    const moves = EffectRegistry.MOVE_ZONE(room, object, effect('MOVE_ZONE', { destination: 'library', libraryPlacement: placement }, [a, b]));
    const next = planProposedMutations(room, moves).mutations.reduce(gameReducer, room);
    expect(next.players.player1.deck.map(card => card.uuid)).toEqual((placement === 'top' ? [...existing, b, a] : [b, a, ...existing]).map(card => card.uuid));
    expect(next.players.player1.deck.find(card => card.uuid === a.uuid)?.state).toMatchObject({ zone: 'library', zoneRevision: 1, counters: {} });
    const drawn = gameReducer(next, { type: 'DRAW_CARDS', playerId: 'player1', amount: placement === 'top' ? 2 : 6 });
    expect(drawn.players.player1.hand.slice(-2).map(card => card.uuid)).toEqual([a.uuid, b.uuid]);
  });

  it.each(['stale', 'index-and-placement', 'bad-placement', 'bad-index'] as const)('rejects %s original moves before consuming replacements', kind => {
    const { room } = setup();
    const card = room.players.player1.hand[0];
    room.replacementEffects = [{ id: 'cancel', label: 'Cancel', operation: { type: 'cancel_event' }, match: { kinds: ['zone_transfer'] }, uses: 1 }];
    const mutation = { type: 'MOVE_CARD', playerId: 'player1', cardUuid: card.uuid, from: 'hand', to: 'library', libraryPlacement: 'top', zoneRevision: 0 } as Extract<GameMutation, { type: 'MOVE_CARD' }>;
    if (kind === 'stale') mutation.zoneRevision = 1;
    if (kind === 'index-and-placement') mutation.toIndex = 0;
    if (kind === 'bad-placement') mutation.libraryPlacement = 'sideways' as never;
    if (kind === 'bad-index') { delete mutation.libraryPlacement; mutation.toIndex = -1; }
    expect(gameReducer(room, mutation)).toBe(room);
    expect(planProposedMutations(room, [mutation])).toEqual({ mutations: [] });
    expect(room.replacementEffects[0].uses).toBe(1);
  });

  it.each([['top', 'redirect'], ['bottom', 'redirect'], ['top', 'cancel'], ['bottom', 'cancel']] as const)('preserves surviving %s order after serialized %s replacement', (placement, operation) => {
    const { room, object } = setup();
    const moved = room.players.player2.deck.splice(0, 3);
    for (const card of moved) card.state = { ...card.state, zone: 'hand', ownerId: 'player1', controllerId: 'player1' };
    room.players.player1.hand.push(...moved);
    const [a, b, c] = moved;
    const existing = room.players.player1.deck.map(card => card.uuid);
    room.replacementEffects = [{ id: 'replace', label: 'Replace move', optional: true, operation: operation === 'redirect' ? { type: 'move_destination', to: 'exile' } : { type: 'cancel_event' },
      match: { kinds: ['zone_transfer'], card: ref(b) }, uses: 1 }];
    const original = new GameEngine(room);
    original.applyMutations(EffectRegistry.MOVE_ZONE(room, object, effect('MOVE_ZONE', { destination: 'library', libraryPlacement: placement }, moved)));
    expect(original.roomState.pendingChoice?.continuation.type).toBe('replacement');
    expect(original.roomState.players.player1.deck.map(card => card.uuid)).toEqual(existing);
    const recovered = new GameEngine(JSON.parse(JSON.stringify(original.roomState)));
    original.dispose();
    try {
      const choice = recovered.roomState.pendingChoice!;
      expect(recovered.executePlayerAction(choice.playerId, 'choose', { choiceId: choice.id, choices: ['replace'] }).success).toBe(true);
      expect(recovered.roomState.players.player1.deck.map(card => card.uuid)).toEqual(placement === 'top' ? [...existing, c.uuid, a.uuid] : [c.uuid, a.uuid, ...existing]);
      expect(recovered.roomState.players.player1.exile?.map(card => card.uuid) ?? []).toEqual(operation === 'redirect' ? [b.uuid] : []);
      expect(recovered.roomState.players.player1.hand.some(card => card.uuid === b.uuid)).toBe(operation === 'cancel');
    } finally { recovered.dispose(); }
  });

  it('keeps each owner library ordered when transfers are interleaved', () => {
    const { room, object } = setup();
    const [a, b] = room.players.player1.deck.splice(0, 2);
    const [c, d] = room.players.player2.deck.splice(0, 2);
    for (const card of [a, b, c, d]) { card.state.zone = 'hand'; room.players[card.state.ownerId].hand.push(card); }
    const moves = EffectRegistry.MOVE_ZONE(room, object, effect('MOVE_ZONE', { destination: 'library', libraryPlacement: 'top' }, [a, c, b, d]));
    const next = moves.reduce(gameReducer, room);
    expect(next.players.player1.deck.slice(-2).map(card => card.uuid)).toEqual([b.uuid, a.uuid]);
    expect(next.players.player2.deck.slice(-2).map(card => card.uuid)).toEqual([d.uuid, c.uuid]);
  });

  it.each(['same-zone-mix', 'duplicate', 'bad-destination', 'bad-origin', 'bad-placement', 'non-library-placement', 'stale', 'non-card-target', 'missing-card-id', 'immovable-token'])(
    'rejects %s placed effect input before producing any moves', kind => {
      const { room, object } = setup();
      const hand = room.players.player1.hand[0];
      const request = effect('MOVE_ZONE', { destination: 'library', libraryPlacement: 'top' }, [hand]);
      if (kind === 'same-zone-mix') request.targets.push(pointer(room.players.player1.deck[0]));
      if (kind === 'duplicate') request.targets.push(pointer(hand));
      if (kind === 'bad-destination') request.params.destination = 'gone';
      if (kind === 'bad-origin') request.params.origin = 'gone';
      if (kind === 'bad-placement') request.params.libraryPlacement = 'sideways';
      if (kind === 'non-library-placement') request.params.destination = 'graveyard';
      if (kind === 'stale') request.targets[0].zoneRevision = 5;
      if (kind === 'non-card-target') request.targets.push({ targetType: 'player', playerId: 'player1' });
      if (kind === 'missing-card-id') request.targets.push({ targetType: 'card' });
      if (kind === 'immovable-token') hand.isToken = true;
      expect(EffectRegistry.MOVE_ZONE(room, object, request)).toEqual([]);
    });

  it('rejects mixed-owner and duplicate reorder effect selections', () => {
    const { room, object } = setup();
    const a = room.players.player1.deck[0], b = room.players.player2.deck[0];
    expect(EffectRegistry.REORDER_LIBRARY(room, object, effect('REORDER_LIBRARY', { placement: 'top' }, [a, b]))).toEqual([]);
    expect(EffectRegistry.REORDER_LIBRARY(room, object, effect('REORDER_LIBRARY', { placement: 'top' }, [a, a]))).toEqual([]);
  });

  it('logs a changed permutation and syncs only its deck without shuffle/zone events', () => {
    const { room } = setup();
    const engine = new GameEngine(room);
    try {
      const instruction = reorder([...room.players.player1.deck].reverse());
      const mutations = engine.applyMutations([instruction]);
      const batches = engine.drainEventBatches();
      expect(batches.flatMap(batch => batch.events).map(event => event.eventId)).toEqual(['MUTATION_APPLIED']);
      expect(batches[0].mutations).toEqual([instruction]);
      const delta = new SyncService({} as never).buildDelta(room, mutations, { action: 'test', playerId: 'player1', batches });
      expect(delta.changes.map(change => change.path)).toEqual(['players.player1.deck']);
      expect(applyDeltaChanges(room, JSON.parse(JSON.stringify(delta.changes)))).toEqual(JSON.parse(JSON.stringify(engine.roomState)));
    } finally { engine.dispose(); }
  });
});
