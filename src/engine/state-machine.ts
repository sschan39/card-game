// src/engine/state-machine.ts
import { EventBus } from './event-bus';
import { engineLogger } from '../shared/game-logger';
import { CardCharacteristicService } from './card-characteristic-service';
import { hasKeyword, lethalDamageFor } from './card-utils';
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
const AUTO_PHASES: Phase[] = [
  'stateTurnStart',
  'stateDrawPhase',
  'combatDamageStep',
  'endCombatStep',
  'stateEndPhase',
  'cleanupStep',
];

function phaseNeedsInput(phase: Phase): boolean {
  return !AUTO_PHASES.includes(phase);
}

/**
 * Who receives priority when the director stops in `phase`.
 * declareBlockersStep goes to the defending player; everything else to the
 * active turn player.
 */
function defaultPriorityFor(phase: Phase, room: GameRoom): PlayerId {
  if (phase === 'declareBlockersStep') {
    return room.activeTurnPlayerId === room.player1Id
      ? room.player2Id!
      : room.player1Id;
  }
  return room.activeTurnPlayerId;
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
export class StateMachine {
  readonly roomId: string;
  private eventBus: EventBus;

  constructor(room: GameRoom, eventBus: EventBus) {
    this.roomId = room.roomId;
    this.eventBus = eventBus;
  }

  canTransition(room: GameRoom, to: Phase): boolean {
    // The stack is a zone, not a phase (MTG 116). Only the linear turn
    // sequence is a legal phase transition.
    if (nextInTurn(room.phase) === to) return true;
    // Skip-combat: the main phase may jump straight to the end phase.
    if (room.phase === 'stateMainPhase' && to === 'stateEndPhase') return true;
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

      this.eventBus.emit({
        eventId: 'TURN_STARTED',
        roomId: this.roomId,
        payload: { currentPlayer: room.activeTurnPlayerId },
      });
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

    // End of combat step: clear declared attackers. In the current
    // single-attacker model, combat resolves immediately (damage applied in
    // propose()), so room.combat is a transient record. Clearing here prevents
    // stale declarations from leaking across turns. (Post-blockers, this moves
    // to the end of the combat damage step instead.)
    if (to === 'endCombatStep') {
      mutations.push({ type: 'CLEAR_COMBAT' });
    }

    // Draw step (MTG 120.2a): the active player draws one card from their deck.
    // The card is moved from library to hand via MOVE_CARD.
    if (to === 'stateDrawPhase') {
      const playerId = room.activeTurnPlayerId;
      const player = room.players[playerId];
      if (player && player.deck.length > 0) {
        const card = player.deck[player.deck.length - 1];
        mutations.push({
          type: 'MOVE_CARD',
          cardUuid: card.uuid,
          playerId: card.state.ownerId,
          from: 'library',
          to: 'hand',
        });
      }
    }

    // Combat step events and damage resolution.
    // combatDamageStep resolves all combat damage simultaneously (MTG CR 510).
    if (to === 'combatDamageStep') {
      const defendingPlayerId = room.activeTurnPlayerId === room.player1Id
        ? room.player2Id! : room.player1Id;

      for (const decl of room.combat) {
        if (decl.blockers.length === 0) {
          // Unblocked: attacker deals damage to defending player
          const defender = room.players[defendingPlayerId];
          mutations.push({
            type: 'SET_LIFE',
            playerId: defendingPlayerId,
            amount: defender.life - decl.attackerPower,
          });
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
            mutations.push({
              type: 'SET_DAMAGE',
              cardUuid: blocker.uuid,
              amount: (blocker.state.damageTaken || 0) + assigned,
              source: decl.attacker.uuid,
            });
            remaining -= assigned;
          }

          // Each blocker deals its power to the attacker.
          // Accumulate locally because SET_DAMAGE overwrites (not additive),
          // and decl.attacker is a snapshot — it doesn't reflect prior mutations.
          let totalCounterDamage = decl.attacker.state.damageTaken || 0;
          for (const blocker of ordered) {
            const blockerPower = CardCharacteristicService.resolvePower(room, blocker);
            totalCounterDamage += blockerPower;
            mutations.push({
              type: 'SET_DAMAGE',
              cardUuid: decl.attacker.uuid,
              amount: totalCounterDamage,
              source: blocker.uuid,
            });
          }

          // Trample: excess damage over total lethal → defending player
          if (hasKeyword(decl.attacker, 'Trample') && remaining > 0) {
            const defender = room.players[defendingPlayerId];
            mutations.push({
              type: 'SET_LIFE',
              playerId: defendingPlayerId,
              amount: defender.life - remaining,
            });
          }
        }
      }

      this.eventBus.emit({
        eventId: 'COMBAT_DAMAGE_RESOLVED',
        roomId: this.roomId,
        payload: { damageAssignments: [] },
      });
    }

    // Other combat step events (stub payloads for now)
    const combatEvent: Record<string, { eventId: string; payload: Record<string, unknown> }> = {
      beginCombatStep: { eventId: 'COMBAT_BEGIN', payload: { currentPlayer: room.activeTurnPlayerId } },
      declareAttackersStep: { eventId: 'ATTACKERS_DECLARED', payload: { attackerIds: [] } },
      declareBlockersStep: { eventId: 'BLOCKERS_DECLARED', payload: { blockerAssignments: [] } },
      endCombatStep: { eventId: 'COMBAT_ENDED', payload: { currentPlayer: room.activeTurnPlayerId } },
    };
    const combat = combatEvent[to];
    if (combat) {
      this.eventBus.emit({
        eventId: combat.eventId,
        roomId: this.roomId,
        payload: combat.payload,
      });
    }

    mutations.push({ type: 'SET_PHASE', phase: to });

    this.eventBus.emit({
      eventId: 'PHASE_CHANGED',
      roomId: this.roomId,
      payload: { phase: to, currentPlayer: room.activeTurnPlayerId },
    });

    return mutations;
  }

  /**
   * Advance the phase clock, stopping at the first phase that requires player
   * input. Returns mutations to apply.
   *
   * @param room   - current room snapshot
   * @param intent - 'complete' (normal advance) or 'skipToEnd' (skip combat)
   */
  advancePhase(room: GameRoom, intent: 'complete' | 'skipToEnd'): GameMutation[] {
    const mutations: GameMutation[] = [];
    // Fold mutations into a working copy so each step sees the effects of the
    // previous one (e.g. switchTurn before untap).
    let working = room;

    const apply = (next: GameMutation[]) => {
      mutations.push(...next);
      for (const m of next) working = gameReducer(working, m);
    };

    // skipToEnd: jump straight to the end phase, then auto-advance from there.
    if (intent === 'skipToEnd') {
      if (this.canTransition(working, 'stateEndPhase')) {
        apply(this.transition(working, 'stateEndPhase'));
      } else {
        // From a non-main phase, skip directly to the end phase. stateEndPhase
        // has no per-phase side effects, so a bare SET_PHASE is safe.
        apply([{ type: 'SET_PHASE', phase: 'stateEndPhase' }]);
      }
    }

    for (let guard = 0; guard < TURN_SEQUENCE.length; guard++) {
      const next = nextInTurn(working.phase);
      if (!next) {
        engineLogger.warn('phase:no-next', `no successor from ${working.phase}`, { phase: working.phase });
        break; // design-gap alarm — never guess
      }

      // Wrap: switch turn BEFORE untap so the NEW player's permanents untap.
      if (next === 'stateTurnStart') {
        apply(this.switchTurn(working));
      }

      apply(this.transition(working, next));

      engineLogger.debug('phase:advance', `${next}`, {
        from: room.phase,
        to: next,
        auto: !phaseNeedsInput(next),
      });

      if (phaseNeedsInput(next)) {
        apply(this.givePriorityTo(defaultPriorityFor(next, working)));
        break;
      }

      engineLogger.debug('phase:auto-skip', `${next} auto-advanced (no input needed)`);
    }

    return mutations;
  }

  switchTurn(room: GameRoom): GameMutation[] {
    const newPlayer = room.activeTurnPlayerId === room.player1Id
      ? room.player2Id!
      : room.player1Id;

    this.eventBus.emit({
      eventId: 'TURN_SWITCHED',
      roomId: this.roomId,
      payload: { newPlayer },
    });

    return [{ type: 'SET_TURN', playerId: newPlayer }];
  }

  isPlayerTurn(room: GameRoom, playerId: PlayerId): boolean {
    return room.activeTurnPlayerId === playerId;
  }

  givePriorityTo(playerId: PlayerId): GameMutation[] {
    this.eventBus.emit({
      eventId: 'PRIORITY_GIVEN',
      roomId: this.roomId,
      payload: { playerId },
    });
    return [
      { type: 'SET_PRIORITY', playerId },
      { type: 'SET_ENGINE_STATE', state: 'waiting_for_player' },
    ];
  }

  passPriority(room: GameRoom, playerId: PlayerId): { success: boolean; mutations: GameMutation[] } {
    if (room.priorityPlayerId !== playerId) {
      return { success: false, mutations: [] };
    }

    const opponent = playerId === room.player1Id ? room.player2Id! : room.player1Id;

    // Non-empty stack + both players passed → resolve the top object.
    if (room.stack.length > 0 && room.lastPassedPlayerId === opponent) {
      return {
        success: true,
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
        success: true,
        mutations: [
          { type: 'SET_PRIORITY', playerId: null },
          { type: 'SET_LAST_PASSED', playerId: null },
          ...this.advancePhase(room, 'complete'),
        ],
      };
    }

    // Otherwise, pass priority to the opponent.
    return {
      success: true,
      mutations: [
        { type: 'SET_LAST_PASSED', playerId },
        ...this.givePriorityTo(opponent),
      ],
    };
  }

  /**
   * Handle stack addition: event emission and priority.
   * The handler's propose() already pushed to room.stack via PUSH_STACK mutation.
   *
   * The stack is a zone, not a phase (MTG 116) — the phase does NOT change.
   *
   * MTG 116.3d: After a spell or ability is put on the stack, the player who
   * cast/activated it gets priority first (not the opponent).
   */
  addToStack(room: GameRoom, stackObj: StackObject): GameMutation[] {
    this.eventBus.emit({
      eventId: 'STACK_UPDATED',
      roomId: this.roomId,
      payload: { stack: room.stack, newAction: stackObj },
    });

    // MTG 116.3d: The player who put the spell/ability on the stack gets priority.
    return this.givePriorityTo(stackObj.controllerId);
  }
}
