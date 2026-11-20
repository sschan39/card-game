import { DEFAULT_LOCALE, type LocaleCode } from './locale';
import en from './messages/en.json';
import zhHant from './messages/zh-Hant.json';

/** Every key the English catalogue defines. The other locales must match it. */
export type MessageKey = keyof typeof en;
export type TranslateParams = Record<string, string | number>;
export type Translate = (key: MessageKey, params?: TranslateParams) => string;

export const CATALOGS: Record<LocaleCode, Record<string, string>> = { en, 'zh-Hant': zhHant };

/**
 * Pick the template for one key.
 *
 * A `count` parameter selects `key.one` / `key.other` through `Intl.PluralRules`
 * so a language with plural forms reads correctly; a locale that lacks the
 * suffixed entry keeps the plain key, which is the usual case for Chinese.
 */
function template(locale: LocaleCode, key: MessageKey, params: TranslateParams): string | undefined {
  const primary = CATALOGS[locale];
  const fallback = CATALOGS[DEFAULT_LOCALE];
  if (typeof params.count === 'number') {
    const category = new Intl.PluralRules(locale).select(params.count);
    const plural = `${key}.${category}` as MessageKey;
    const text = primary[plural] ?? fallback[plural];
    if (text) return text;
  }
  return primary[key] ?? fallback[key];
}

function interpolate(text: string, locale: LocaleCode, params: TranslateParams): string {
  return text.replace(/\{(\w+)\}/g, (match, name: string) => {
    const value = params[name];
    if (value === undefined) return match;
    return typeof value === 'number' ? new Intl.NumberFormat(locale).format(value) : value;
  });
}

/**
 * Look up one message. A key missing from the active catalogue falls back to
 * English, then to the key itself, so a half-translated locale still renders.
 */
export function translate(locale: LocaleCode, key: MessageKey, params: TranslateParams = {}): string {
  const text = template(locale, key, params) ?? key;
  return interpolate(text, locale, params);
}
