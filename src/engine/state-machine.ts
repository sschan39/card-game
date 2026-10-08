import { gameConfig } from '../config';
// src/engine/state-machine.ts
import { engineLogger } from '../shared/game-logger';
import { CardCharacteristicService } from './card-characteristic-service';
import { hasKeyword, lethalDamageFor } from './card-utils';
import { declarationPlayer } from '../shared/turn-utils';
import { gameReducer } from './game-reducer';
import type { GameMutation } from '../types/game-mutation.types';
import type { Phase } from '../types/game.state.types';
import { TURN_SEQUENCE } from '../types/game.state.types';
import type { GameRoom, PlayerId } from '../types/game.room.types';
import type { StackObject } from '../types/effect.types';
import type { CardInstance } from '../types/card.types';

/**
 * The successor of `phase` in the turn sequence, or null at the end.
 * cleanupStep wraps to stateTurnStart.
 */
function nextInTurn(phase: Phase): Phase | null {
  const i = TURN_SEQUENCE.indexOf(phase);
  if (i === -1) return null;
  if (i === TURN_SEQUENCE.length - 1) return 'stateTurnStart';
  return TURN_SEQUENCE[i + 1];
}

/**
 * Phases that resolve mechanically without a player decision. The director
 * auto-advances through these and stops at the first phase that needs input.
 */
const AUTO_PHASES: Phase[] = ['stateTurnStart', 'cleanupStep'];

function phaseNeedsInput(phase: Phase): boolean {
  return !AUTO_PHASES.includes(phase);
}

/**
 * Who receives priority when the director stops in `phase`.
 * Declarations await a turn-based decision; response windows belong to the active player.
 */
function defaultPriorityFor(phase: Phase, room: GameRoom): PlayerId | null {
  return declarationPlayer({ ...room, phase }) ? null : room.activeTurnPlayerId;
}

/**
 * StateMachine — phase/turn/priority transitions.
 *
 * Pure with respect to GameRoom: every method receives the current room
 * snapshot and returns GameMutation[] to apply. The engine (GameEngine)
 * sequences those mutations through the pure reducer.
 *
 * Engine control state (engineState) lives on GameRoom so it is serialized
 * and sent to clients.
 */
export interface PhaseStep {
  mutations: GameMutation[];
  phase: Phase;
  needsInput: boolean;
  priorityPlayerId: PlayerId | null;
}

export type PriorityPass =
  | { success: false; mutations: GameMutation[] }
  | { success: true; mutations: GameMutation[]; continuation: 'none' | 'resolve' | 'advance' };

export class StateMachine {
  readonly roomId: string;

  constructor(room: GameRoom) {
    this.roomId = room.roomId;
  }

  canTransition(room: GameRoom, to: Phase): boolean {
    // The stack is a zone, not a phase (MTG 116). Only the linear turn
    // sequence is a legal phase transition.
    if (nextInTurn(room.phase) === to) return true;
    // A completed declaration with no attackers skips blockers and damage.
    if (room.phase === 'declareAttackersStep' && room.combatDeclarations?.attackers && !room.combat.length && to === 'endCombatStep') return true;
    return false;
  }

