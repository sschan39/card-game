import { describe, expect, it } from 'vitest';
import { DECK_RULES, validateDeck } from '@card-game/protocol';
import { translate, type Translate } from '@card-game/ui';

const en: Translate = (key, params) => translate('en', key, params);
const zhHant: Translate = (key, params) => translate('zh-Hant', key, params);

const catalog = new Map([
  ['card-a', { id: 'card-a', deckLegal: true, copyLimit: null }],
  ['card-b', { id: 'card-b', deckLegal: true, copyLimit: null }],
]);

const card = (cardId: string) => ({ cardId, quantity: 1 });
const deck = (overrides: Record<string, unknown> = {}) => ({ name: 'Test deck', format: 'standard', cards: [card('card-a')], ...overrides });

describe('deck validation messages', () => {
  it('names the missing deck name instead of a generic structure error', () => {
    const result = validateDeck(deck({ name: '   ' }), catalog);
    expect(result.valid).toBe(false);
    if (result.valid) return;
    expect(result.issues[0].code).toBe('name_missing');
    expect(result.issues[0].message).toBe('Give this deck a name.');
    expect(en('builder.issueNameMissing')).toBe('Give this deck a name.');
    expect(zhHant('builder.issueNameMissing')).toBe('請為這副卡組取名。');
  });

  it('names an empty deck instead of a generic structure error', () => {
    const result = validateDeck(deck({ cards: [] }), catalog);
    expect(result.valid).toBe(false);
    if (result.valid) return;
    expect(result.issues[0].code).toBe('empty');
    expect(en('builder.issueEmpty')).toBe('Add cards to form a deck.');
    expect(zhHant('builder.issueEmpty')).toBe('請加入卡牌以組成卡組。');
  });

  it('reports the shortfall with the minimum as a parameter', () => {
    const result = validateDeck(deck(), catalog);
    expect(result.valid).toBe(false);
    if (result.valid) return;
    const issue = result.issues.find(entry => entry.code === 'size_below');
    expect(issue).toBeDefined();
    expect(issue?.params).toMatchObject({ min: DECK_RULES.minCards, count: 1 });
    expect(en('builder.issueSizeBelow', issue?.params)).toBe('Add at least ' + DECK_RULES.minCards + ' cards.');
    expect(zhHant('builder.issueSizeBelow', issue?.params)).toBe('至少需要 ' + DECK_RULES.minCards + ' 張牌。');
  });

  it('keeps the structure code only for genuinely malformed input', () => {
    const result = validateDeck(deck({ cards: 'not-an-array' }), catalog);
    expect(result.valid).toBe(false);
    if (result.valid) return;
    expect(result.issues[0].code).toBe('structure');
    expect(en('builder.issueStructure')).toBe('Invalid deck structure.');
  });
});
