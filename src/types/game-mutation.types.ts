/**
 * src/types/game-mutation.types.ts
 * Discriminated union of atomic state mutations for the pure game reducer.
 *
 * Handlers produce GameMutation[] instead of mutating GameRoom directly.
 * The engine sequences each mutation through gameReducer(state, mutation) => newState.
 */

import type { CardZone, ManaColor, ManaCost, ContinuousEffectEntry } from './card.types';
import type { Phase, GameStatus } from './game.state.types';
import type { PlayerId } from './game.room.types';
import type { StackObject, CombatDeclaration } from './effect.types';

export type GameMutation =
  // Zone mutations — playerId is REQUIRED because hand/graveyard/library are
  // per-player arrays. playerId is the card's ownerId; for shared zones
  // (battlefield, stack) it identifies ownership but the array is shared.
  | { type: 'MOVE_CARD'; cardUuid: string; playerId: PlayerId; from: CardZone; to: CardZone; toIndex?: number }
  | { type: 'SET_CARD_ZONE'; cardUuid: string; playerId: PlayerId; zone: CardZone }

  // Card state mutations
  | { type: 'TAP_CARD'; cardUuid: string }
  | { type: 'UNTAP_CARD'; cardUuid: string }
  | { type: 'SET_SUMMONING_SICKNESS'; cardUuid: string; value: boolean }
  | { type: 'SET_ATTACKED_THIS_TURN'; cardUuid: string; value: boolean }
  | { type: 'SET_DAMAGE'; cardUuid: string; amount: number; source?: string }
  | { type: 'ADD_COUNTER'; cardUuid: string; counterType: string; amount: number }
  | { type: 'REMOVE_COUNTER'; cardUuid: string; counterType: string; amount: number }

  // Continuous effect pool mutations (MTG-faithful global registry)
  | { type: 'ADD_CONTINUOUS_EFFECT'; entry: ContinuousEffectEntry }
  | { type: 'REMOVE_CONTINUOUS_EFFECT'; source: string }   // remove all entries from a source
  | { type: 'CLEAR_END_OF_TURN_EFFECTS' }                  // fired at cleanupStep
  | { type: 'CLEAR_DAMAGE' }                              // fired at cleanupStep (CR 514.2)

  // Player mutations
  | { type: 'SET_LIFE'; playerId: PlayerId; amount: number }
  | { type: 'SET_MANA'; playerId: PlayerId; color: ManaColor; amount: number }
  | { type: 'ADD_MANA'; playerId: PlayerId; color: ManaColor; amount: number }
  | { type: 'SPEND_MANA'; playerId: PlayerId; cost: ManaCost }

  // Stack mutations
  | { type: 'PUSH_STACK'; stackObject: StackObject }
  | { type: 'POP_STACK' }
  | { type: 'SET_COUNTERED'; stackUuid: string }
  | { type: 'SET_FIZZLED'; stackUuid: string }

  // Combat mutations (turn-based action — declared attackers, NOT on the stack)
  | { type: 'DECLARE_ATTACKERS'; declarations: CombatDeclaration[] }
  | { type: 'ASSIGN_BLOCKERS'; attackerUuid: string; blockerUuids: string[] }
  | { type: 'CLEAR_COMBAT' }

  // Phase / Turn mutations
  | { type: 'SET_PHASE'; phase: Phase }
  | { type: 'SET_STATUS'; status: GameStatus }
  | { type: 'SET_ENGINE_STATE'; state: 'waiting_for_player' | 'resolving_stack' | 'state_based_actions' }
  | { type: 'SET_TURN'; playerId: PlayerId }
  | { type: 'SET_PRIORITY'; playerId: PlayerId | null }
  | { type: 'SET_LAST_PASSED'; playerId: PlayerId | null }

  // RPS mini-game mutations
  | { type: 'SET_RPS_STATUS'; status: string }
  | { type: 'SET_RPS_PLAYED_CARD'; playerId: PlayerId; card: string };
