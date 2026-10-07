import { describe, expect, it } from 'vitest';
import { createTestRoom } from '../helpers/test-room-factory';
import { instantiateCard } from '../../src/library/card-factory';
import { GameEngine } from '../../src/engine/game-engine';
import { registerAction } from '../../src/engine/action-registry';
import { activateAbilityHandler } from '../../src/engine/handlers/activate-ability-handler';
import { playCardHandler } from '../../src/engine/handlers/play-card-handler';
import { tapForManaHandler } from '../../src/engine/handlers/tap-for-mana-handler';
import type { ActionCost } from '../../src/types/effect.types';

function fixture(cost: ActionCost) {
  registerAction('activate_ability', activateAbilityHandler);
  registerAction('cast_spell', playCardHandler);
  registerAction('tapForMana', tapForManaHandler);
  const room = createTestRoom();
  const source = instantiateCard('card_09876_core_set');
  source.state = { ...source.state, zone: 'battlefield', ownerId: 'player1', controllerId: 'player1', summoningSickness: false };
  const ability = source.blueprint.abilities[0];
  if (ability.type !== 'activated') throw new Error('fixture');
  source.blueprint = { ...source.blueprint, abilities: [{ ...ability, cost, effect: { action: 'MODIFY_LIFE', params: { amount: 2 }, targeting: { type: 'self', required: false } } }] };
  room.battlefield = [source];
  const engine = new GameEngine(room); engine.initRoom();
  return { engine, source, discard: room.players.player1.hand[0] };
}
const activate = (engine: GameEngine, sourceUuid: string, data: Record<string, unknown> = {}) => engine.executePlayerAction('player1', 'activate_ability', { cardUuid: sourceUuid, abilityId: 'firebreathing', ...data });

