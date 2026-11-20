import { describe, expect, it } from 'vitest';
import { LocaleCodeSchema, LOCALE_CODES } from '@card-game/protocol';
import { buildCatalog } from '@server/catalog/catalog';

/** The catalogue is prebuilt per locale, so one card proves the wiring for all. */
describe('catalogue localization', () => {
  const english = buildCatalog(undefined, 'en');
  const chinese = buildCatalog(undefined, 'zh-Hant');

  it('serves the same definitions in both languages', () => {
    expect([...english.keys()].sort()).toEqual([...chinese.keys()].sort());
    expect(english.size).toBeGreaterThan(150);
  });

  it('translates a card that has a translation', () => {
    expect(english.get('fireball')?.name).toBe('Fireball');
    expect(english.get('fireball')?.rulesText).toContain('Scorch 2');
    expect(english.get('fireball')?.subTypes).toEqual(['Flame Soldier']);
    expect(chinese.get('fireball')?.name).toBe('火球術');
    expect(chinese.get('fireball')?.rulesText).toContain('灼熱');
  });

  it('translates the card that used to be the untranslated fixture', () => {
    /* abyss-giant was frozen as the "no translation" sample; it is translated now, and the
       fallback path is proven in tests/library/localized-card-text.test.ts on an in-memory
       blueprint instead of depending on a shipped card. */
    expect(english.get('abyss-giant')?.name).toBe('Abyss Giant');
    expect(english.get('abyss-giant')?.subTypes).toEqual(['Azure Giant']);
    expect(english.get('abyss-giant')?.rulesText).toContain('Ritual 5');
    expect(chinese.get('abyss-giant')?.name).toBe('深淵巨人');
  });

  it('keeps printed mana, colours and deck policy identical across locales', () => {
    for (const id of ['fireball', 'empire-servant', 'land-red']) {
      expect(english.get(id)?.manaCost).toBe(chinese.get(id)?.manaCost);
      expect(english.get(id)?.colors).toEqual(chinese.get(id)?.colors);
      expect(english.get(id)?.deckLegal).toBe(chinese.get(id)?.deckLegal);
      expect(english.get(id)?.copyLimit).toBe(chinese.get(id)?.copyLimit);
    }
  });
});

describe('catalogue locale whitelist', () => {
  it('accepts only the shipped locales and rejects everything else', () => {
    expect(LOCALE_CODES).toEqual(['en', 'zh-Hant']);
    expect(LocaleCodeSchema.safeParse('en').success).toBe(true);
    expect(LocaleCodeSchema.safeParse('zh-Hant').success).toBe(true);
    expect(LocaleCodeSchema.safeParse('zh-TW').success).toBe(false);
    expect(LocaleCodeSchema.safeParse('').success).toBe(false);
    expect(LocaleCodeSchema.safeParse(undefined).success).toBe(false);
  });
});
