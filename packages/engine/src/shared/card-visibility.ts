import type { CardInstance, CardZone, CardVisibility } from '../types/card.types';

/** Ordinary zone defaults. Face-down public-zone cards require a separate supported mechanic. */
export function defaultCardVisibility(zone: CardZone): CardVisibility {
  if (zone === 'library') return 'hidden';
  if (zone === 'hand') return 'owner';
  return 'public';
}
/** A stored base state belongs to its zone; stale imported states use the current zone's default. */
export function baseCardVisibility(card: CardInstance): CardVisibility {
  if (card.state.visibilityZone !== card.state.zone || card.state.visibility === undefined) {
    return defaultCardVisibility(card.state.zone);
  }
  return card.state.visibility;
}
/** The player with the right to see and use this hand card. */
export function handHolder(card: CardInstance): string {
  return card.state.handHolderId ?? card.state.ownerId;
}

/** The player whose zone currently contains the card, using owner for shared zones. */
export function cardZonePlayer(card: CardInstance): string {
  return card.state.zone === 'hand' ? handHolder(card) : card.state.ownerId;
}

/** Normal card access, independent of temporary observations and choice authority. */
export function baseCardVisibleTo(card: CardInstance, playerId: string): boolean {
  const visibility = baseCardVisibility(card);
  return visibility === 'public' || (visibility === 'owner' && cardZonePlayer(card) === playerId);
}
