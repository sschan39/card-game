import { describe, expect, it } from 'vitest';
import { parseCardDefinition, parseModifierDefinition } from '@card-game/engine/rules/parse';
import { getBlueprint } from '@library/card-catalog';
import baseline from '../fixtures/rule-contract-baseline.json';
import { cardDefinitionHash } from '../helpers/card-definition-hash';

const card = (extra = {}) => ({ schemaVersion: 1, id: 'contract-card', name: 'Contract card', cardTypes: ['Creature'], power: 2, toughness: 3, ...extra });
describe('shared rule contracts', () => {
  it('locks the catalog including explicit listener and usage declarations', () => {
    expect(cardDefinitionHash(Object.fromEntries(baseline.cardIds.map(id => [id, getBlueprint(id)])))).toBe(baseline.scorchRelicRevision.semanticCatalogHash);
  });
  it('compiles functional instructions through the same card loader', () => {
    const c = parseCardDefinition({ schemaVersion: 1, ...(card({ onEnterEffects: [{ family: 'cards', operation: 'draw', params: { amount: 1 }, targeting: { type: 'self', required: false } }] })) });
    expect(c.onEnterEffects?.[0]).toMatchObject({ action: 'DRAW', params: { amount: 1 } });
  });
  it.each([
    { unknownField: true }, { abilities: [{ id: 'x', type: 'activated', effectId: 'DRAW', params: { amount: 1 } }] },
    { onEnterEffects: [{ family: 'cards', operation: 'drwa', params: { amount: 1 } }] },
    { onEnterEffects: [{ family: 'cards', operation: 'draw', params: { ammount: 1 } }] },
    { onEnterEffects: [{ action: 'toString' }] },
    { onEnterEffects: [{ family: 'cards', operation: 'draw', params: { amount: -1 } }] },
    { castRequirements: { cost: { mana: null } } }, { castRequirements: { condition: { globalFlag: 'unimplemented' } } },
    { onPlay: [] }, { cardTypes: ['Creture'] },
    { abilities: [{ id: 'a', type: 'activated', duration: 'END_OF_TURN', effect: { action: 'DRAW', params: { amount: 1 } } }] },
    { abilities: [{ id: 'a', type: 'static', effects: [{ layer: 7, scope: { self: true }, effect: { type: 'STAT_DELTA', power: 1, manaReduction: 2 } }] }] },
    { abilities: [{ id: 'a', type: 'static', rules: [{ id: 'bad', family: 'costs', action: 'activate', scope: {}, operation: { type: 'mana.reduce', amount: 1, color: 'generic' } }] }] },
  ])('rejects malformed or unsupported authored data %j', extra => { expect(() => parseCardDefinition({ schemaVersion: 1, ...(card(extra)) })).toThrow(); });
  it('reports the card and offending field before normalization can discard it', () => {
    expect(() => parseCardDefinition({ schemaVersion: 1, ...(card({ costs: { red: 1 } })) })).toThrow('contract-card');
    expect(() => parseCardDefinition({ schemaVersion: 1, ...(card({ costs: { red: 1 } })) })).toThrow('costs');
  });
  it('rejects injected runtime metadata and incompatible families', () => {
    const base = { id: 'discount', family: 'costs', action: 'cast', scope: { cardTypes: ['Creature'] }, operation: { type: 'mana.reduce', color: 'generic', amount: 1 } };
    expect(parseModifierDefinition(base)).toMatchObject(base);
    expect(() => parseModifierDefinition({ ...base, source: { cardUuid: 'forged' } })).toThrow();
    expect(() => parseModifierDefinition({ ...base, operation: { type: 'STAT_DELTA', power: 1 } })).toThrow();
    expect(() => parseModifierDefinition({ ...base, condition: { op: 'gt', left: { path: 'event.payload.amount' }, right: 0 } })).toThrow('unavailable');
  });
  it('validates granted abilities through the same instruction and contextual contracts', () => {
    const grant = (ability: unknown) => card({ abilities: [{ id: 'grant', type: 'static', rules: [{ id: 'grant', family: 'characteristics', scope: { self: true },
      operation: { type: 'ABILITY', add: [ability] } }] }] });
    expect(() => parseCardDefinition(grant({ id: 'missing', type: 'activated' }))).toThrow();
    expect(() => parseCardDefinition(grant({ id: 'bad-context', type: 'static', effects: [], rules: [{ id: 'discount', family: 'costs', action: 'cast', scope: {},
      condition: { op: 'eq', left: { path: 'event.payload.amount' }, right: 1 }, operation: { type: 'mana.waive_base' } }] }))).toThrow('unavailable');
  });
});
