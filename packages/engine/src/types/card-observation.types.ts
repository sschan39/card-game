import type { CardSnapshot } from './card.types';

export type ObservationRole = 'controller' | 'opponent' | 'zone_owner' | 'all_players';
/** Visibility of an observation, never ownership or visibility of a live card instance. */
export interface ObservationVisibility {
  faces: ObservationRole[];
  count: ObservationRole[];
  order: ObservationRole[];
  expires: 'resolution_end' | 'hand_exit_or_turn_end';
}
export interface ObservationAudience {
  faces: string[];
  count: string[];
  order: string[];
}
export interface ObservedMember {
  snapshot: CardSnapshot;
  audience: ObservationAudience;
}
export interface CardObservation {
  id: string;
  ownerStackUuid: string;
  resultName: string;
  expires?: 'hand_exit_or_turn_end';
  controllerId: string;
  zoneOwnerId: string;
  sourceInfo: CardSnapshot;
  /** Empty windows still retain their explicit count audience. */
  emptyAudience: ObservationAudience;
  members: ObservedMember[];
  turnNumber: number;
}
export interface ObservationState {
  sequence: number;
  active: Record<string, CardObservation>;
  /** Immutable, bounded observations; audiences are frozen player IDs. */
  history: { sequence: number; observation: CardObservation }[];
}
