/**
 * src/types/game-mutation.types.ts
 * Discriminated union of atomic state mutations for the pure game reducer.
 *
 * Handlers produce GameMutation[] instead of mutating GameRoom directly.
 * The engine sequences each mutation through gameReducer(state, mutation) => newState.
 */

import type { CardZone, ManaColor, ManaCost } from './card.types';
import type { GameStateName } from './game.state.types';
import type { PlayerId } from './game.room.types';
import type { StackObject } from './effect.types';

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
  | { type: 'SET_DAMAGE'; cardUuid: string; amount: number }
  | { type: 'ADD_COUNTER'; cardUuid: string; counterType: string; amount: number }
  | { type: 'REMOVE_COUNTER'; cardUuid: string; counterType: string; amount: number }
  // Modify a creature's effective power/toughness (net bonus over blueprint).
  // Absence of a field leaves that stat untouched. Negative values debuff.
  | { type: 'SET_POWER_TOUGHNESS'; cardUuid: string; powerMod?: number; toughnessMod?: number }
  // End-of-turn cleanup: zero the powerMod/toughnessMod on every permanent on
  // the battlefield, expiring "until end of turn" buffs (e.g. GRANT_STATS with
  // duration END_OF_TURN) as switchTurn flips to the opponent's turn.
  | { type: 'CLEAR_END_OF_TURN_BUFFS' }

  // Player mutations
  | { type: 'SET_LIFE'; playerId: PlayerId; amount: number }
  | { type: 'SET_MANA'; playerId: PlayerId; color: ManaColor; amount: number }
  | { type: 'ADD_MANA'; playerId: PlayerId; color: ManaColor; amount: number }
  | { type: 'SPEND_MANA'; playerId: PlayerId; cost: ManaCost }
  // Card draw: move the top `amount` cards of a player's deck to their hand.
  // The amount is clamped to the deck size (drawing from an empty deck draws 0).
  | { type: 'DRAW_CARD'; playerId: PlayerId; amount?: number }

  // Stack mutations
  | { type: 'PUSH_STACK'; stackObject: StackObject }
  | { type: 'POP_STACK' }
  | { type: 'SET_COUNTERED'; stackUuid: string }

  // Phase / Turn mutations
  | { type: 'SET_PHASE'; phase: GameStateName }
  | { type: 'SET_PREVIOUS_PHASE'; phase: GameStateName | null }
  | { type: 'SET_TURN'; playerId: PlayerId }
  | { type: 'SET_PRIORITY'; playerId: PlayerId | null }
  | { type: 'SET_LAST_PASSED'; playerId: PlayerId | null }

  // Win condition: end the game. Marks currentPhase 'gameOver', records the
  // winnerId, and clears priority so no further actions are accepted.
  | { type: 'GAME_OVER'; winnerId: PlayerId | null }

  // Combat: assign a blocker (CardInstance uuid) to an attacking StackObject.
  // Purely additive — unblocked attacks still deal face damage on resolution.
  | { type: 'DECLARE_BLOCKER'; stackUuid: string; blockerUuid: string }

  // RPS mini-game mutations
  | { type: 'SET_RPS_STATUS'; status: string }
  | { type: 'SET_RPS_PLAYED_CARD'; playerId: PlayerId; card: string }
  // Clear both players' RPS choices (used on a tie so they re-pick).
  | { type: 'RESET_RPS' };
