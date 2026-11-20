import { describe, expect, it } from 'vitest';
import en from '../../packages/ui/src/i18n/messages/en.json';
import zhHant from '../../packages/ui/src/i18n/messages/zh-Hant.json';

const placeholderPattern = /\{(\w+)\}/g;

/** Every `{name}` a template uses, sorted so two templates compare by content only. */
function placeholders(template: string): string[] {
  return [...template.matchAll(placeholderPattern)].map(match => match[1]).sort();
}

const english = Object.entries(en as Record<string, string>);
const chinese = Object.entries(zhHant as Record<string, string>);

describe('catalogue parity', () => {
  it('defines the same keys in both languages', () => {
    expect(chinese.map(([key]) => key).sort()).toEqual(english.map(([key]) => key).sort());
  });

  it('never ships an empty message', () => {
    for (const [key, value] of [...english, ...chinese]) expect(value.trim(), key).not.toBe('');
  });

  it('keeps the same placeholders in both languages', () => {
    const zhByKey = new Map(chinese);
    for (const [key, value] of english) expect(placeholders(zhByKey.get(key) ?? ''), key).toEqual(placeholders(value));
  });

  it('pairs every plural suffix with its base key', () => {
    const keys = new Set(english.map(([key]) => key));
    for (const key of keys) {
      const plural = /^(.*)\.(zero|one|two|few|many|other)$/.exec(key);
      if (plural) expect(keys.has(plural[1]), key).toBe(true);
    }
  });

  it('actually translates: no English sentence survives verbatim in the Chinese catalogue', () => {
    const zhByKey = new Map(chinese);
    const untranslated = english.filter(([key, value]) => {
      if (key === 'board.logChanges.one') return false;
      return zhByKey.get(key) === value;
    });
    expect(untranslated).toEqual([]);
  });
});
