import type { CardZone, ManaColor } from './card.types';

export type RelativePlayer = 'self' | 'opponent' | 'any';
export interface NumberBounds {
  min?: number;
  max?: number;
}

/** Structural card tests, independent of zone access, choices and targeting permissions. */
export interface CardFilter {
  ids?: string[];
  cardTypes?: string[];
  subTypes?: string[];
  colors?: ManaColor[];
  names?: string[];
  excludedNames?: string[];
  nameContains?: string;
  controller?: RelativePlayer;
  owner?: RelativePlayer;
  power?: NumberBounds;
  toughness?: NumberBounds;
  manaValue?: NumberBounds;
  tapped?: boolean;
  summonKind?: 'cast' | 'effect';
  /** An absent named counter has total zero. */
  counter?: { type: string; min?: number; max?: number };
  allOf?: CardFilter[];
  anyOf?: CardFilter[];
  not?: CardFilter;
}

export interface CardZoneQuery {
  zones?: readonly CardZone[];
  host?: import('./proposed-event.types').ObjectReference;
  /** Private zones use the containing player; battlefield/stack use current controller. */
  zonePlayer?: RelativePlayer;
}