describe('shared cost transactions', () => {
  it('commits mana, life, tapping, discard and source sacrifice together, retaining the paid costs after countering', () => {
    const { engine, source, discard } = fixture({ mana: { red: 1 }, life: 2, tap: true, discard: 1, sacrifice: true });
    expect(activate(engine, source.uuid, { discardUuids: [discard.uuid] }).success).toBe(true);
    expect(engine.roomState.players.player1).toMatchObject({ life: 18, mana: { red: 4 }, hand: [] });
    expect(engine.roomState.battlefield).toEqual([]);
    expect(engine.roomState.players.player1.graveyard.map(c => c.uuid).sort()).toEqual([source.uuid, discard.uuid].sort());
    expect(engine.roomState.stack[0].type).toBe('activated');
    engine.applyMutations([{ type: 'SET_COUNTERED', stackUuid: engine.roomState.stack[0].uuid }]);
    engine.resolveTopOfStack();
    expect(engine.roomState.players.player1.life).toBe(18);
    expect(engine.roomState.players.player1.mana.red).toBe(4);
    engine.dispose();
  });
  it('rejects incomplete, duplicated, foreign or source discard selections without paying anything', () => {
    for (const selected of [[], ['missing'], ['source'], ['duplicate', 'duplicate']]) {
      const { engine, source, discard } = fixture({ mana: { red: 1 }, life: 2, tap: true, discard: 1 });
      const ids = selected?.map(id => id === 'source' ? source.uuid : id === 'duplicate' ? discard.uuid : id);
      const before = structuredClone(engine.roomState);
      expect(activate(engine, source.uuid, { discardUuids: ids }).success).toBe(false);
      expect(engine.roomState).toEqual(before); engine.dispose();
    }
  });
  it('pays untap costs and rejects unavailable or contradictory orientation costs', () => {
    const { engine, source } = fixture({ untap: true }); source.state.isTapped = true;
    expect(activate(engine, source.uuid).success).toBe(true);
    expect(engine.roomState.battlefield[0].state.isTapped).toBe(false); engine.dispose();
    for (const cost of [{ untap: true }, { tap: true, untap: true }]) {
      const { engine, source } = fixture(cost); const before = structuredClone(engine.roomState);
      expect(activate(engine, source.uuid).success).toBe(false); expect(engine.roomState).toEqual(before); engine.dispose();
    }
  });
  it('uses selected mana abilities during payment and rolls them back when the final cost cannot be paid', () => {
    for (const redCost of [1, 2]) {
      const { engine, source } = fixture({ mana: { red: redCost } });
      const land = instantiateCard('land-red');
      land.state = { ...land.state, zone: 'battlefield', ownerId: 'player1', controllerId: 'player1' };
      engine.roomState.battlefield.push(land); engine.roomState.players.player1.mana.red = 0;
      const before = structuredClone(engine.roomState);
      const result = activate(engine, source.uuid, { manaActivations: [{ cardUuid: land.uuid, abilityId: 'produce-red' }] });
      expect(result.success).toBe(redCost === 1);
      if (redCost === 1) {
        expect(engine.roomState.players.player1.mana.red).toBe(0);
        expect(engine.roomState.battlefield.find(c => c.uuid === land.uuid)?.state.isTapped).toBe(true);
        expect(engine.roomState.stack).toHaveLength(1);
      } else expect(engine.roomState).toEqual(before);
      engine.dispose();
    }
  });
  it('does not pay the same tap cost twice when a mana activation uses the final source', () => {
    const { engine, source } = fixture({ mana: { red: 1 }, tap: true });
    source.blueprint = { ...source.blueprint, abilities: [...source.blueprint.abilities, { id: 'mana', type: 'activated', castSpeed: 'instant', cost: { tap: true }, effect: { action: 'ADD_MANA', params: { color: 'red', amount: 1 }, targeting: { type: 'self', required: false } } }] };
    engine.roomState.players.player1.mana.red = 0; const before = structuredClone(engine.roomState);
    expect(activate(engine, source.uuid, { manaActivations: [{ cardUuid: source.uuid, abilityId: 'mana' }] }).success).toBe(false);
    expect(engine.roomState).toEqual(before); engine.dispose();
  });
  it('casting shares discard payment and cannot discard the card being cast', () => {
    const { engine, discard: spell } = fixture({});
    const other = instantiateCard('land-red'); other.state = { ...other.state, zone: 'hand', ownerId: 'player1', controllerId: 'player1' };
    engine.roomState.players.player1.hand.push(other);
    spell.blueprint = { ...spell.blueprint, castRequirements: { ...spell.blueprint.castRequirements, cost: { mana: { red: 1 }, discard: 1 } } };
    const before = structuredClone(engine.roomState);
    expect(engine.executePlayerAction('player1', 'cast_spell', { cardUuid: spell.uuid, discardUuids: [spell.uuid] }).success).toBe(false);
    expect(engine.roomState).toEqual(before);
    expect(engine.executePlayerAction('player1', 'cast_spell', { cardUuid: spell.uuid, discardUuids: [other.uuid] }).success).toBe(true);
    expect(engine.roomState.players.player1.graveyard.map(c => c.uuid)).toContain(other.uuid);
    expect(engine.roomState.stack[0].source.uuid).toBe(spell.uuid); engine.dispose();
  });
  it('mana abilities use the same discard and sacrifice transaction without entering the stack', () => {
    const { engine, source, discard } = fixture({ discard: 1, sacrifice: true });
    const ability = source.blueprint.abilities[0];
    if (ability.type !== 'activated') throw new Error('fixture');
    source.blueprint = { ...source.blueprint, abilities: [{ ...ability, effect: { action: 'ADD_MANA', params: { color: 'red', amount: 2 }, targeting: { type: 'self', required: false } } }] };
    expect(engine.executePlayerAction('player1', 'tapForMana', { cardUuid: source.uuid, abilityId: 'firebreathing', discardUuids: [discard.uuid] }).success).toBe(true);
    expect(engine.roomState.players.player1.mana.red).toBe(7);
    expect(engine.roomState.players.player1.graveyard).toHaveLength(2);
    expect(engine.roomState.stack).toEqual([]); engine.dispose();
  });
  it('reserves the casting card across discard costs of mana abilities used during payment', () => {
    const { engine, discard: spell } = fixture({});
    const land = instantiateCard('land-red');
    land.state = { ...land.state, zone: 'battlefield', ownerId: 'player1', controllerId: 'player1' };
    const ability = land.blueprint.abilities[0];
    if (ability.type !== 'activated') throw new Error('fixture');
    land.blueprint = { ...land.blueprint, abilities: [{ ...ability, cost: { tap: true, discard: 1 } }] };
    engine.roomState.battlefield.push(land); engine.roomState.players.player1.mana.red = 0;
    const before = structuredClone(engine.roomState);
    expect(engine.executePlayerAction('player1', 'cast_spell', { cardUuid: spell.uuid, manaActivations: [{ cardUuid: land.uuid, abilityId: 'produce-red', discardUuids: [spell.uuid] }] }).success).toBe(false);
    expect(engine.roomState).toEqual(before); engine.dispose();
  });
  it('rejects malformed costs and nested mana selections without changing state', () => {
    for (const cost of [{ life: -1 }, { discard: 0.5 }, { loyalty: 1 }]) {
      const { engine, source } = fixture(cost); const before = structuredClone(engine.roomState);
      expect(activate(engine, source.uuid).success).toBe(false); expect(engine.roomState).toEqual(before); engine.dispose();
    }
    const { engine, source } = fixture({}); const before = structuredClone(engine.roomState);
    expect(activate(engine, source.uuid, { manaActivations: [{ cardUuid: source.uuid, manaActivations: [] }] }).success).toBe(false);
    expect(engine.roomState).toEqual(before); engine.dispose();
  });
});