  /**
   * Transition to a new phase. Returns mutations to apply.
   */
  transition(room: GameRoom, to: Phase): GameMutation[] {
    if (!this.canTransition(room, to)) {
      engineLogger.error('transition:invalid', `Invalid transition from ${room.phase} to ${to}`, { from: room.phase, to });
      return [];
    }

    const mutations: GameMutation[] = [];

    // Untap step: when entering stateTurnStart, untap all of active player's permanents
    // and reset their mana pool
    if (to === 'stateTurnStart') {
      const playerId = room.activeTurnPlayerId;
      for (const card of room.battlefield) {
        if (card.state.controllerId === playerId) {
          mutations.push({ type: 'UNTAP_CARD', cardUuid: card.uuid });
          mutations.push({ type: 'SET_SUMMONING_SICKNESS', cardUuid: card.uuid, value: false });
          mutations.push({ type: 'SET_ATTACKED_THIS_TURN', cardUuid: card.uuid, value: false });
        }
      }
      const player = room.players[playerId];
      if (player) {
        // Drain mana: set all colors to 0
        for (const color of Object.keys(player.mana) as Array<keyof typeof player.mana>) {
          mutations.push({ type: 'SET_MANA', playerId, color, amount: 0 });
        }
      }
    }

    // Cleanup step (CR 514): clear damage first, then strip end-of-turn effects.
    // Damage must be cleared BEFORE effects so a buffed creature that took
    // damage doesn't briefly become a 2/2 with 3 damage when the buff is
    // stripped. (Latent: today's batch-apply prevents SBA between these, but
    // the ordering is correct per CR 514.2 and future-proof.)
    if (to === 'cleanupStep') {
      mutations.push({ type: 'CLEAR_DAMAGE' });
      mutations.push({ type: 'CLEAR_END_OF_TURN_EFFECTS' });
    }

    // Reset declarations at combat boundaries.
    if (to === 'beginCombatStep' || to === 'endCombatStep') {
      mutations.push({ type: 'CLEAR_COMBAT' });
    }

    // Draw step (MTG 120.2a): the active player draws one card from their deck.
    // The card is moved from library to hand via MOVE_CARD.
    if (to === 'stateDrawPhase') {
      const playerId = room.activeTurnPlayerId;
      const player = room.players[playerId];
      if (player && player.deck.length > 0 && ((room.turnNumber ?? 1) !== 1 || (room.setup ?? gameConfig.setup).firstPlayerDrawsOnFirstTurn)) {
        const card = player.deck[player.deck.length - 1];
        mutations.push({
          type: 'MOVE_CARD',
          cardUuid: card.uuid,
          playerId: card.state.ownerId,
          from: 'library',
          to: 'hand',
          reason: 'draw',
        });
      }
    }

    // Combat step events and damage resolution.
    // combatDamageStep resolves all combat damage simultaneously (MTG CR 510).
    if (to === 'combatDamageStep') {
      const defendingPlayerId = room.activeTurnPlayerId === room.player1Id
        ? room.player2Id! : room.player1Id;

      const damage = new Map<string, number>();
      let defendingLife = room.players[defendingPlayerId].life;
      const loseLife = (amount: number, source: string) => {
        defendingLife -= amount;
        mutations.push({ type: 'SET_LIFE', playerId: defendingPlayerId, amount: defendingLife, damageSource: source, combat: true });
      };
      const dealDamage = (card: CardInstance, amount: number, source: string) => {
        const total = (damage.get(card.uuid) ?? card.state.damageTaken ?? 0) + amount;
        damage.set(card.uuid, total);
        mutations.push({ type: 'SET_DAMAGE', cardUuid: card.uuid, amount: total, source, combat: true });
      };
      for (const snapshot of room.combat) {
        const attacker = room.battlefield.find(card => card.uuid === snapshot.attacker.uuid);
        if (!attacker) continue;
        const decl = { ...snapshot, attacker,
          attackerPower: Math.max(0, CardCharacteristicService.resolvePower(room, attacker)),
          blockers: snapshot.blockers.flatMap(blocker => {
            const live = room.battlefield.find(card => card.uuid === blocker.uuid);
            return live ? [live] : [];
          }) };

        if (snapshot.blockers.length === 0) {
          // Unblocked: attacker deals damage to defending player
          loseLife(decl.attackerPower, decl.attacker.uuid);
        } else {
          // Blocked: attacker assigns damage among blockers in attacker-neutral
          // order (highest power first, lowest toughness tiebreaker, uuid final
          // tiebreaker — NOT the defender's pairing order, per CR 510.1c).
          const ordered = [...decl.blockers].sort((a, b) => {
            const pa = CardCharacteristicService.resolvePower(room, a);
            const pb = CardCharacteristicService.resolvePower(room, b);
            if (pa !== pb) return pb - pa;           // higher power first
            const ta = CardCharacteristicService.resolveToughness(room, a);
            const tb = CardCharacteristicService.resolveToughness(room, b);
            if (ta !== tb) return ta - tb;           // lower toughness first
            return a.uuid.localeCompare(b.uuid);     // deterministic tiebreaker
          });

          let remaining = decl.attackerPower;

          // Attacker deals damage to blockers (lethal-first)
          for (const blocker of ordered) {
            if (remaining <= 0) break;
            const lethal = lethalDamageFor(room, blocker);
            const assigned = Math.min(remaining, lethal);
            dealDamage(blocker, assigned, decl.attacker.uuid);
            remaining -= assigned;
          }

          // Counter-damage uses the same live pre-damage board.
          for (const blocker of ordered) {
            const blockerPower = CardCharacteristicService.resolvePower(room, blocker);
            dealDamage(decl.attacker, Math.max(0, blockerPower), blocker.uuid);
          }

          // Trample: excess damage over total lethal → defending player
          if (hasKeyword(decl.attacker, 'Trample') && remaining > 0) {
            loseLife(remaining, decl.attacker.uuid);
          }
        }
      }
    }

    mutations.push({ type: 'SET_PHASE', phase: to });

    return mutations;
  }

