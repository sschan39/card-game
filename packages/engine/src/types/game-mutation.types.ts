/**
 * src/types/game-mutation.types.ts
 * Discriminated union of atomic state mutations for the pure game reducer.
 *
 * Handlers produce GameMutation[] instead of mutating GameRoom directly.
 * The engine sequences each mutation through gameReducer(state, mutation) => newState.
 */

import type { CardInstance, CardSnapshot, CardZone, ManaColor, ManaPayment, ContinuousEffectEntry } from './card.types';
import type { Phase, GameStatus } from './game.state.types';
import type { GameRoom, GameOutcome, PlayerId } from './game.room.types';
import type { StackObject, SpellStackObject, CombatDeclaration } from './effect.types';
import type { LibraryCardReference, LibraryPlacement } from './library.types';

export type GameMutation = GameMutationBody & { cause?: import('./change-cause.types').ChangeCause; kill?: import('./change-cause.types').KillOutcome };
type GameMutationBody =
  | { type: 'CREATE_TOKEN'; tokenId: string; cardUuid: string; playerId: PlayerId; sequence: number }
  | { type: 'RECORD_CARD_OBSERVATION'; observation: import('./card-observation.types').CardObservation; sequence: number }
  | { type: 'CLOSE_CARD_OBSERVATIONS'; ownerStackUuid: string }
  | { type: 'SHUFFLE_LIBRARY'; playerId: PlayerId; order: LibraryCardReference[] }
  | { type: 'REORDER_LIBRARY'; playerId: PlayerId; order: LibraryCardReference[] }
  | { type: 'ADD_REPLACEMENT_EFFECT'; effect: Omit<import('./proposed-event.types').ReplacementDefinition, 'id'> & { id?: string } }
  | { type: 'REMOVE_REPLACEMENT_EFFECT'; id: string }
  | { type: 'CEASE_CARD'; cardUuid: string; zoneRevision: number; playerId: PlayerId; zone: CardZone }
  | { type: 'UNATTACH_CARD'; cardUuid: string }
  | { type: 'ATTACH_CARD'; cardUuid: string; zoneRevision: number; hostUuid: string; hostRevision: number; controllerId: string }
  | { type: 'SET_BATTLE_PROTECTOR'; cardUuid: string; playerId: PlayerId }
  | { type: 'DESTROY_CARD'; cardUuid: string; zoneRevision: number; requiredPayment?: true }
  | { type: 'SACRIFICE_CARD'; cardUuid: string; zoneRevision: number }
  | { type: 'REGENERATE_CARD'; cardUuid: string; zoneRevision: number }
  | { type: 'CHANGE_LIFE'; playerId: PlayerId; amount: number; replacementProcessed?: boolean }
  | { type: 'SET_FAILED_DRAW'; playerId: PlayerId; value: boolean }
  | { type: 'DRAW_CARDS'; playerId: PlayerId; amount: number; position?: 'bottom' }
  | { type: 'MARK_DAMAGE'; cardUuid: string; zoneRevision: number; amount: number }
  | { type: 'SET_DEATHTOUCH_DAMAGE'; cardUuid: string; value: boolean }
  | { type: 'SET_REPLACEMENT_EFFECTS'; effects: import('./proposed-event.types').ReplacementDefinition[] }
  | { type: 'CANCEL_ATTACKER'; cardUuid: string; zoneRevision: number }
  | { type: 'SET_COMBAT_DAMAGE'; state: import('./combat.types').CombatDamageState | null }
  | { type: 'APPLY_DAMAGE_BATCH'; assignments: import('./damage.types').DamageAssignment[]; replacementProcessed?: boolean; results?: GameMutation[] }
  | { type: 'ADD_DELAYED_TRIGGER'; registration: import('./trigger.types').DelayedTrigger }
  | { type: 'REMOVE_DELAYED_TRIGGER'; id: string }
  | { type: 'SET_TURN_HISTORY'; history: import('./trigger.types').TurnHistory }
  | { type: 'RECORD_ABILITY_USE'; key: string; turnNumber?: number }
  | { type: 'RECORD_GAME_RULE_USE'; key: string }
  | { type: 'RECORD_LAND_PLAY'; playerId: PlayerId; turnNumber?: number }
  | { type: 'SET_TRIGGER_QUEUE'; queue: import('./trigger.types').TriggerQueue | null }
  | { type: 'SET_PENDING_CHOICE'; choice: import('./choice.types').PendingChoice | null }
  | { type: 'SET_PENDING_TRIGGERS'; mutations: GameMutation[] }
  // playerId identifies the source zone's holder, or the owner in shared zones.
  // Hand entry can name another recipient. Other private destinations use the owner.
  | { type: 'MOVE_CARD'; cardUuid: string; playerId: PlayerId; from: CardZone; to: CardZone; toIndex?: number; handRecipientId?: PlayerId;
      zoneRevision?: number; libraryPlacement?: LibraryPlacement;
      /** Required at runtime for atomic insertion into the spell stack. */
      stackObject?: SpellStackObject; controllerId?: PlayerId; sourceSnapshot?: CardSnapshot; reason?: 'draw' | 'discard' | 'cast' | 'destroy' | 'sacrifice'; replacementProcessed?: boolean }

  // Card state mutations
  | { type: 'TAP_CARD'; cardUuid: string; skipNextUntap?: true }
  | { type: 'UNTAP_CARD'; cardUuid: string; natural?: true }
  | { type: 'SET_SUMMONING_SICKNESS'; cardUuid: string; value: boolean }
  | { type: 'SET_ATTACKED_THIS_TURN'; cardUuid: string; value: boolean }
  | { type: 'SET_DAMAGE'; cardUuid: string; amount: number; source?: string; combat?: boolean; damageSourceInfo?: CardSnapshot }
  | { type: 'ADD_COUNTER'; cardUuid: string; counterType: string; amount: number; sourceControllerId?: PlayerId; sourceInfo?: CardSnapshot; replacementProcessed?: boolean }
  | { type: 'REMOVE_COUNTER'; cardUuid: string; counterType: string; amount: number; sourceControllerId?: PlayerId; sourceInfo?: CardSnapshot; replacementProcessed?: boolean }

  // Continuous effect pool mutations (MTG-faithful global registry)
  | { type: 'ADD_CONTINUOUS_EFFECT'; entry: ContinuousEffectEntry }
  | { type: 'REMOVE_CONTINUOUS_EFFECT'; id: string; source?: never; dependentOnly?: never }
  | { type: 'REMOVE_CONTINUOUS_EFFECT'; source: string; dependentOnly?: boolean; id?: never }
  | { type: 'CLEAR_END_OF_TURN_EFFECTS' }                  // fired at cleanupStep
  | { type: 'CLEAR_DAMAGE' }                              // fired at cleanupStep (CR 514.2)

  // Player mutations
  /** Setup replacement of freshly initialized cards; normal play uses MOVE_CARD. */
  | { type: 'SET_PLAYER_ZONES'; playerId: PlayerId; deck: CardInstance[]; hand: CardInstance[] }
  | { type: 'SET_LIFE'; playerId: PlayerId; amount: number; damageSource?: string; combat?: boolean; damageSourceInfo?: CardSnapshot; replacementProcessed?: boolean }
  | { type: 'SET_MANA'; playerId: PlayerId; color: ManaColor; amount: number }
  | { type: 'ADD_MANA'; playerId: PlayerId; color: ManaColor; amount: number }
  | { type: 'SPEND_MANA'; playerId: PlayerId; cost: ManaPayment }

  // Stack mutations
  | { type: 'PUSH_STACK'; stackObject: StackObject }
  | { type: 'POP_STACK' }
  | { type: 'REMOVE_STACK'; stackUuid: string }
  | { type: 'COUNTER_STACK'; stackUuid: string }
  | { type: 'SET_COUNTERED'; stackUuid: string }
  | { type: 'SET_FIZZLED'; stackUuid: string }

  // Combat mutations (turn-based action — declared attackers, NOT on the stack)
  | { type: 'DECLARE_ATTACKERS'; declarations: CombatDeclaration[] }
  | { type: 'ASSIGN_BLOCKERS'; attackerUuid: string; blockerUuids: string[] }
  | { type: 'COMPLETE_BLOCKER_DECLARATION' }
  | { type: 'CLEAR_COMBAT' }

  // Phase / Turn mutations
  | { type: 'SET_PHASE'; phase: Phase }
  | { type: 'SET_STATUS'; status: GameStatus }
  | { type: 'END_GAME'; outcome: GameOutcome }
  | { type: 'SET_ENGINE_STATE'; state: GameRoom['engineState'] }
  | { type: 'SET_TURN'; playerId: PlayerId; advance?: boolean }
  | { type: 'SET_PRIORITY'; playerId: PlayerId | null }
  | { type: 'SET_LAST_PASSED'; playerId: PlayerId | null }

  // RPS mini-game mutations
  | { type: 'SET_RPS_STATUS'; status: string }
  | { type: 'SET_RPS_PLAYED_CARD'; playerId: PlayerId; card: string };
