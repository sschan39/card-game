import type { CardBlueprint } from '../types/card.types';
import rawCardData from './cards';
import rawTokenData, { isTokenDefinition } from './tokens';
export { isTokenDefinition } from './tokens';
import { parseCardDefinition } from './card-parser';
import { assertCardTranslations } from '../shared/localized-card-text';

for (const id of Object.keys(rawTokenData)) {
  if (Object.prototype.hasOwnProperty.call(rawCardData, id)) throw new Error('Duplicate card/token definition: ' + id);
}
const definitions: Record<string, unknown> = { ...rawCardData, ...rawTokenData };

type BlueprintCache = Record<string, CardBlueprint>;
const blueprintCache: BlueprintCache = {};

function deepFreeze<T>(value: T, seen = new Set<object>()): T {
  if (!value || typeof value !== 'object' || seen.has(value as object)) return value;
  seen.add(value as object);
  for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child, seen);
  return Object.freeze(value);
}

export function getBlueprint(cardId: string): CardBlueprint {
  if (!Object.prototype.hasOwnProperty.call(definitions, cardId)) throw new Error('Unknown card definition');
  const raw = definitions[cardId] as Record<string, unknown>;
  if (!raw) {
    throw new Error(`[CardFactory] No raw card data found for ID: ${cardId}`);
  }

  if (!blueprintCache[cardId]) {
    const parsed = parseCardDefinition(raw);
    if (parsed.id !== cardId) throw new Error('Definition ID does not match manifest: ' + cardId);
    assertCardTranslations(parsed);
    if (isTokenDefinition(cardId) && (!parsed.cardTypes.length || parsed.cardTypes.includes('Spell'))) {
      throw new Error('Token blueprints must describe permanents');
    }
    blueprintCache[cardId] = deepFreeze(parsed);
  }
  return blueprintCache[cardId];
}

/** Stable catalog enumeration without exposing the mutable authored data map. */
export function getCardIds(): string[] {
  return Object.keys(rawCardData).sort();
}

/** Token templates share parsing/caching, while normal-card enumeration remains unchanged. */
export function getTokenIds(): string[] {
  return Object.keys(rawTokenData).sort();
}

/** Fetch only an explicitly registered token, never convert an ordinary card into a token implicitly. */
export function getTokenBlueprint(tokenId: string): CardBlueprint {
  if (!isTokenDefinition(tokenId)) throw new Error('Unknown token definition');
  return getBlueprint(tokenId);
}
