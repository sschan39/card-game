/** Languages the interface itself can render. Card content has its own authored language. */
export type LocaleCode = 'en' | 'zh-Hant';
export const DEFAULT_LOCALE: LocaleCode = 'en';
export const LOCALES: readonly LocaleCode[] = ['en', 'zh-Hant'];
/** Each language names itself, so the switch reads correctly before it is switched. */
export const LOCALE_LABELS: Record<LocaleCode, string> = { en: 'English', 'zh-Hant': '繁體中文' };
/** Abbreviated labels for the compact header switch; the full name stays in the tooltip. */
export const LOCALE_SHORT_LABELS: Record<LocaleCode, string> = { en: 'ENG', 'zh-Hant': '繁中' };
/** Value written to `<html lang>`; the card text keeps its own authored language. */
export const LOCALE_HTML_LANG: Record<LocaleCode, string> = { en: 'en', 'zh-Hant': 'zh-Hant' };

/** Narrow an unknown value (storage, URL, socket payload) to a shipped locale. */
export function isLocale(value: unknown): value is LocaleCode {
  return value === 'en' || value === 'zh-Hant';
}

/**
 * Match a browser language list (`navigator.languages`) to a shipped locale.
 *
 * Every `zh*` tag maps to Traditional Chinese: it is the only Chinese this build
 * ships, so a Simplified visitor reads Traditional rather than English. An
 * unrecognised list keeps the default, which is also the pre-i18n behaviour.
 */
export function negotiateLocale(candidates: readonly string[] | null | undefined): LocaleCode {
  for (const candidate of candidates ?? []) {
    const tag = candidate.trim().toLowerCase();
    if (!tag) continue;
    if (tag === 'en' || tag.startsWith('en-')) return 'en';
    if (tag === 'zh' || tag.startsWith('zh-')) return 'zh-Hant';
  }
  return DEFAULT_LOCALE;
}
