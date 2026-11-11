import type { CardZone } from './card.types';

export interface LibraryCardReference { cardUuid: string; zoneRevision: number }
export type LibraryPlacement = 'top' | 'bottom';
export interface MoveZoneParameters {
  origin?: CardZone;
  destination: CardZone;
  libraryPlacement?: LibraryPlacement;
  host?: { mode: 'store'; visibility: 'public' | 'owner' | 'controller' | 'hidden' }
    | { mode: 'release'; selection: 'all' | 'selected' };
  handRecipient?: 'controller';
  from?: import('./resolution-result.types').CardResultSource;
  filter?: import('./card-query.types').CardFilter;
}
