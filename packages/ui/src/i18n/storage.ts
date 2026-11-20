import { isLocale, negotiateLocale, type LocaleCode } from './locale';

/** Namespaced like the other browser keys (`cardgame.playerId`, `cardgame.roomId`). */
export const LOCALE_STORAGE_KEY = 'cardgame.locale.v1';

/** The slice of Web Storage this module needs, so tests can pass a stub. */
export type LocaleStorage = Pick<Storage, 'getItem' | 'setItem'>;

function browserStorage(): LocaleStorage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    /* Blocked storage throws on access, not only on read or write. */
    return null;
  }
}

/** Stored choice, or `null` when absent, malformed, or storage is unavailable. */
export function readStoredLocale(storage: LocaleStorage | null = browserStorage()): LocaleCode | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(LOCALE_STORAGE_KEY);
    return isLocale(raw) ? raw : null;
  } catch {
    return null;
  }
}

/** Persist the choice. Private mode is allowed to forget it. */
export function writeStoredLocale(locale: LocaleCode, storage: LocaleStorage | null = browserStorage()): void {
  if (!storage) return;
  try {
    storage.setItem(LOCALE_STORAGE_KEY, locale);
  } catch {
    /* Quota or private mode: the session keeps the in-memory value. */
  }
}

/** Browser preference order, tolerant of environments without `navigator`. */
export function readBrowserLanguages(): readonly string[] {
  if (typeof navigator === 'undefined') return [];
  if (Array.isArray(navigator.languages) && navigator.languages.length) return navigator.languages;
  return navigator.language ? [navigator.language] : [];
}

/** A remembered choice wins over the browser's preference; otherwise negotiate. */
export function resolveInitialLocale(
  languages: readonly string[] = readBrowserLanguages(),
  storage: LocaleStorage | null = browserStorage(),
): LocaleCode {
  return readStoredLocale(storage) ?? negotiateLocale(languages);
}
