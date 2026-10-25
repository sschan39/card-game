import { afterEach, describe, expect, it, vi } from 'vitest';
import { GameEngine } from '@engine/game-engine';
import { type ActionResult } from '@engine/action-registry';
import { playCardHandler } from '@engine/handlers/play-card-handler';
import { normalizeCard } from '@library/card-parser';
import { instantiateCard } from '@library/card-factory';
import { buildStartingCardMutations, resolveRPS } from '@engine/room-factory';
import { SyncService } from '@server/rooms/sync-service';
import { createTestRoom, fillTestLibraries } from '../helpers/test-room-factory';
import { creature } from '../helpers/combat-fixture';
import { captureSourceInformation } from '@engine/source-information';
import type { GameRoom } from '@shared/game.room.types';
import type { GameMutation } from '@shared/game-mutation.types';

const engines: GameEngine[] = [];
afterEach(() => {
  engines.splice(0).forEach(engine => engine.dispose());
  vi.restoreAllMocks();
});
function engineFor(room: GameRoom) {
  const engine = new GameEngine(room); engine.initRoom(); engines.push(engine); return engine;
}
function freeze(value: unknown): void {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return;
  Object.freeze(value);
  Object.values(value).forEach(freeze);
}
/** Verify the exact old reference used for sync, including nested shared data. */
function checked(engine: GameEngine, operation: () => ActionResult | GameMutation[]) {
  const previous = engine.roomState;
  const baseline = structuredClone(previous);
  freeze(previous);
  const result = operation();
  if (!Array.isArray(result)) expect(result.success, !result.success ? result.reason : undefined).toBe(true);
  const mutations = Array.isArray(result) ? result : result.success ? result.mutations ?? [] : [];
  expect(previous).toEqual(baseline);
  const retained = new SyncService({} as never).buildDelta(previous, mutations, { action: 'test', playerId: 'player1' });
  const cloned = new SyncService({} as never).buildDelta(JSON.parse(JSON.stringify(baseline)), mutations, { action: 'test', playerId: 'player1' });
  expect(retained.changes).toEqual(cloned.changes);
  return result;
}
function answer(engine: GameEngine, choices: string[]) {
  const request = engine.roomState.pendingChoice!;
  return engine.executePlayerAction(request.playerId, 'choose', { choiceId: request.id, choices });
}
function spellRoom(optionalResolution = false) {
  const room = createTestRoom(); fillTestLibraries(room);
  const card = room.players.player1.hand[0];
  card.blueprint = normalizeCard({ id: 'cleanup-spell', cardTypes: ['Spell'], manaCost: '{R}',
    modes: [{ id: 'gain', label: 'Gain life', effects: [{ action: 'MODIFY_LIFE', params: { amount: 2 }, targeting: { type: 'self', required: false },
      ...(optionalResolution ? { choice: { kind: 'optional' } } : {}) }] }] });
  return { room, card };
}

