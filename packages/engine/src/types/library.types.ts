import type { CardZone } from './card.types';

export interface LibraryCardReference { cardUuid: string; zoneRevision: number }
export type LibraryPlacement = 'top' | 'bottom';
export interface MoveZoneParameters {
  origin?: CardZone;
  destination: CardZone;
  libraryPlacement?: LibraryPlacement;
  handRecipient?: 'controller';
  from?: import('./resolution-result.types').CardResultSource;
  filter?: import('./card-query.types').CardFilter;
}
