import { describe, expect, it } from 'vitest';
import { GameEngine } from '../../src/engine/game-engine';
import { registerAction } from '../../src/engine/action-registry';
import { activateAbilityHandler } from '../../src/engine/handlers/activate-ability-handler';
import { instantiateCard } from '../../src/library/card-factory';
import { normalizeCard } from '../../src/library/card-parser';
import { OptionService } from '../../src/engine/option-service';
import { CardCharacteristicService } from '../../src/engine/card-characteristic-service';
import { createTestRoom } from '../helpers/test-room-factory';

function fixture() {
  registerAction('activate_ability', activateAbilityHandler);
  const room = createTestRoom();
  const card = instantiateCard('card_09876_core_set');
  card.blueprint = structuredClone(card.blueprint);
  card.state = { ...card.state, zone: 'battlefield', ownerId: 'player1', controllerId: 'player1', summoningSickness: true };
  room.battlefield = [card];
  const engine = new GameEngine(room); engine.initRoom();
  return { engine, card };
}

describe('selected activated abilities', () => {
  it('collects an activated mode before payment and retains the selected effects on the stack', () => {
    const { engine, card } = fixture();
    const ability = card.blueprint.abilities[0];
    if (ability.type !== 'activated') throw new Error('fixture');
    card.blueprint = { ...card.blueprint, abilities: [{ ...ability,
      effect: { action: 'MODIFY_LIFE', params: { amount: 0 }, targeting: { type: 'self', required: false } },
      modes: [{ id: 'gain', label: 'Gain life', effects: [{ action: 'MODIFY_LIFE', params: { amount: 3 }, targeting: { type: 'self', required: false } }] }],
    }] };
    expect(engine.executePlayerAction('player1', 'activate_ability', { cardUuid: card.uuid, abilityId: ability.id }).success).toBe(true);
    expect(engine.roomState.pendingChoice?.kind).toBe('modes');
    expect(engine.roomState.players.player1.mana.red).toBe(5);
    expect(engine.executePlayerAction('player1', 'choose', { choiceId: engine.roomState.pendingChoice!.id, choices: ['gain'] }).success).toBe(true);
    expect(engine.roomState.players.player1.mana.red).toBe(4);
    expect(engine.roomState.stack[0].effects).toHaveLength(2);
    engine.resolveTopOfStack();
    expect(engine.roomState.players.player1.life).toBe(23);
    engine.dispose();
  });
  it('pays Hellkite once, retains its source and applies its buff only on resolution', () => {
    const { engine, card } = fixture();
    const before = engine.roomState.players.player1.mana.red;
    const option = new OptionService().getOptions(engine.roomState, 'player1', card.uuid, 'battlefield')[0];
    expect(option).toMatchObject({ actionId: 'activate_ability', data: { abilityId: 'firebreathing' }, disabled: false });
    expect(engine.executePlayerAction('player1', option.actionId, { cardUuid: card.uuid, ...option.data }).success).toBe(true);
    expect(engine.roomState.players.player1.mana.red).toBe(before - 1);
    expect(engine.roomState.battlefield.map(c => c.uuid)).toEqual([card.uuid]);
    expect(engine.roomState.stack[0]).toMatchObject({ type: 'activated', ability: { id: 'firebreathing' } });
    expect(CardCharacteristicService.resolvePower(engine.roomState, card)).toBe(5);
    engine.resolveTopOfStack();
    expect(CardCharacteristicService.resolvePower(engine.roomState, engine.roomState.battlefield[0])).toBe(6);
    expect(engine.roomState.stack).toEqual([]);
    expect(engine.roomState.battlefield).toHaveLength(1);
    engine.dispose();
  });
  it('rejects unknown IDs, other controllers, insufficient mana and unsupported costs without payment', () => {
    for (const kind of ['id', 'controller', 'mana', 'cost']) {
      const { engine, card } = fixture();
      if (kind === 'controller') card.state.controllerId = 'player2';
      if (kind === 'mana') engine.roomState.players.player1.mana.red = 0;
      if (kind === 'cost') card.blueprint.abilities[0] = { ...card.blueprint.abilities[0], cost: { loyalty: 0 } } as typeof card.blueprint.abilities[0];
      const before = structuredClone(engine.roomState);
      expect(engine.executePlayerAction('player1', 'activate_ability', { cardUuid: card.uuid, abilityId: kind === 'id' ? 'unknown' : 'firebreathing' }).success).toBe(false);
      expect(engine.roomState).toEqual(before); engine.dispose();
    }
  });
  it('keeps same-primitive abilities distinct and does not use client-supplied costs or effects', () => {
    const { engine, card } = fixture();
    const original = card.blueprint.abilities[0];
    if (original.type !== 'activated') throw new Error('fixture');
    card.blueprint = { ...card.blueprint, abilities: [original, { ...original, id: 'larger-buff', effect: { ...original.effect, params: { power: 2 } } }] };
    const options = new OptionService().getOptions(engine.roomState, 'player1', card.uuid, 'battlefield');
    expect(options.map(o => o.data?.abilityId)).toEqual(['firebreathing', 'larger-buff']);
    expect(engine.executePlayerAction('player1', 'activate_ability', { cardUuid: card.uuid, abilityId: 'larger-buff', cost: {}, effect: {} }).success).toBe(true);
    expect(engine.roomState.players.player1.mana.red).toBe(4);
    engine.resolveTopOfStack();
    expect(CardCharacteristicService.resolvePower(engine.roomState, card)).toBe(7); engine.dispose();
  });
  it('validates timing and priority for the selected definition', () => {
    const { engine, card } = fixture();
    const ability = card.blueprint.abilities[0];
    if (ability.type !== 'activated') throw new Error('fixture');
    card.blueprint = { ...card.blueprint, abilities: [{ ...ability, castSpeed: 'sorcery' }] };
    engine.roomState.phase = 'upkeepStep';
    expect(engine.executePlayerAction('player1', 'activate_ability', { cardUuid: card.uuid, abilityId: ability.id }).success).toBe(false);
    card.blueprint = { ...card.blueprint, abilities: [ability] };
    engine.roomState.priorityPlayerId = 'player2';
    expect(engine.executePlayerAction('player1', 'activate_ability', { cardUuid: card.uuid, abilityId: ability.id }).success).toBe(false);
    engine.roomState.priorityPlayerId = 'player1';
    expect(engine.executePlayerAction('player1', 'activate_ability', { cardUuid: card.uuid, abilityId: ability.id }).success).toBe(true);
    engine.dispose();
  });
  it('rejects duplicate authored ability IDs during normalization', () => {
    expect(() => normalizeCard({ id: 'fixture', abilities: [{ id: 'same' }, { id: 'same' }] })).toThrow(/ability.*ID/i);
  });
});