describe('engine cleanup contracts', () => {
  it('validates a completed action once and pays its cost once', () => {
    const { room, card } = spellRoom(); const engine = engineFor(room);
    checked(engine, () => engine.executePlayerAction('player1', 'cast_spell', { cardUuid: card.uuid }));
    const validate = vi.spyOn(playCardHandler, 'validate');
    checked(engine, () => answer(engine, ['gain']));
    expect(validate).toHaveBeenCalledTimes(1);
    expect(engine.roomState.pendingChoice).toBeNull();
    expect(engine.roomState.players.player1.mana.red).toBe(4);
    expect(engine.roomState.stack).toHaveLength(1);
    checked(engine, () => engine.resolveTopOfStack());
    expect(engine.roomState.players.player1.life).toBe(22);
  });

  it('retains the request and pays nothing if completion is no longer legal', () => {
    const { room, card } = spellRoom(); const engine = engineFor(room);
    checked(engine, () => engine.executePlayerAction('player1', 'cast_spell', { cardUuid: card.uuid }));
    const id = engine.roomState.pendingChoice!.id;
    checked(engine, () => engine.applyMutations([{ type: 'SET_MANA', playerId: 'player1', color: 'red', amount: 0 }]));
    const previous = engine.roomState; const baseline = structuredClone(previous); freeze(previous);
    expect(answer(engine, ['gain']).success).toBe(false);
    expect(engine.roomState).toEqual(baseline);
    expect(engine.roomState.pendingChoice?.id).toBe(id);
    expect(engine.roomState.stack).toEqual([]);
  });

  it('preserves prior rooms through action choices, resolution choices and turn cleanup', () => {
    const { room, card } = spellRoom(true); const engine = engineFor(room);
    checked(engine, () => engine.executePlayerAction('player1', 'cast_spell', { cardUuid: card.uuid }));
    checked(engine, () => answer(engine, ['gain']));
    checked(engine, () => engine.resolveTopOfStack());
    expect(engine.roomState.pendingChoice?.continuation.type).toBe('resolution');
    checked(engine, () => answer(engine, ['yes']));
    expect(engine.roomState.players.player1.life).toBe(22);
    checked(engine, () => engine.advancePhase('skipToEnd'));
    checked(engine, () => engine.advancePhase('complete'));
  });

  it('keeps payment and stacking paused together when a completed action needs a replacement choice', () => {
    const { room, card } = spellRoom();
    card.blueprint = { ...card.blueprint, castRequirements: { ...card.blueprint.castRequirements,
      cost: { mana: { red: 1 }, discard: 1 } } };
    const discarded = instantiateCard('land-red');
    discarded.state = { ...discarded.state, zone: 'hand', ownerId: 'player1', controllerId: 'player1' };
    room.players.player1.hand.push(discarded);
    room.replacementEffects = [
      { id: 'exile', label: 'Exile instead', match: { kinds: ['discard'], from: 'hand', to: 'graveyard' }, operation: { type: 'move_destination', to: 'exile' } },
      { id: 'cancel', label: 'Cancel discard', match: { kinds: ['discard'], from: 'hand', to: 'graveyard' }, operation: { type: 'cancel_event' } },
    ];
    const engine = engineFor(room);
    checked(engine, () => engine.executePlayerAction('player1', 'cast_spell', { cardUuid: card.uuid }));
    checked(engine, () => answer(engine, ['gain']));
    expect(engine.roomState.pendingChoice?.kind).toBe('discard');
    checked(engine, () => answer(engine, [discarded.uuid]));
    expect(engine.roomState.pendingChoice?.continuation.type).toBe('replacement');
    expect(engine.roomState.players.player1.mana.red).toBe(5);
    expect(engine.roomState.stack).toEqual([]);
    checked(engine, () => answer(engine, ['exile']));
    expect(engine.roomState.pendingChoice).toBeNull();
    expect(engine.roomState.players.player1.mana.red).toBe(4);
    expect(engine.roomState.players.player1.exile?.map(card => card.uuid)).toContain(discarded.uuid);
    expect(engine.roomState.stack).toHaveLength(1);
    checked(engine, () => engine.resolveTopOfStack());
    expect(engine.roomState.players.player1.life).toBe(22);
  });

  it('preserves a state-based choice and commits only the chosen legend removal', () => {
    const first = creature('legend-one', 'player1'); const second = creature('legend-two', 'player1');
    for (const card of [first, second]) card.blueprint = { ...card.blueprint, name: 'Same legend', superTypes: ['Legendary'] };
    const engine = engineFor(createTestRoom({ battlefield: [first, second] }));
    checked(engine, () => engine.applyMutations([{ type: 'CHANGE_LIFE', playerId: 'player1', amount: 1 }]));
    const choice = engine.roomState.pendingChoice!;
    expect(choice.continuation.type).toBe('state_based');
    if (choice.kind === 'number') throw new Error('Expected legend selection');
    checked(engine, () => answer(engine, [choice.options[0].id]));
    expect(engine.roomState.pendingChoice).toBeNull();
    expect(engine.roomState.battlefield).toHaveLength(1);
    expect(engine.roomState.players.player1.graveyard).toHaveLength(1);
  });

  it('preserves setup snapshots when dealing and advancing into play', () => {
    const room = createTestRoom({ status: 'RPS', rpsState: { status: 'playing', playedCards: { player1: 'rock', player2: 'scissors' } } });
    const engine = engineFor(room);
    checked(engine, () => engine.applyMutations(resolveRPS(engine.roomState)));
    checked(engine, () => engine.applyMutations(buildStartingCardMutations(engine.roomState)));
    checked(engine, () => engine.advancePhase('complete'));
    expect(engine.roomState.status).toBe('playing');
    expect(engine.roomState.players.player1.hand.length).toBeGreaterThan(0);
  });

  it('preserves replacement continuations and resumes only the selected transaction', () => {
    const room = createTestRoom({ battlefield: [creature('source', 'player1')], replacementEffects: [
      { id: 'one', label: 'Double damage', match: { kinds: ['damage'] }, operation: { type: 'damage_scale', factor: 2 } },
      { id: 'two', label: 'Triple damage', match: { kinds: ['damage'] }, operation: { type: 'damage_scale', factor: 3 } },
    ] });
    const engine = engineFor(room);
    checked(engine, () => engine.applyMutations([{ type: 'APPLY_DAMAGE_BATCH', assignments: [{
      source: captureSourceInformation(engine.roomState, engine.roomState.battlefield[0]), recipient: { kind: 'player', playerId: 'player2' }, amount: 2, combat: false,
    }] }]));
    expect(engine.roomState.pendingChoice?.continuation.type).toBe('replacement');
    checked(engine, () => answer(engine, ['one']));
    expect(engine.roomState.pendingChoice).toBeNull();
    expect(engine.roomState.players.player2.life).toBe(8);
  });

  it('preserves combat choices and resolves a dying creature’s trigger', () => {
    const attacker = creature('attacker', 'player1', 2, 2);
    const blocker = creature('blocker', 'player2', 2, 2);
    blocker.blueprint = normalizeCard({ id: 'death-observer', cardTypes: ['Creature'], power: 2, toughness: 2,
      abilities: [{ id: 'death', type: 'triggered', triggerCondition: 'ON_DIE', effectId: 'MODIFY_LIFE', params: { amount: 1 }, targeting: { type: 'self', required: false } }] });
    const room = createTestRoom({ phase: 'declareAttackersStep', priorityPlayerId: null, battlefield: [attacker, blocker] });
    fillTestLibraries(room); const engine = engineFor(room);
    const pass = (player: string) => checked(engine, () => engine.executePlayerAction(player, 'pass_priority'));
    checked(engine, () => engine.executePlayerAction('player1', 'declare_attackers', { attackers: [{ cardUuid: attacker.uuid }] }));
    pass('player1'); pass('player2');
    checked(engine, () => engine.executePlayerAction('player2', 'declare_blockers', { assignments: [{ attackerUuid: attacker.uuid, blockerUuids: [blocker.uuid] }] }));
    pass('player1'); pass('player2');
    while (engine.roomState.pendingChoice?.continuation.type === 'combat') {
      const choice = engine.roomState.pendingChoice;
      checked(engine, () => engine.executePlayerAction(choice.playerId, 'choose', { choiceId: choice.id, allocations: { [choice.options[0].id]: choice.total } }));
    }
    expect(engine.roomState.players.player1.graveyard.map(card => card.uuid)).toContain(attacker.uuid);
    expect(engine.roomState.players.player2.graveyard.map(card => card.uuid)).toContain(blocker.uuid);
    expect(engine.roomState.stack).toHaveLength(1);
    checked(engine, () => engine.resolveTopOfStack());
    expect(engine.roomState.players.player2.life).toBe(21);
  });
});
