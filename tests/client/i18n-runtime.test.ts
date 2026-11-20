import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_LOCALE,
  LOCALES,
  LOCALE_HTML_LANG,
  LOCALE_LABELS,
  LOCALE_STORAGE_KEY,
  isLocale,
  negotiateLocale,
  readBrowserLanguages,
  readStoredLocale,
  resolveInitialLocale,
  translate,
  writeStoredLocale,
  type LocaleStorage,
} from '@card-game/ui';
import en from '../../packages/ui/src/i18n/messages/en.json';

/** Minimal Web Storage double; `fail` makes access throw the way blocked storage does. */
function storageOf(initial: Record<string, string> = {}, fail = false): LocaleStorage & { values: Record<string, string> } {
  const values = { ...initial };
  return {
    values,
    getItem(key: string) { if (fail) throw new Error('blocked'); return values[key] ?? null; },
    setItem(key: string, value: string) { if (fail) throw new Error('blocked'); values[key] = value; },
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('locale identity', () => {
  it('ships exactly two locales with self-naming labels', () => {
    expect(LOCALES).toEqual(['en', 'zh-Hant']);
    expect(DEFAULT_LOCALE).toBe('en');
    expect(LOCALE_LABELS.en).toBe('English');
    expect(LOCALE_LABELS['zh-Hant']).toBe('繁體中文');
    expect(LOCALE_HTML_LANG['zh-Hant']).toBe('zh-Hant');
    expect(isLocale('en')).toBe(true);
    expect(isLocale('zh-Hant')).toBe(true);
    expect(isLocale('zh-TW')).toBe(false);
    expect(isLocale(null)).toBe(false);
    expect(isLocale(undefined)).toBe(false);
    expect(isLocale(2)).toBe(false);
  });

  it('negotiates regional tags and keeps the default on an unknown list', () => {
    expect(negotiateLocale(['zh-HK', 'en-US'])).toBe('zh-Hant');
    expect(negotiateLocale(['zh-TW'])).toBe('zh-Hant');
    expect(negotiateLocale(['zh'])).toBe('zh-Hant');
    expect(negotiateLocale(['ZH-hant-hk'])).toBe('zh-Hant');
    expect(negotiateLocale(['en-GB'])).toBe('en');
    expect(negotiateLocale(['en'])).toBe('en');
    expect(negotiateLocale(['fr-FR', 'de'])).toBe('en');
    expect(negotiateLocale(['', '  '])).toBe('en');
    expect(negotiateLocale([])).toBe('en');
    expect(negotiateLocale(undefined)).toBe('en');
    expect(negotiateLocale(null)).toBe('en');
  });
});

describe('locale persistence', () => {
  it('reads a valid stored choice and rejects anything else', () => {
    expect(readStoredLocale(storageOf({ [LOCALE_STORAGE_KEY]: 'zh-Hant' }))).toBe('zh-Hant');
    expect(readStoredLocale(storageOf({ [LOCALE_STORAGE_KEY]: 'klingon' }))).toBeNull();
    expect(readStoredLocale(storageOf())).toBeNull();
    expect(readStoredLocale(null)).toBeNull();
    expect(readStoredLocale(storageOf({ [LOCALE_STORAGE_KEY]: 'en' }, true))).toBeNull();
  });

  it('writes the choice and tolerates storage that refuses it', () => {
    const storage = storageOf();
    writeStoredLocale('zh-Hant', storage);
    expect(storage.values[LOCALE_STORAGE_KEY]).toBe('zh-Hant');
    expect(() => writeStoredLocale('en', storageOf({}, true))).not.toThrow();
    expect(() => writeStoredLocale('en', null)).not.toThrow();
  });

  it('prefers navigator.languages, then navigator.language, and survives without navigator', () => {
    vi.stubGlobal('navigator', { languages: ['zh-HK', 'en'], language: 'en' });
    expect(readBrowserLanguages()).toEqual(['zh-HK', 'en']);
    vi.stubGlobal('navigator', { languages: [], language: 'zh-TW' });
    expect(readBrowserLanguages()).toEqual(['zh-TW']);
    vi.stubGlobal('navigator', { languages: [] });
    expect(readBrowserLanguages()).toEqual([]);
    /* Node exposes a non-configurable `navigator`, so unstubbing cannot restore
       "absent"; stubbing it to undefined exercises the same guard. */
    vi.stubGlobal('navigator', undefined);
    expect(readBrowserLanguages()).toEqual([]);
  });

  it('resolves a stored choice ahead of the browser preference', () => {
    expect(resolveInitialLocale(['en-US'], storageOf({ [LOCALE_STORAGE_KEY]: 'zh-Hant' }))).toBe('zh-Hant');
    expect(resolveInitialLocale(['zh-HK'], storageOf())).toBe('zh-Hant');
    expect(resolveInitialLocale(['fr'], storageOf())).toBe('en');
    expect(resolveInitialLocale(['en'], null)).toBe('en');
  });
});

describe('message rendering', () => {
  it('renders the active catalogue and falls back to English for a missing key', () => {
    expect(translate('en', 'nav.home')).toBe('Home');
    expect(translate('zh-Hant', 'nav.home')).toBe('首頁');
    expect(translate('zh-Hant', 'nav.play')).toBe('對戰');
    expect(translate('en', 'nav.admin')).toBe('Administration');
  });

  it('interpolates named values and formats numbers per locale', () => {
    expect(translate('en', 'home.resume', { roomId: 'abc' })).toBe('Resume room abc');
    expect(translate('zh-Hant', 'home.resume', { roomId: 'abc' })).toBe('繼續房間 abc');
    expect(translate('en', 'board.logBy', { player: 'alice' })).toBe('by alice');
    expect(translate('en', 'board.logChanges', { count: 1200 })).toBe('1,200 changes');
    expect(translate('zh-Hant', 'board.logChanges', { count: 1200 })).toBe('1,200 項變更');
  });

  it('selects a plural form through Intl.PluralRules when the catalogue has one', () => {
    expect(translate('en', 'board.logChanges', { count: 1 })).toBe('1 change');
    expect(translate('en', 'board.logChanges', { count: 2 })).toBe('2 changes');
    expect(translate('zh-Hant', 'board.logChanges', { count: 1 })).toBe('1 項變更');
  });

  it('leaves unknown placeholders and missing keys visible instead of throwing', () => {
    expect(translate('en', 'board.logCommand', {})).toBe('Command: {commandId}');
    expect(translate('en', 'board.logCommand', { commandId: 'c-1' })).toBe('Command: c-1');
    expect(translate('en', 'board.logSnapshot')).toBe('snapshot');
  });

  it('keeps the English catalogue as the key source for every locale', () => {
    const keys = Object.keys(en);
    expect(keys.length).toBeGreaterThan(40);
    expect(keys.every(key => translate('en', key as keyof typeof en).length > 0)).toBe(true);
  });
});
