import { afterEach, describe, expect, it } from 'vitest';
import { GameEngine } from '@engine/game-engine';
import { OptionService } from '@engine/option-service';
import { normalizeCard } from '@library/card-parser';
import { instantiateCard } from '@library/card-factory';
import { createTestRoom } from '../helpers/test-room-factory';
import { creature } from '../helpers/combat-fixture';
import { composeActionCosts } from '@engine/cost-composition';

const engines: GameEngine[] = [];
afterEach(() => { engines.splice(0).forEach(engine => engine.dispose()); });
function fixture(allowedZones = ['hand']) {
  const source = instantiateCard('empire-servant');
  source.blueprint = normalizeCard({ id: 'hand-scorch-fixture', name: 'Hand source', cardTypes: ['Creature'], power: 1, toughness: 4,
    abilities: [{ id: 'discard-scorch', type: 'activated', allowedZones, castSpeed: 'instant', cost: { discardSelf: true },
      effectId: 'ADD_COUNTER', params: { counterType: 'scorch', amount: 2 }, targeting: { type: 'permanent', controller: 'opponent', required: true, cardTypes: ['Creature'], minTargets: 1, maxTargets: 1 } }] });
  source.state = { ...source.state, zone: 'hand', ownerId: 'player1', controllerId: 'player1' };
  const room = createTestRoom({ battlefield: [creature('target', 'player2', 2, 4)] });
  room.players.player1.hand = [source];
  const engine = new GameEngine(room); engine.initRoom(); engines.push(engine); return { engine, source };
}

describe('hand abilities with a source discard cost', () => {
  it('runs an ordered activated ability through the same resolution cursor', () => {
    const { engine, source } = fixture();
    source.blueprint = normalizeCard({ id: 'ordered-hand', name: 'Ordered hand', cardTypes: ['Creature'], power: 1, toughness: 4,
      abilities: [{ id: 'discard-scorch', type: 'activated', allowedZones: ['hand'], cost: { discardSelf: true }, effects: [
        { action: 'MODIFY_LIFE', params: { amount: 2 }, targeting: { type: 'self', required: false } },
        { action: 'DRAW', params: { amount: 1 }, targeting: { type: 'self', required: false } },
      ] }] });
    const drawn = instantiateCard('empire-servant'); drawn.state = { ...drawn.state, zone: 'library', ownerId: 'player1', controllerId: 'player1' };
    engine.roomState.players.player1.deck = [drawn];
    expect(engine.executePlayerAction('player1', 'activate_ability', { cardUuid: source.uuid, abilityId: 'discard-scorch' }).success).toBe(true);
    expect(engine.roomState.stack[0].effects).toHaveLength(2);
    expect(engine.resolveTopOfStack().success).toBe(true);
    expect(engine.roomState.players.player1.life).toBe(22);
    expect(engine.roomState.players.player1.hand.map(card => card.uuid)).toEqual([drawn.uuid]);
  });
  it('offers the hand ability, chooses before paying, then discards once and resolves from its retained source', () => {
    const { engine, source } = fixture();
    expect(new OptionService().getOptions(engine.roomState, 'player1', source.uuid, 'hand')).toContainEqual(expect.objectContaining({ actionId: 'activate_ability', data: { abilityId: 'discard-scorch' }, disabled: false }));
    expect(engine.executePlayerAction('player1', 'activate_ability', { cardUuid: source.uuid, abilityId: 'discard-scorch' }).success).toBe(true);
    expect(engine.roomState.players.player1.hand).toHaveLength(1);
    const choice = engine.roomState.pendingChoice!;
    if (choice.kind === 'number') throw new Error('Expected targets');
    expect(engine.executePlayerAction('player1', 'choose', { choiceId: choice.id, choices: [choice.options[0].id] }).success).toBe(true);
    expect(engine.roomState.players.player1.hand).toHaveLength(0);
    expect(engine.roomState.players.player1.graveyard.map(card => card.uuid)).toEqual([source.uuid]);
    expect(engine.roomState.stack[0].sourceInfo).toMatchObject({ card: { uuid: source.uuid, state: { zone: 'hand' } } });
    expect(engine.resolveTopOfStack().success).toBe(true);
    expect(engine.roomState.battlefield[0].state.counters.scorch).toBe(2);
    expect(engine.roomState.players.player1.graveyard).toHaveLength(1);
  });

  it('keeps ordinary abilities on the battlefield unless their definition admits hand', () => {
    const { engine, source } = fixture(['battlefield']); const before = structuredClone(engine.roomState);
    expect(engine.executePlayerAction('player1', 'activate_ability', { cardUuid: source.uuid, abilityId: 'discard-scorch' }).success).toBe(false);
    expect(engine.roomState).toEqual(before);
    expect(new OptionService().getOptions(engine.roomState, 'player1', source.uuid, 'hand').some(option => option.actionId === 'activate_ability')).toBe(false);
  });

  it('does not pay or open a target choice when the source is in the other player hand', () => {
    const { engine, source } = fixture(); const before = structuredClone(engine.roomState);
    expect(engine.executePlayerAction('player2', 'activate_ability', { cardUuid: source.uuid, abilityId: 'discard-scorch' }).success).toBe(false);
    expect(engine.roomState).toEqual(before);
  });

  it('does not collapse repeated source-discard costs', () => {
    expect(() => composeActionCosts([{ discardSelf: true }, { discardSelf: true }] as never)).toThrow(/same source cost twice/i);
  });
});