  /** Plan exactly one live step. The engine settles it before asking for another. */
  planNextStep(room: GameRoom, intent: 'complete' | 'skipToEnd' = 'complete'): PhaseStep | null {
    const phase = intent === 'skipToEnd' && room.phase !== 'stateEndPhase' ? 'stateEndPhase'
      : room.phase === 'declareAttackersStep' && room.combatDeclarations?.attackers && !room.combat.length ? 'endCombatStep' : nextInTurn(room.phase);
    if (!phase) return null;
    const mutations: GameMutation[] = [];
    let working = room;
    if (phase === 'stateTurnStart') {
      const turn = this.switchTurn(room);
      mutations.push(...turn);
      working = turn.reduce(gameReducer, room);
    }
    if (intent === 'skipToEnd' && phase === 'stateEndPhase' && !this.canTransition(working, phase)) {
      mutations.push({ type: 'SET_PHASE', phase });
    } else {
      mutations.push(...this.transition(working, phase));
    }
    return { mutations, phase, needsInput: phaseNeedsInput(phase), priorityPlayerId: defaultPriorityFor(phase, working) };
  }

  switchTurn(room: GameRoom): GameMutation[] {
    const newPlayer = room.activeTurnPlayerId === room.player1Id
      ? room.player2Id!
      : room.player1Id;

    return [{ type: 'SET_TURN', playerId: newPlayer, advance: true }];
  }

  isPlayerTurn(room: GameRoom, playerId: PlayerId): boolean {
    return room.activeTurnPlayerId === playerId;
  }

  givePriorityTo(playerId: PlayerId): GameMutation[] {

    return [
      { type: 'SET_PRIORITY', playerId },
      { type: 'SET_ENGINE_STATE', state: 'waiting_for_player' },
    ];
  }

  passPriority(room: GameRoom, playerId: PlayerId): PriorityPass {
    if (room.priorityPlayerId !== playerId) {
      return { success: false, mutations: [] };
    }

    const opponent = playerId === room.player1Id ? room.player2Id! : room.player1Id;

    // Non-empty stack + both players passed → resolve the top object.
    if (room.stack.length > 0 && room.lastPassedPlayerId === opponent) {
      return {
        success: true, continuation: 'resolve',
        mutations: [
          { type: 'SET_PRIORITY', playerId: null },
          { type: 'SET_LAST_PASSED', playerId: null },
          { type: 'SET_ENGINE_STATE', state: 'resolving_stack' },
        ],
      };
    }

    // Empty stack + both players passed → advance the phase.
    if (room.stack.length === 0 && room.lastPassedPlayerId === opponent) {
      return {
        success: true, continuation: 'advance',
        mutations: [
          { type: 'SET_PRIORITY', playerId: null },
          { type: 'SET_LAST_PASSED', playerId: null },
        ],
      };
    }

    // Otherwise, pass priority to the opponent.
    return {
      success: true, continuation: 'none',
      mutations: [
        { type: 'SET_LAST_PASSED', playerId },
        ...this.givePriorityTo(opponent),
      ],
    };
  }

  /**
   * Assign priority after a stack addition. The engine owns event publication.
   * The engine has already applied the handler's stack insertion.
   *
   * The stack is a zone, not a phase (MTG 116) — the phase does NOT change.
   *
   * MTG 116.3d: After a spell or ability is put on the stack, the player who
   * cast/activated it gets priority first (not the opponent).
   */
  addToStack(_room: GameRoom, stackObj: StackObject): GameMutation[] {

    // MTG 116.3d: The player who put the spell/ability on the stack gets priority.
    return this.givePriorityTo(stackObj.controllerId);
  }
}
