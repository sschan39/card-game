import type { CardZone } from './card.types';
import type { DamageAssignment, DamageRecipient } from './damage.types';
import type { GameMutation } from './game-mutation.types';
import type { ResolutionContinuation } from './choice.types';
import type { BatchCause, ResolutionReport } from './game-event.types';

export interface ObjectReference { cardUuid: string; zoneRevision: number }
export type ZoneMove = Extract<GameMutation, { type: 'MOVE_CARD' }>;
export type ProposedEvent =
  | { kind: 'damage'; assignment: DamageAssignment }
  | { kind: 'zone_transfer' | 'destroy' | 'sacrifice' | 'discard'; move: ZoneMove }
  | { kind: 'draw'; playerId: string; move?: ZoneMove }
  | { kind: 'life_change'; playerId: string; amount: number; damageSource?: string; combat?: boolean; damageSourceInfo?: import('./card.types').CardSnapshot }
  | { kind: 'poison'; playerId: string; amount: number }
  | { kind: 'counter_change'; card: ObjectReference; counterType: string; amount: number };

/** Open interface: extensions augment the operation map and register their handler. */
export interface ReplacementOperationMap {
  damage_scale: { type: 'damage_scale'; factor: number };
  prevent_damage: { type: 'prevent_damage'; amount?: number };
  redirect_damage: { type: 'redirect_damage'; recipient: DamageRecipient };
  move_destination: { type: 'move_destination'; to: CardZone };
  cancel_event: { type: 'cancel_event' };
  regenerate: { type: 'regenerate' };
}
export type ReplacementOperation = ReplacementOperationMap[keyof ReplacementOperationMap];
export interface ReplacementMatch {
  kinds?: ProposedEvent['kind'][];
  playerId?: string;
  card?: ObjectReference;
  source?: ObjectReference;
  cardTypes?: string[];
  controllerId?: string;
  from?: CardZone;
  to?: CardZone;
  combat?: boolean;
}
export interface ReplacementDefinition {
  id: string;
  label: string;
  operation: ReplacementOperation;
  match?: ReplacementMatch;
  selfReplacement?: boolean;
  optional?: boolean;
  source?: ObjectReference;
  duration?: 'permanent' | 'end_of_turn' | 'while_source';
  expiresTurn?: number;
  /** Finite amount of damage this shield can still prevent. */
  remaining?: number;
  /** Finite event uses, consumed only when the operation changes an event. */
  uses?: number;
}
export interface TrackedProposedEvent { event: ProposedEvent; applied: string[] }
export interface ProposedTransaction {
  completed: GameMutation[];
  remaining: GameMutation[];
  current?: { frames: TrackedProposedEvent[]; final: TrackedProposedEvent[]; damage?: DamageAssignment[]; resultPrimitives?: GameMutation[] };
  simultaneous?: boolean;
  resumePriority?: string | null;
  cause?: BatchCause;
  resolution?: ResolutionReport;
}
export interface ReplacementContinuation {
  type: 'replacement';
  transaction: ProposedTransaction;
  shieldAllocation?: { ruleId: string; indices: number[] };
  /** Immediate parent first: result-created events remain inside their atomic batch. */
  parents?: ProposedTransaction[];
  /** The next effect is planned after the paused transaction actually completes. */
  afterResolution?: ResolutionContinuation;
}
