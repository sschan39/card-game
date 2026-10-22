import type { CardBlueprint, CardState, CardZone } from '../types/card.types';

/** Active state is constructed in one place for creation and real zone changes. */
export function createCardState(
  _blueprint: CardBlueprint,
  ownerId: string,
  controllerId: string,
  zone: CardZone,
): CardState {
  return {
    zone,
    ownerId,
    controllerId,
    isTapped: false,
    damageTaken: 0,
    counters: {},
    attackedThisTurn: false,
    // Track tenure for all permanents so later animation cannot bypass it.
    summoningSickness: zone === 'battlefield',
  };
}
