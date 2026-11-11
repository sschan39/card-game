import { describe, expect, it } from 'vitest';
import { activateAbilityHandler } from '@engine/handlers/activate-ability-handler';
import { newTurnHistory } from '@engine/turn-history';
import type { ActivatedAbility, CardInstance } from '@shared/card.types';
import type { ActionData } from '@engine/action-registry';
import type { GameRoom } from '@shared/game.room.types';
import { createTestRoom } from '../helpers/test-room-factory';
import { creature } from '../helpers/combat-fixture';

const draw = { action: 'DRAW', params: { amount: 1 }, tags: [], targeting: { type: 'self' as const, required: false } };

const activatedAbility = (overrides: Partial<ActivatedAbility> = {}): ActivatedAbility =>
  ({
    id: 'act-1',
    type: 'activated',
    castSpeed: 'instant',
    cost: {},
    effect: draw,
    ...overrides,
  }) as ActivatedAbility;

interface Fixture {
  room: GameRoom;
  card: CardInstance;
  action: ActionData;
}

function fixture(overrides: Partial<ActivatedAbility> = {}, action: ActionData = {}): Fixture {
  const card = creature('ability-source', 'player1');
  card.blueprint = { ...card.blueprint, abilities: [activatedAbility(overrides)] };
  const room = createTestRoom();
  room.battlefield = [card, creature('opponent-target', 'player2')];
  room.priorityPlayerId = 'player1';
  return { room, card, action: { cardUuid: 'ability-source', abilityId: 'act-1', ...action } };
}

const propose = (input: Fixture) => activateAbilityHandler.propose(input.room, 'player1', input.action);

describe('activate ability handler: successful activation', () => {
  it('pushes an activated stack object without a client stack uuid', () => {
    const input = fixture();
    const result = propose(input);

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.stackObject).toMatchObject({ type: 'activated', uuid: '', controllerId: 'player1' });
    expect(result.mutations?.some((mutation) => mutation.type === 'PUSH_STACK')).toBe(true);
    expect(result.mutations?.some((mutation) => mutation.type === 'RECORD_ABILITY_USE')).toBe(true);
  });

  it('keeps announced numeric bindings and the client stack uuid', () => {
    const input = fixture(
      { numericDeclarations: [{ name: 'X', min: 0, max: 3 }] },
      { stackUuid: 'client-stack', numericBindings: { X: 2 } },
    );
    const result = propose(input);

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.stackObject).toMatchObject({ uuid: 'client-stack', numericBindings: { X: 2 } });
  });

  it('accepts an explicit alternative cost route', () => {
    const input = fixture(
      { alternativeCosts: [{ id: 'alt', label: 'Alternative', cost: {} }] },
      { costRoute: { kind: 'alternative', id: 'alt' } },
    );

    expect(propose(input)).toMatchObject({ success: true });
  });
});

describe('activate ability handler: rejected activations', () => {
  it('rejects an unknown source, ability, mana ability and used-up budget', () => {
    const missingSource = fixture();
    expect(activateAbilityHandler.propose(missingSource.room, 'player1', { cardUuid: 'nope', abilityId: 'act-1' })).toMatchObject({
      success: false,
      phase: 'validate',
      reason: 'Ability source not found',
    });

    expect(activateAbilityHandler.propose(missingSource.room, 'player1', { cardUuid: 'ability-source', abilityId: 'other' })).toMatchObject({
      success: false,
      reason: 'Select a valid non-mana ability',
    });

    const mana = fixture({ effect: { ...draw, action: 'ADD_MANA' } });
    expect(propose(mana)).toMatchObject({ success: false, reason: 'Select a valid non-mana ability' });

    const limited = fixture({ limitPerTurn: 1 });
    limited.room.turnHistory = { ...newTurnHistory(1), uses: { 'ability-source:0:act-1': 1 } };
    expect(propose(limited)).toMatchObject({ success: false, reason: 'Ability use limit reached' });
  });

  it('rejects malformed and incomplete numeric announcements', () => {
    const duplicate = fixture({ numericDeclarations: [{ name: 'X', min: 0 }, { name: 'X', min: 1 }] });
    const duplicateResult = propose(duplicate);
    expect(duplicateResult.success).toBe(false);
    if (!duplicateResult.success) expect(duplicateResult.reason).toBeTruthy();

    const missing = fixture({ numericDeclarations: [{ name: 'X', min: 0 }] });
    expect(propose(missing)).toMatchObject({ success: false, reason: 'Choose all declared numbers' });

    const outOfRange = fixture({ numericDeclarations: [{ name: 'X', min: 2 }] }, { numericBindings: { X: 1 } });
    const outOfRangeResult = propose(outOfRange);
    expect(outOfRangeResult.success).toBe(false);
    if (!outOfRangeResult.success) expect(outOfRangeResult.reason).toBe('Invalid announced numeric binding');
  });

  it('requires a cost route when alternatives exist', () => {
    const input = fixture({ alternativeCosts: [{ id: 'alt', label: 'Alternative', cost: {} }] });

    expect(propose(input)).toMatchObject({ success: false, reason: 'Choose a cost route' });
  });

  it('defers to action validation for priority', () => {
    const input = fixture();
    input.room.priorityPlayerId = 'player2';

    expect(propose(input)).toMatchObject({ success: false, reason: 'You do not have priority to act right now.' });
  });

  it('rejects unknown modes and illegal targets', () => {
    const modes = fixture({
      modes: [{ id: 'm1', label: 'Mode', effects: [draw] }],
      modeCount: { min: 1, max: 1 },
    });
    expect(propose({ ...modes, action: { ...modes.action, modes: ['nope'] } })).toMatchObject({
      success: false,
      reason: 'Select valid modes',
    });

    const targeted = fixture({ effect: { action: 'DESTROY', params: {}, tags: [], targeting: { type: 'permanent', required: true } } });
    expect(propose({ ...targeted, action: { ...targeted.action, targets: [] } })).toMatchObject({
      success: false,
      reason: 'Target is not legal',
    });
  });

  it('rejects an unknown distribution for a legal target', () => {
    const input = fixture({
      effect: {
        action: 'DAMAGE',
        params: { amount: 1 },
        tags: [],
        choice: { kind: 'distribution', total: 1, field: 'amount' },
        targeting: { type: 'permanent', required: true },
      },
    });

    const result = propose({
      ...input,
      action: {
        ...input.action,
        targets: [{ targetType: 'permanent', cardUuid: 'opponent-target' }],
        distributions: { bogus: { 'permanent:opponent-target': 1 } },
      },
    });

    expect(result).toMatchObject({ success: false, reason: 'Unknown distribution' });
  });
});
