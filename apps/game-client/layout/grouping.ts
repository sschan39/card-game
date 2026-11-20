/**
 * Permanent grouping.
 *
 * Two independent questions, both answered without touching game state:
 *
 *   1. Which logical band does a permanent belong to? Creatures, lands and
 *      artifacts read very differently, so they never share one undifferentiated
 *      row.
 *   2. Which permanents are visually identical and can share a slot?
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

export interface PermanentStack {
  /** Stable identity for the visual stack. */
  key: string;
  cards: CardView[];
}

/**
 * Everything that makes two permanents visually interchangeable. Tapped state,
 * damage, counters and attachments all split a stack, because a tapped 2/2 and
 * an untapped 2/2 are not the same object to the player.
 */
export function permanentSignature(card: CardView): string {
  const state = card.state;
  return JSON.stringify([
    card.definitionId,
    !!card.isToken,
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
 * Stack matching permanents. Hosts remain separate so their attachments
 * stay beside the correct card.
 */
export function groupIdenticalPermanents(cards: readonly CardView[], attachments?: ReadonlyMap<string, readonly CardView[]>): PermanentStack[] {
  const groups: PermanentStack[] = [];
  const bySignature = new Map<string, PermanentStack>();
  for (const card of cards) {
    if (attachments?.has(cardAnchor('battlefield', card))) {
      groups.push({ key: card.uuid, cards: [card] });
      continue;
    }
    const key = permanentSignature(card);
    const existing = bySignature.get(key);
    if (existing) existing.cards.push(card);
    else {
      const group: PermanentStack = { key, cards: [card] };
      bySignature.set(key, group);
      groups.push(group);
    }
  }
  return groups;
}
