/**
 * Permanent grouping.
 *
 * Two independent questions, both answered without touching game state:
 *
 *   1. Which logical band does a permanent belong to? Creatures, lands and
 *      artifacts read very differently, so they never share one undifferentiated
 *      row.
 *   2. Which permanents are visually identical? Fifty Goblin tokens should be
 *      one stack with a count, not fifty overlapping cards.
 *
 * Grouping is presentation only. Every card keeps its own uuid, its own click
 * handler and its own targeting behaviour.
 */

import type { CardView } from '@card-game/protocol';
import { cardAnchor } from '../presentation/board-anchors';
import { permanentBadges } from '../presentation/permanent-statuses';

export type PermanentCategory = 'creature' | 'planeswalker' | 'artifact' | 'enchantment' | 'land' | 'other';

/** Front to back: the things that attack come first, the mana base last. */
export const CATEGORY_ORDER: readonly PermanentCategory[] = [
  'creature',
  'planeswalker',
  'artifact',
  'enchantment',
  'land',
  'other',
];

export const CATEGORY_LABELS: Record<PermanentCategory, string> = {
  creature: 'Creatures',
  planeswalker: 'Planeswalkers',
  artifact: 'Artifacts',
  enchantment: 'Enchantments',
  land: 'Lands',
  other: 'Other',
};

export function permanentCategory(card: CardView): PermanentCategory {
  const types = card.cardTypes;
  if (types.includes('Creature')) return 'creature';
  if (types.includes('Planeswalker')) return 'planeswalker';
  if (types.includes('Artifact')) return 'artifact';
  if (types.includes('Enchantment')) return 'enchantment';
  if (types.includes('Land')) return 'land';
  return 'other';
}

export interface PermanentGroupView {
  category: PermanentCategory;
  cards: CardView[];
}

/** Bucket permanents into category bands, in `CATEGORY_ORDER`. */
export function groupPermanents(cards: readonly CardView[]): PermanentGroupView[] {
  const buckets = new Map<PermanentCategory, CardView[]>();
  for (const card of cards) {
    const category = permanentCategory(card);
    const bucket = buckets.get(category);
    if (bucket) bucket.push(card);
    else buckets.set(category, [card]);
  }
  return CATEGORY_ORDER.filter((category) => buckets.has(category)).map((category) => ({
    category,
    cards: buckets.get(category)!,
  }));
}

export interface TokenGroupView {
  /** Stable identity for the stack: the signature for tokens, the uuid otherwise. */
  key: string;
  cards: CardView[];
}

/**
 * Everything that makes two tokens visually interchangeable. Tapped state,
 * damage, counters and attachments all split a stack, because a tapped 2/2 and
 * an untapped 2/2 are not the same object to the player.
 */
export function tokenSignature(card: CardView): string {
  const state = card.state;
  return JSON.stringify([
    card.definitionId,
    card.name,
    card.rulesText,
    card.manaCost,
    [...card.cardTypes].sort(),
    [...card.subTypes].sort(),
    [...card.keywords].sort(),
    card.power,
    card.toughness,
    !!state.isTapped,
    !!state.summoningSickness,
    !!state.attackedThisTurn,
    state.attachedTo,
    state.attachedToRevision,
    state.attachedToPlayerId,
    state.protectorId,
    permanentBadges(card).map(badge => JSON.stringify([badge.tone, badge.detail])).sort(),
  ]);
}

/**
 * Collapse identical tokens into stacks. Non-tokens always stay singletons so
 * two copies of the same creature card remain individually selectable.
 */
export function groupTokens(cards: readonly CardView[], attachments?: ReadonlyMap<string, readonly CardView[]>): TokenGroupView[] {
  const groups: TokenGroupView[] = [];
  const bySignature = new Map<string, TokenGroupView>();
  for (const card of cards) {
    if (!card.isToken || attachments?.has(cardAnchor('battlefield', card))) {
      groups.push({ key: card.uuid, cards: [card] });
      continue;
    }
    const key = tokenSignature(card);
    const existing = bySignature.get(key);
    if (existing) existing.cards.push(card);
    else {
      const group: TokenGroupView = { key, cards: [card] };
      bySignature.set(key, group);
      groups.push(group);
    }
  }
  return groups;
}
