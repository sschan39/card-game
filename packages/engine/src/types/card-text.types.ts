/**
 * Card content is authored in one language (Traditional Chinese) and translated
 * per locale. Nothing here changes the authored text: a translation overrides only
 * the fields it names, so a partially translated card still renders completely.
 */

/** Locales card content can be translated into. Interface copy has its own list. */
export type CardLocale = 'en' | 'zh-Hant';

/** Per-locale overrides for one card. `name` is required; everything else falls back. */
export interface CardTextTranslation {
  readonly name: string;
  readonly rulesText?: string;
  readonly subTypes?: readonly string[];
  /** Mode id to translated label. An unknown id is rejected when the card loads. */
  readonly modes?: Readonly<Record<string, string>>;
  /** Choice id to translated prompt. An unknown or duplicated id fails the load. */
  readonly prompts?: Readonly<Record<string, string>>;
}

export type CardTranslations = Readonly<Partial<Record<CardLocale, CardTextTranslation>>>;
