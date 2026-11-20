import { describe, expect, it } from 'vitest';
import {
  CARD_LOCALES,
  assertCardTranslations,
  collectChoiceIds,
  isCardLocale,
  resolveCardText,
  resolveChoicePrompt,
  resolveModeLabel,
} from '@card-game/engine/shared/localized-card-text';
import { getBlueprint } from '@card-game/engine/library/card-catalog';

const fireball = getBlueprint('fireball');

describe('card text resolution', () => {
  it('returns the authored Traditional Chinese text for zh-Hant', () => {
    const text = resolveCardText(fireball, 'zh-Hant');
    expect(text.name).toBe('火球術');
    expect(text.rulesText).toContain('灼熱');
    expect(text.subTypes).toEqual(['炎兵']);
  });

  it('returns the English translation when the card has one', () => {
    const text = resolveCardText(fireball, 'en');
    expect(text.name).toBe('Fireball');
    expect(text.rulesText).toContain('Scorch 2');
    expect(text.subTypes).toEqual(['Flame Soldier']);
  });

  it('falls back to the authored text for an untranslated card or unknown locale', () => {
    /* Built in memory rather than read from the catalog: every shipped card now has an
       English translation, and the fallback still has to be proven. */
    const untranslated = {
      ...fireball, id: 'untranslated-card', name: '未翻譯卡', rulesText: '未翻譯的規則文字', subTypes: ['炎兵'], translations: undefined,
    };
    expect(resolveCardText(untranslated, 'en').name).toBe('未翻譯卡');
    expect(resolveCardText(untranslated, 'zh-Hant').name).toBe('未翻譯卡');
    expect(resolveCardText(fireball, 'klingon').name).toBe('火球術');
  });

  it('translates a mode label by its stable id and keeps the authored one otherwise', () => {
    expect(resolveModeLabel(fireball, 'main-scorch', '主：灼熱2', 'en')).toBe('Main: Scorch 2');
    expect(resolveModeLabel(fireball, 'instant-damage', '速：對對手玩家造成5點傷害', 'en')).toBe('Speed: deal 5 damage to the opposing player');
    expect(resolveModeLabel(fireball, 'main-scorch', '主：灼熱2', 'zh-Hant')).toBe('主：灼熱2');
    expect(resolveModeLabel(fireball, 'unknown-mode', 'authored', 'en')).toBe('authored');
    expect(resolveModeLabel(fireball, 'main-scorch', '主：灼熱2', 'klingon')).toBe('主：灼熱2');
  });

  it('narrows untrusted locale tags', () => {
    expect(CARD_LOCALES).toEqual(['en', 'zh-Hant']);
    expect(isCardLocale('en')).toBe(true);
    expect(isCardLocale('zh-Hant')).toBe(true);
    expect(isCardLocale('zh-TW')).toBe(false);
    expect(isCardLocale(undefined)).toBe(false);
    expect(isCardLocale(3)).toBe(false);
  });
});

describe('translation validation', () => {
  const base = { id: 'probe', modes: [{ id: 'main' }] } as unknown as Parameters<typeof assertCardTranslations>[0];

  it('accepts an absent translation and a well-formed one', () => {
    expect(() => assertCardTranslations(base)).not.toThrow();
    expect(() => assertCardTranslations({ ...base, translations: { en: { name: 'Probe', modes: { main: 'Main' } } } })).not.toThrow();
  });

  it('rejects an unknown locale tag', () => {
    const translations = { klingon: { name: 'Probe' } } as unknown as Parameters<typeof assertCardTranslations>[0]['translations'];
    expect(() => assertCardTranslations({ ...base, translations })).toThrow(/Unknown card locale/);
  });

  it('rejects a translation without a name', () => {
    const translations = { en: { name: '   ' } } as unknown as Parameters<typeof assertCardTranslations>[0]['translations'];
    expect(() => assertCardTranslations({ ...base, translations })).toThrow(/needs a name/);
    const missing = { en: undefined } as unknown as Parameters<typeof assertCardTranslations>[0]['translations'];
    expect(() => assertCardTranslations({ ...base, translations: missing })).toThrow(/needs a name/);
  });

  it('rejects a mode id the card does not define', () => {
    const translations = { en: { name: 'Probe', modes: { sideboard: 'Sideboard' } } } as unknown as Parameters<typeof assertCardTranslations>[0]['translations'];
    expect(() => assertCardTranslations({ ...base, translations })).toThrow(/unknown mode/);
  });

  it('rejects a choice id the card does not define', () => {
    const translations = { en: { name: 'Probe', prompts: { 'no-such-choice': 'Pick one?' } } } as unknown as Parameters<typeof assertCardTranslations>[0]['translations'];
    expect(() => assertCardTranslations({ ...base, translations })).toThrow(/unknown choice/);
  });

  it('accepts a prompt whose choice id exists, and finds ids nested in effects', () => {
    const card = {
      id: 'probe',
      modes: [{ id: 'main', effects: [{ choice: { kind: 'optional', id: 'draw-two', prompt: '抽兩張牌？' } }] }],
      translations: { en: { name: 'Probe', prompts: { 'draw-two': 'Draw two cards?' } } },
    };
    expect(collectChoiceIds(card)).toEqual(new Set(['draw-two']));
    expect(() => assertCardTranslations(card)).not.toThrow();
  });
});

describe('choice prompt resolution', () => {
  const card = { translations: { en: { name: 'Probe', prompts: { 'draw-two': 'Draw two cards?' } } } };

  it('returns the translation for a known id and the authored text otherwise', () => {
    expect(resolveChoicePrompt(card, 'draw-two', '抽兩張牌？', 'en')).toBe('Draw two cards?');
    expect(resolveChoicePrompt(card, 'draw-two', '抽兩張牌？', 'zh-Hant')).toBe('抽兩張牌？');
    expect(resolveChoicePrompt(card, 'other', '抽兩張牌？', 'en')).toBe('抽兩張牌？');
    expect(resolveChoicePrompt(card, undefined, '抽兩張牌？', 'en')).toBe('抽兩張牌？');
    expect(resolveChoicePrompt(card, 'draw-two', '抽兩張牌？', 'klingon')).toBe('抽兩張牌？');
  });
});
