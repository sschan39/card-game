import type { CardInstance, CardSnapshot, CardZone } from './card.types';
import type { GameRoom, PlayerId } from './game.room.types';
import type { GameMutation } from './game-mutation.types';
import type { Phase } from './game.state.types';
import type { StackObject } from './effect.types';
import type { PendingChoice } from './choice.types';

/** Extend this interface (including via declaration merging) for new semantic events. */
export interface GameEventPayloads {
  CARD_REVEALED: { card: CardInstance; revealedCard: CardInstance; sourceInfo: CardSnapshot; controllerId: PlayerId };
  LIBRARY_SHUFFLED: { playerId: PlayerId; controllerId: PlayerId };
  MUTATION_APPLIED: { mutation: GameMutation };
  CHOICE_REQUESTED: { choiceId: string; playerId: PlayerId; kind: PendingChoice['kind'] };
  CHOICE_COMPLETED: { choiceId: string; playerId: PlayerId; kind: PendingChoice['kind'] };
  CARD_MOVED: { cardUuid: string; from: CardZone; to: CardZone; before: CardInstance; after: CardInstance };
  PERMANENT_ENTERED: { card: CardInstance; controllerId: PlayerId };
  PERMANENT_LEFT: { card: CardInstance; snapshot: CardSnapshot; controllerId: PlayerId };
  PERMANENT_DIED: GameEventPayloads['PERMANENT_LEFT'];
  PERMANENT_DESTROYED: GameEventPayloads['PERMANENT_LEFT'];
  DAMAGE_TAKEN: { card: CardInstance; controllerId: PlayerId; amount: number; oldDamage: number; newDamage: number; source?: string };
  DAMAGE_DEALT: { card?: CardInstance; controllerId?: PlayerId; source?: string; snapshot?: CardSnapshot; amount: number; combat: boolean; recipient: { cardUuid?: string; playerId?: PlayerId } };
  LIFE_CHANGED: { playerId: PlayerId; oldLife: number; newLife: number; amount: number };
  LIFE_GAINED: GameEventPayloads['LIFE_CHANGED'];
  LIFE_LOST: GameEventPayloads['LIFE_CHANGED'];
  CARD_DRAWN: { card: CardInstance; playerId: PlayerId; controllerId: PlayerId };
  CARD_DISCARDED_FROM_HAND: GameEventPayloads['CARD_DRAWN'];
  CARD_DISCARDED_FROM_LIBRARY: GameEventPayloads['CARD_DRAWN'];
  COUNTER_CHANGED: { card: CardInstance; counterType: string; oldCount: number; newCount: number; amount: number;
    targetControllerId: PlayerId; controllerId?: PlayerId; source?: string; sourceInfo?: CardSnapshot };
  SPELL_CAST: { card: CardInstance; playerId: PlayerId; controllerId: PlayerId; stackObj: StackObject };
  BLOCK_DECLARED: { card: CardInstance; controllerId: PlayerId; attackerUuid: string };
  ATTACK_DECLARED: { card: CardInstance; controllerId: PlayerId };
  ATTACKERS_DECLARED: { attackerIds: string[] };
  BLOCKERS_DECLARED: { blockerAssignments: { attackerUuid: string; blockerUuids: string[] }[] };
  PHASE_CHANGED: { previousPhase: Phase; phase: Phase; currentPlayer: PlayerId };
  UPKEEP_STARTED: { currentPlayer: PlayerId };
  END_STEP_STARTED: { currentPlayer: PlayerId };
  TURN_STARTED: { currentPlayer: PlayerId };
  TURN_SWITCHED: { previousPlayer: PlayerId; newPlayer: PlayerId };
  PRIORITY_GIVEN: { previousPlayer: PlayerId | null; playerId: PlayerId | null };
  COMBAT_BEGIN: { currentPlayer: PlayerId };
  COMBAT_ENDED: { currentPlayer: PlayerId };
  COMBAT_DAMAGE_RESOLVED: { damageAssignments: GameMutation[]; currentPlayer: PlayerId; pass?: string };
  STACK_UPDATED: { before: StackObject[]; stack: StackObject[]; newAction?: StackObject };
  STACK_COUNTERED: { stackObj: StackObject };
  ACTION_PROPOSED: { actionType: string; playerId: PlayerId; stackObj: StackObject };
  ACTION_RESOLVED: { stackObj: StackObject; effects: ResolutionEffectResult[] };
  STACK_ITEM_RESOLVED: { effectId: string; stackObj: StackObject; fizzled: boolean; skipped?: 'illegal_targets' | 'object_failed' | 'countered' | 'condition_failed' | 'unresolved_parameter' };
  STACK_RESOLVED: { effectId: string; stackObj: StackObject; countered: boolean };
}

export interface EventIdentity {
  eventUuid: string;
  batchId: string;
  commandId?: string;
}

/** The uncommitted shape is also useful for external/debug event-bus consumers. */
export interface GameEvent<K extends string = string> {
  eventId: K;
  roomId: string;
  payload: K extends keyof GameEventPayloads ? GameEventPayloads[K] : Record<string, unknown>;
  eventUuid?: string;
  batchId?: string;
  commandId?: string;
}

export type EventDraft = {
  [K in keyof GameEventPayloads]: GameEvent<K>
}[keyof GameEventPayloads];
export type AppliedGameEvent = EventDraft & EventIdentity;

export interface CommandContext {
  commandId: string;
  action: string;
  playerId: PlayerId;
}

export interface BatchCause {
  kind: 'command' | 'engine' | 'trigger' | 'state-based-action';
  parentBatchId?: string;
  eventUuids?: string[];
}

/** Serializable timeline record: no full room snapshots. */
export interface RecordedEventBatch {
  batchId: string;
  command?: CommandContext;
  cause: BatchCause;
  events: AppliedGameEvent[];
}

/** Immutable room references remain available to rules/checkpoint consumers. */
export interface AppliedEventBatch extends RecordedEventBatch {
  before: GameRoom;
  after: GameRoom;
  mutations: GameMutation[];
}

export interface ResolutionEffectResult {
  effectId: string;
  fizzled: boolean;
  skipped?: 'illegal_targets' | 'object_failed' | 'countered' | 'condition_failed' | 'unresolved_parameter';
}
export interface ResolutionReport {
  stackObj: StackObject;
  effects: ResolutionEffectResult[];
}
