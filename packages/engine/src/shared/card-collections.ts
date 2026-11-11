import type { CardInstance } from '../types/card.types';
import type { CardCharacteristics } from '../types/continuous-effect.types';
import type { CardResultSource, ResolutionCardResult, ResolutionCardResults } from '../types/resolution-result.types';
import { cardObjectKey, sameCardObject } from './card-identity';
import { safeRuleKey } from './rule-path';

export interface CollectedCard {
  card: CardInstance;
  recordedCharacteristics?: CardCharacteristics;
}
/** Type guard for a resolution-result card source. */
export function validCardResultSource(value: unknown): value is CardResultSource {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const source = value as Record<string, unknown>;
  return (
    Object.keys(source).every((key) => ['kind', 'name', 'view', 'except'].includes(key)) &&
    source.kind === 'result' &&
    typeof source.name === 'string' &&
    !!source.name.trim() &&
    safeRuleKey(source.name) &&
    (source.view === undefined || source.view === 'current' || source.view === 'recorded') &&
    (source.except === undefined || typeof source.except === 'string' && !!source.except.trim() && safeRuleKey(source.except))
  );
}

function resultAnchors(result: ResolutionCardResult) {
  return result.kind === 'milled' || result.kind === 'drawn'
    ? result.cards.flatMap(entry => entry.after ? [entry.after] : [])
    : result.cards.map(entry => entry.before);
}

/** Zone cards and recorded subsets share downstream filters. Missing context never falls back to all cards. */
export function collectCardSource(
  cards: CardInstance[],
  from?: CardResultSource,
  results?: ResolutionCardResults,
): CollectedCard[] | undefined {
  if (!from) return cards.map((card) => ({ card }));
  if (!validCardResultSource(from) || !results || !Object.prototype.hasOwnProperty.call(results, from.name))
    return undefined;
  let anchors = resultAnchors(results[from.name]);
  if (from.except !== undefined) {
    if (!Object.prototype.hasOwnProperty.call(results, from.except)) return undefined;
    const excluded = new Set(resultAnchors(results[from.except]).map(snapshot => cardObjectKey(snapshot.card)));
    anchors = anchors.filter(snapshot => !excluded.has(cardObjectKey(snapshot.card)));
  }
  if (from.view === 'recorded')
    return anchors.map((snapshot) => ({
      card: snapshot.card,
      recordedCharacteristics: snapshot.card.lastKnownCharacteristics,
    }));
  const current = new Map(cards.map((card) => [card.uuid, card]));
  return anchors.flatMap((snapshot) => {
    const card = current.get(snapshot.card.uuid);
    return card && sameCardObject(card, snapshot.card) ? [{ card }] : [];
  });
}
