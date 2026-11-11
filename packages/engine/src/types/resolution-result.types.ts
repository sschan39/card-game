import type { CardSnapshot } from './card.types';

/** A query source local to one resolving spell/ability. It never owns live cards. */
export interface CardResultSource {
  kind: 'result';
  name: string;
  /** Current exact incarnations for actions; immutable capture/arrival snapshots for historical counts. */
  view?: 'current' | 'recorded';
  /** Remove exact members of another named result from this source. */
  except?: string;
}
export type CardResultDefinition = { name: string; kind: 'milled' | 'drawn' | 'captured' };
export interface MovedCardResult {
  name: string;
  kind: 'milled' | 'drawn';
  /** Attempts retain provenance; only successful moves have an arrival snapshot. */
  cards: { before: CardSnapshot; after?: CardSnapshot }[];
  observationId?: never;
}
export interface CapturedCardResult {
  name: string;
  kind: 'captured';
  observationId: string;
  /** An unmoved observation anchors membership without pretending to be a zone arrival. */
  cards: { before: CardSnapshot; after?: never }[];
}
export interface SelectedCardResult {
  name: string;
  kind: 'selected';
  observationId?: string;
  cards: { before: CardSnapshot; after?: never }[];
}
export type ResolutionCardResult = MovedCardResult | CapturedCardResult | SelectedCardResult;
export type ResolutionCardResults = Record<string, ResolutionCardResult>;
