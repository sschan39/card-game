import type { CounterDefinitions } from '../rules/schema/counters';
import type { CardBlueprint } from './card.types';

/** Serializable definitions pinned by the application when a match is created. */
export interface MatchContent {
  readonly tokenBlueprints: Readonly<Record<string, CardBlueprint>>;
  readonly counterDefinitions: Readonly<CounterDefinitions>;
}
