import { describe, expect, it } from 'vitest';
import { CardCharacteristicService as service } from '../../src/engine/card-characteristic-service';
import { createTestRoom } from '../helpers/test-room-factory';
import { creature } from '../helpers/combat-fixture';
import type { ContinuousEffectEntry } from '../../src/types/card.types';

function fixture() {
  const room = createTestRoom();
  const card = creature('subject', 'player1', 2, 4);
  room.battlefield = [card];
  const add = (effect: unknown, options: Record<string, unknown> = {}) => room.continuousEffectPool.push({
    source: 'global', layer: 7, effect, scope: { cardUuid: card.uuid }, duration: 'PERMANENT', ...options,
  } as ContinuousEffectEntry);
  return { room, card, add };
}
const resolve = (room: unknown, card: unknown): any => {
  expect((service as any).resolve).toBeTypeOf('function');
  return (service as any).resolve(room, card);
};

describe('continuous characteristic layers', () => {
  it('refreshes a static definition changed by an earlier text effect in the same layer', () => {
    const { room, card } = fixture(); Object.assign(card, { blueprint: { ...card.blueprint, rulesText: 'red' } });
    const first = creature('first', 'player1'), second = creature('second', 'player1');
    Object.assign(first, { blueprint: { ...first.blueprint, abilities: [{ id: 'rewrite', type: 'static', effects: [{ layer: 3, effect: { type: 'TEXT', replacements: { blue: 'green' } }, scope: { cardUuid: second.uuid } }] }] } });
    Object.assign(second, { blueprint: { ...second.blueprint, abilities: [{ id: 'rewrite', type: 'static', effects: [{ layer: 3, effect: { type: 'TEXT', replacements: { red: 'blue' } }, scope: { cardUuid: card.uuid } }] }] } });
    first.state.characteristicTimestamp = 1; second.state.characteristicTimestamp = 2; room.battlefield.push(first, second);
    expect(resolve(room, card).rulesText).toBe('green');
  });
  it('independently applies two granted instances of the same static ability', () => {
    const { room, card, add } = fixture();
    const ability = { id: 'boost', type: 'static', effects: [{ layer: 7, effect: { type: 'STAT_DELTA', power: 1 }, scope: { self: true } }] };
    add({ type: 'ABILITY', add: [ability] }, { id: 'first', timestamp: 1 });
    add({ type: 'ABILITY', add: [ability] }, { id: 'second', timestamp: 2 });
    expect(service.resolvePower(room, card)).toBe(4);
  });
  it('keeps a granted ability identity stable when an earlier duplicate grant expires', () => {
    const { room, card, add } = fixture();
    const ability = { id: 'boost', type: 'static', effects: [{ layer: 7, effect: { type: 'STAT_DELTA', power: 1 }, scope: { self: true } }] };
    add({ type: 'ABILITY', add: [ability] }, { id: 'first', timestamp: 1 });
    add({ type: 'ABILITY', add: [ability] }, { id: 'second', timestamp: 2 });
    const secondId = service.resolveAbilities(room, card)[1].id;
    room.continuousEffectPool.shift();
    expect(service.resolveAbilities(room, card)[0].id).toBe(secondId);
  });
  it('waits for a dependency cycle before applying an older outside dependent', () => {
    const { room, card, add } = fixture();
    Object.assign(card, { blueprint: { ...card.blueprint, cardTypes: ['Creature', 'Artifact'] } });
    add({ type: 'TYPE', add: ['Enchantment'] }, { layer: 4, timestamp: 1, scope: { cardTypes: ['Creature'] } });
    add({ type: 'TYPE', remove: ['Creature'] }, { layer: 4, timestamp: 2, scope: { cardTypes: ['Artifact'] } });
    add({ type: 'TYPE', remove: ['Artifact'] }, { layer: 4, timestamp: 3, scope: { cardTypes: ['Creature'] } });
    expect(resolve(room, card).cardTypes).toEqual(['Artifact']);
  });
  it('retains a multi-layer static effect after its ability is removed in a later layer', () => {
    const { room, card, add } = fixture();
    Object.assign(card, { blueprint: { ...card.blueprint, abilities: [{ id: 'animate', type: 'static', effects: [
      { layer: 4, effect: { type: 'TYPE', add: ['Artifact'] }, scope: { self: true } },
      { layer: 7, effect: { type: 'SET_STATS', power: 6, toughness: 6 }, scope: { self: true } },
    ] }] } });
    add({ type: 'ABILITY', removeAll: true }, { layer: 6 });
    expect(service.resolvePower(room, card)).toBe(6);
  });
  it('gained static effects use their grant timestamp', () => {
    const { room, card, add } = fixture();
    add({ type: 'SET_STATS', power: 3, toughness: 3 }, { timestamp: 5 });
    add({ type: 'ABILITY', add: [{ id: 'size', type: 'static', effects: [{ layer: 7,
      effect: { type: 'SET_STATS', power: 7, toughness: 7 }, scope: { self: true } }] }] }, { layer: 6, timestamp: 10 });
    expect(service.resolvePower(room, card)).toBe(7);
  });
  it('ordinary static creature bonuses do not apply in the hand', () => {
    const { room, card } = fixture();
    const source = creature('anthem', 'player1');
    Object.assign(source, { blueprint: { ...source.blueprint, abilities: [{ id: 'anthem', type: 'static', effects: [{ layer: 7,
      effect: { type: 'STAT_DELTA', power: 2 }, scope: { cardTypes: ['Creature'] } }] }] } });
    room.battlefield = [source]; card.state.zone = 'hand'; room.players.player1.hand = [card];
    expect(service.resolvePower(room, card)).toBe(2);
  });
  it('text substitutions do not change names or game identifiers', () => {
    const { room, card, add } = fixture();
    Object.assign(card, { blueprint: { ...card.blueprint, name: 'red Dragon', subTypes: ['Dragon'] } });
    card.state.controllerId = 'red';
    add({ type: 'TEXT', replacements: { red: 'blue', Dragon: 'Bird' } }, { layer: 3 });
    expect(resolve(room, card)).toMatchObject({ name: 'red Dragon', controllerId: 'red', subTypes: ['Bird'] });
  });
  it('does not invent dependency from a stat-setting operation that initially changes nothing', () => {
    const { room, card, add } = fixture();
    add({ type: 'SET_STATS', power: 8, toughness: 8 }, { timestamp: 1 });
    add({ type: 'SET_STATS', power: 2, toughness: 4 }, { timestamp: 2 });
    expect(service.resolvePower(room, card)).toBe(2);
  });

  it('applies a gained static ability within the ability layer', () => {
    const { room, card, add } = fixture();
    add({ type: 'ABILITY', add: [{ id: 'grant', type: 'static', effects: [{ layer: 6,
      effect: { type: 'ABILITY', addKeywords: ['Flying'] }, scope: { self: true } }] }] }, { layer: 6 });
    expect(service.resolveKeywords(room, card)).toEqual(['Flying']);
  });

  it('falls back to timestamps for dependency cycles', () => {
    const { room, card, add } = fixture();
    add({ type: 'TYPE', add: ['Artifact'], remove: ['Creature'] }, { layer: 4, timestamp: 1, scope: { cardTypes: ['Creature'] } });
    add({ type: 'TYPE', add: ['Creature'], remove: ['Artifact'] }, { layer: 4, timestamp: 2, scope: { cardTypes: ['Artifact'] } });
    expect(resolve(room, card).cardTypes).toEqual(['Creature']);
  });
  it('sets base stats, adds deltas and counters, then switches', () => {
    const { room, card, add } = fixture();
    card.state.counters['+1/+1'] = 1;
    add({ type: 'SWITCH_STATS' }, { timestamp: 1 });
    add({ type: 'STAT_DELTA', power: 2, toughness: 1 }, { timestamp: 2 });
    add({ type: 'SET_STATS', power: 3, toughness: 5 }, { timestamp: 3 });
    expect([service.resolvePower(room, card), service.resolveToughness(room, card)]).toEqual([7, 6]);
  });

  it('orders conflicts by timestamp rather than pool position', () => {
    const { room, card, add } = fixture();
    add({ type: 'SET_STATS', power: 8, toughness: 8 }, { timestamp: 20 });
    add({ type: 'SET_STATS', power: 3, toughness: 3 }, { timestamp: 10 });
    expect(service.resolvePower(room, card)).toBe(8);
  });

  it('supports negative counters and multiple switches', () => {
    const { room, card, add } = fixture();
    card.state.counters['-1/-1'] = 2;
    add({ type: 'SWITCH_STATS' }); add({ type: 'SWITCH_STATS' });
    expect([service.resolvePower(room, card), service.resolveToughness(room, card)]).toEqual([0, 2]);
  });

  it('copies copiable values before later changes without copying counters or damage', () => {
    const { room, card, add } = fixture();
    const donor = creature('donor', 'player2', 6, 7, ['Flying']);
    donor.state.counters['+1/+1'] = 4; donor.state.damageTaken = 2;
    room.battlefield.push(donor);
    add({ type: 'COPY', blueprint: donor.blueprint });
    add({ type: 'STAT_DELTA', power: 1 });
    expect(service.resolvePower(room, card)).toBe(7);
    expect(service.resolveKeywords(room, card)).toEqual(['Flying']);
    expect(card.blueprint.power).toBe(2);
  });

  it('resolves control, type, color and ability changes through one facade', () => {
    const { room, card, add } = fixture();
    add({ type: 'CONTROL', controllerId: 'player2' }, { layer: 2 });
    add({ type: 'TYPE', set: ['Artifact'], addSubTypes: ['Equipment'] }, { layer: 4 });
    add({ type: 'COLOR', set: ['blue'] }, { layer: 5 });
    add({ type: 'ABILITY', addKeywords: ['Flying', 'Hexproof'] }, { layer: 6 });
    const value = resolve(room, card);
    expect(value).toMatchObject({ controllerId: 'player2', cardTypes: ['Artifact'], subTypes: ['Equipment'], colors: ['blue'], keywords: ['Flying', 'Hexproof'] });
    expect(card.state.controllerId).toBe('player1');
  });

  it('applies text substitutions before type changes and keeps the blueprint immutable', () => {
    const { room, card, add } = fixture();
    card.blueprint = { ...card.blueprint, subTypes: ['Dragon'], keywords: ['Protection from red'], rulesText: 'red Dragon' } as any;
    add({ type: 'TEXT', replacements: { red: 'blue', Dragon: 'Bird' } }, { layer: 3 });
    const value = resolve(room, card);
    expect(value).toMatchObject({ subTypes: ['Bird'], keywords: ['Protection from blue'], rulesText: 'blue Bird' });
    expect(card.blueprint.subTypes).toEqual(['Dragon']);
  });

  it('dynamic static anthems apply to later entrants and stop on source departure', () => {
    const { room, card } = fixture();
    const source = creature('anthem', 'player1');
    source.blueprint = { ...source.blueprint, abilities: [{ id: 'anthem', type: 'static', effects: [{ layer: 7,
      effect: { type: 'STAT_DELTA', power: 2 }, scope: { cardTypes: ['Creature'], controller: 'self' } }] }] } as any;
    room.battlefield.push(source);
    expect(service.resolvePower(room, card)).toBe(4);
    const later = creature('later', 'player1'); room.battlefield.push(later);
    expect(service.resolvePower(room, later)).toBe(4);
    room.battlefield = room.battlefield.filter(c => c.uuid !== source.uuid);
    expect(service.resolvePower(room, card)).toBe(2);
  });

  it('removing a static ability stops its later-layer effect', () => {
    const { room, card, add } = fixture();
    card.blueprint = { ...card.blueprint, abilities: [{ id: 'buff', type: 'static', effects: [{ layer: 7,
      effect: { type: 'STAT_DELTA', power: 3 }, scope: { self: true } }] }] } as any;
    expect(service.resolvePower(room, card)).toBe(5);
    add({ type: 'ABILITY', removeAll: true }, { layer: 6 });
    expect(service.resolvePower(room, card)).toBe(2);
  });

  it('derives static control-relative scopes after control effects', () => {
    const { room, card, add } = fixture();
    const source = creature('anthem', 'player1');
    source.blueprint = { ...source.blueprint, abilities: [{ id: 'anthem', type: 'static', effects: [{ layer: 7,
      effect: { type: 'STAT_DELTA', power: 3 }, scope: { controller: 'self' } }] }] } as any;
    room.battlefield.push(source);
    add({ type: 'CONTROL', controllerId: 'player2' }, { layer: 2, scope: { cardUuid: source.uuid } });
    expect(service.resolvePower(room, card)).toBe(2);
    expect(service.resolvePower(room, source)).toBe(5);
  });

  it('detects same-layer scope dependencies despite reverse timestamps', () => {
    const { room, card, add } = fixture();
    add({ type: 'TYPE', add: ['Enchantment'] }, { layer: 4, timestamp: 1, scope: { cardTypes: ['Artifact'] } });
    add({ type: 'TYPE', add: ['Artifact'] }, { layer: 4, timestamp: 2 });
    expect(resolve(room, card).cardTypes).toEqual(['Creature', 'Artifact', 'Enchantment']);
  });

  it('evaluates characteristic-defining counts before setting/modifying stats', () => {
    const { room, card, add } = fixture();
    card.blueprint = { ...card.blueprint, abilities: [{ id: 'size', type: 'static', characteristicDefining: true,
      activeZones: ['battlefield', 'graveyard'], effects: [{ layer: 7, effect: { type: 'SET_STATS',
        power: { count: { cardTypes: ['Creature'], controller: 'self', zones: ['battlefield'] } }, toughness: 5 }, scope: { self: true } }] }] } as any;
    room.battlefield.push(creature('second', 'player1'));
    expect(service.resolvePower(room, card)).toBe(2);
    add({ type: 'SET_STATS', power: 4, toughness: 4 });
    add({ type: 'STAT_DELTA', power: 1 });
    expect(service.resolvePower(room, card)).toBe(5);
  });

  it('uses declared static zones and source/target revisions', () => {
    const { room, card, add } = fixture();
    const source = creature('graveyard-source', 'player1'); source.state.zone = 'graveyard';
    source.blueprint = { ...source.blueprint, abilities: [{ id: 'graveyard-anthem', type: 'static', activeZones: ['graveyard'],
      effects: [{ layer: 7, effect: { type: 'STAT_DELTA', power: 1 }, scope: { cardTypes: ['Creature'] } }] }] } as any;
    room.players.player1.graveyard.push(source);
    expect(service.resolvePower(room, card)).toBe(3);
    add({ type: 'STAT_DELTA', power: 3 }, { source: card.uuid, sourceRevision: 0, requiredZone: 'battlefield', scope: { cardUuid: card.uuid, zoneRevision: 0 } });
    expect(service.resolvePower(room, card)).toBe(6);
    card.state.zoneRevision = 2;
    expect(service.resolvePower(room, card)).toBe(3);
  });
});
