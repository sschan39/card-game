import type { CardBlueprint } from '../types/card.types';
import type { CardLocale } from '../types/card-text.types';

/** Locales the engine can resolve. Extending this list is what adds a language. */
export const CARD_LOCALES: readonly CardLocale[] = ['en', 'zh-Hant'];

/** The text a viewer should read, already resolved for one locale. */
export interface ResolvedCardText {
  readonly name: string;
  readonly rulesText: string;
  readonly subTypes: readonly string[];
}

/** Narrow an untrusted value (a socket field, a JSON tag) to a known card locale. */
export function isCardLocale(value: unknown): value is CardLocale {
  return value === 'en' || value === 'zh-Hant';
}

/**
 * Resolve a card's printed text for one locale.
 *
 * The authored text is the source of truth, so an untranslated card or an unknown
 * locale returns exactly what was authored rather than an empty string.
 */
export function resolveCardText(
  card: Pick<CardBlueprint, 'name' | 'rulesText' | 'subTypes' | 'translations'>,
  locale: string,
): ResolvedCardText {
  const translation = isCardLocale(locale) ? card.translations?.[locale] : undefined;
  return {
    name: translation?.name ?? card.name,
    rulesText: translation?.rulesText ?? card.rulesText,
    subTypes: translation?.subTypes ?? card.subTypes ?? [],
  };
}

/** Resolve one mode label, falling back to the label written on the card. */
export function resolveModeLabel(
  card: Pick<CardBlueprint, 'translations'>,
  modeId: string,
  authoredLabel: string,
  locale: string,
): string {
  const translated = isCardLocale(locale) ? card.translations?.[locale]?.modes?.[modeId] : undefined;
  return translated ?? authoredLabel;
}

/** Resolve one choice prompt by its stable id, falling back to the authored text. */
export function resolveChoicePrompt(
  card: Pick<CardBlueprint, 'translations'>,
  choiceId: string | undefined,
  authoredPrompt: string,
  locale: string,
): string {
  if (!choiceId) return authoredPrompt;
  const translated = isCardLocale(locale) ? card.translations?.[locale]?.prompts?.[choiceId] : undefined;
  return translated ?? authoredPrompt;
}

/**
 * Every choice id authored anywhere on a card.
 *
 * Choices live in effects, abilities, modes and on-cast/on-enter lists, so the walk
 * is structural rather than per-field: any nested object with a `choice` carrying a
 * string `id` counts. That keeps this working when new effect families appear.
 */
export function collectChoiceIds(definition: unknown): Set<string> {
  const ids = new Set<string>();
  const seen = new Set<object>();
  const visit = (value: unknown): void => {
    if (!value || typeof value !== 'object' || seen.has(value as object)) return;
    seen.add(value as object);
    const record = value as Record<string, unknown>;
    const choice = record.choice;
    if (choice && typeof choice === 'object') {
      const id = (choice as Record<string, unknown>).id;
      if (typeof id === 'string' && id) ids.add(id);
    }
    for (const child of Object.values(record)) visit(child);
  };
  visit(definition);
  return ids;
}

/**
 * Reject a translation the engine cannot use.
 *
 * Content is data, so a bad tag or a mode/choice id that no longer exists must fail
 * at load instead of silently showing the authored text forever.
 */
export function assertCardTranslations(
  card: Pick<CardBlueprint, 'id' | 'modes' | 'translations'>,
): void {
  if (!card.translations) return;
  const modeIds = new Set((card.modes ?? []).map(mode => mode.id));
  const choiceIds = collectChoiceIds(card);
  for (const locale of Object.keys(card.translations)) {
    if (!isCardLocale(locale)) throw new Error(`Unknown card locale "${locale}" on ${card.id}`);
    const translation = card.translations[locale];
    if (!translation?.name?.trim()) throw new Error(`Card ${card.id} needs a name for ${locale}`);
    for (const modeId of Object.keys(translation.modes ?? {})) {
      if (!modeIds.has(modeId)) throw new Error(`Card ${card.id} translates unknown mode "${modeId}" for ${locale}`);
    }
    for (const choiceId of Object.keys(translation.prompts ?? {})) {
      if (!choiceIds.has(choiceId)) throw new Error(`Card ${card.id} translates unknown choice "${choiceId}" for ${locale}`);
    }
  }
}
