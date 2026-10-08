import { describe, expect, it } from 'vitest';
import { discoverTriggers } from '../../src/engine/trigger-manager';
import { normalizeAbility } from '../../src/library/card-parser';
import { instantiateCard } from '../../src/library/card-factory';
import type { TriggeredAbility, CardInstance } from '../../src/types/card.types';

function source(trigger?: TriggeredAbility['trigger']): CardInstance {
  const card = instantiateCard('empire-servant');
  card.state = { ...card.state, zone: 'battlefield', ownerId: 'p1', controllerId: 'p1', zoneRevision: 0 };
  card.blueprint = { ...card.blueprint, abilities: [{ id: 'test', type: 'triggered', castSpeed: 'instant', triggerCondition: 'ON_ENTER_BATTLEFIELD', trigger,
    effect: { action: 'MODIFY_LIFE', params: { amount: 1 }, targeting: { type: 'self', required: false } } }] };
  return card;
}
function enter(card: CardInstance, battlefield: CardInstance[]) {
  return discoverTriggers({ eventId: 'PERMANENT_ENTERED', roomId: 'test', payload: { card, controllerId: card.state.controllerId } }, { roomId: 'test', battlefield });
}
describe('declarative trigger matching', () => {
  it('defaults a card event to this object rather than every battlefield ability', () => {
    const a = source(), b = source();
    expect(enter(a, [a, b]).map(trigger => trigger.source.uuid)).toEqual([a.uuid]);
  });
  it('matches another creature controlled by the source controller', () => {
    const watcher = source({ subject: 'another', controller: 'self', cardTypes: ['Creature'], subTypes: ['Servant'] }), other = source();
    other.blueprint = { ...other.blueprint, subTypes: ['Servant'], abilities: [] };
    expect(enter(watcher, [watcher])).toEqual([]);
    expect(enter(other, [watcher, other])).toHaveLength(1);
    other.state.controllerId = 'p2'; expect(enter(other, [watcher, other])).toEqual([]);
    other.state.controllerId = 'p1'; other.blueprint = { ...other.blueprint, cardTypes: ['Land'] };
    expect(enter(other, [watcher, other])).toEqual([]);
  });
  it('uses original object revision when matching self', () => {
    const current = source(), previous = { ...current, state: { ...current.state, zoneRevision: 1 } };
    expect(enter(previous, [current])).toEqual([]);
  });
  it('legacy entry effects run only for the entering object', () => {
    const a = source(), b = source();
    for (const card of [a, b]) card.blueprint = { ...card.blueprint, abilities: [], onEnterEffects: [{ action: 'DRAW', params: { amount: 0 }, targeting: { type: 'self', required: false } }] };
    expect(enter(a, [a, b]).map(trigger => trigger.source.uuid)).toEqual([a.uuid]);
  });
  it('filters player and step events by the controller, with explicit opponent support', () => {
    const a = source(), b = source({ controller: 'opponent' });
    b.state.controllerId = 'p2';
    for (const card of [a, b]) card.blueprint = { ...card.blueprint, abilities: card.blueprint.abilities.map(ability => ({ ...ability, triggerCondition: 'BEGIN_UPKEEP' } as TriggeredAbility)) };
    const discover = (currentPlayer: string) => discoverTriggers({ eventId: 'UPKEEP_STARTED', roomId: 'test', payload: { currentPlayer } }, { roomId: 'test', battlefield: [a, b] });
    expect(discover('p1')).toHaveLength(2); expect(discover('p2')).toEqual([]);
  });
  it('retains authored predicates through normalization', () => {
    expect(normalizeAbility({ type: 'triggered', id: 'test', trigger: { subject: 'another', controller: 'opponent', cardTypes: ['Creature'] } })).toMatchObject({ trigger: { subject: 'another', controller: 'opponent', cardTypes: ['Creature'] } });
  });
});
