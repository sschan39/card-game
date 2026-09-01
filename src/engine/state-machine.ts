// src/engine/state-machine.ts
import { EventBus } from './event-bus';
import type { GameMutation } from '../types/game-mutation.types';
import type { GameStateName, GameTransitionMap } from '../types/game.state.types';
import type { GameRoom, PlayerId } from '../types/game.room.types';
import type { StackObject } from '../types/effect.types';

const TRANSITIONS: GameTransitionMap = {
  waiting: ['RPS'],
  RPS: ['stateTurnStart', 'RPS', 'Stack'],
  stateTurnStart: ['stateDrawPhase', 'Stack'],
  stateDrawPhase: ['stateMainPhase', 'Stack'],
  stateMainPhase: ['stateBattlePhase', 'stateEndPhase', 'Stack'],
  stateBattlePhase: ['endCombat', 'stateEndPhase', 'Stack'],
  endCombat: ['stateEndPhase', 'Stack'],
  stateEndPhase: ['cleanupStep', 'Stack'],
  cleanupStep: ['stateTurnStart'],
  Stack: [],
  gameOver: [],
};

/**
 * Phases in which a phase begin grants the active player priority.
 * (MTG parity: each phase/step begins with the active player holding priority.)
 * These are the "turn/phase cycle" states; RPS and Stack are excluded because
 * they manage priority explicitly (submitRpsChoice / addToStack / passPriority).
 */
const PRIORITY_GRANTING_PHASES: ReadonlySet<GameStateName> = new Set<GameStateName>([
  'stateTurnStart',
  'stateDrawPhase',
  'stateMainPhase',
  'stateBattlePhase',
  'endCombat',
  'stateEndPhase',
  'cleanupStep',
]);

/**
 * Natural successor when both players pass a non-Stack phase with no spell on
 * the stack. Mirrors the linear turn cycle; used by resolveCurrentPhase.
 */
const NEXT_PHASE: Partial<Record<GameStateName, GameStateName>> = {
  stateTurnStart: 'stateDrawPhase',
  stateDrawPhase: 'stateMainPhase',
  stateMainPhase: 'stateBattlePhase',
  stateBattlePhase: 'stateEndPhase',
  endCombat: 'stateEndPhase',
  stateEndPhase: 'cleanupStep',
  cleanupStep: 'stateTurnStart',
};

/**
 * Pure win-condition check: return the winning player id when any player's
 * life is at or below 0, otherwise null. Only both players existing and both
 * in room.players are considered. Returns null if the game has already ended.
 *
 * MTG parity: a player loses when they have 0 or less life. If somehow both
 * are at or below 0 simultaneously, the winner is the player with strictly
 * higher life (life total difference decides).
 */
export function detectGameWinner(room: GameRoom): PlayerId | null {
  if (room.currentPhase === 'gameOver') return null;

  const players = [room.player1Id, room.player2Id].filter(
    (id): id is PlayerId => id != null && id in room.players
  );
  if (players.length < 2) return null;

  const atOrBelowZero = players.filter(id => (room.players[id].life ?? 0) <= 0);
  if (atOrBelowZero.length === 0) return null;

  const survivor = players.find(id => !atOrBelowZero.includes(id));
  if (survivor) return survivor;

  // Both at/below zero: the one with the higher life total wins (ties → null).
  const [a, b] = atOrBelowZero;
  const lifeA = room.players[a].life;
  const lifeB = room.players[b].life;
  if (lifeA > lifeB) return a;
  if (lifeB > lifeA) return b;
  return null;
}

/**
 * StateMachine — phase/turn/priority transitions.
 *
 * Pure with respect to GameRoom: every method receives the current room
 * snapshot and returns GameMutation[] to apply. The engine (GameEngine)
 * sequences those mutations through the pure reducer.
 *
 * Engine-local control flags (waitingForResponse, stackOpen) stay on the
 * instance — they are never serialized or sent to the client.
 */
export class StateMachine {
  readonly roomId: string;
  private eventBus: EventBus;

  waitingForResponse = false;
  stackOpen = true;

  constructor(room: GameRoom, eventBus: EventBus) {
    this.roomId = room.roomId;
    this.eventBus = eventBus;
  }

  canTransition(room: GameRoom, to: GameStateName): boolean {
    if (to === 'gameOver') return true;
    if (!this.stackOpen && to === 'Stack') return false;
    return TRANSITIONS[room.currentPhase]?.includes(to) ?? false;
  }

  /**
   * Transition to a new phase. Returns mutations to apply.
   * previousPhase is stored in GameRoom (observable), not on StateMachine.
   */
  transition(room: GameRoom, to: GameStateName): GameMutation[] {
    if (!this.canTransition(room, to)) {
      console.error(`Invalid transition from ${room.currentPhase} to ${to}`);
      return [];
    }

    const mutations: GameMutation[] = [];

    if (to === 'Stack') {
      mutations.push({ type: 'SET_PREVIOUS_PHASE', phase: room.currentPhase });
    }

    // Untap step: when entering stateTurnStart, untap all of active player's permanents
    // and reset their mana pool
    if (to === 'stateTurnStart') {
      const playerId = room.activeTurnPlayerId;
      for (const card of room.battlefield) {
        if (card.state.controllerId === playerId) {
          mutations.push({ type: 'UNTAP_CARD', cardUuid: card.uuid });
          mutations.push({ type: 'SET_SUMMONING_SICKNESS', cardUuid: card.uuid, value: false });
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

    mutations.push({ type: 'SET_PHASE', phase: to });

    // Phase begin → the active player receives priority. Without this, a phase
    // advance (resolveCurrentPhase, RPS win, endTurn → stateTurnStart) leaves
    // priorityPlayerId null, and canActivate() then rejects every subsequent
    // action with "You do not have priority to act right now" — locking the game.
    if (PRIORITY_GRANTING_PHASES.has(to) && room.activeTurnPlayerId) {
      mutations.push({ type: 'SET_PRIORITY', playerId: room.activeTurnPlayerId });
      mutations.push({ type: 'SET_LAST_PASSED', playerId: null });
    }

    this.eventBus.emit({
      eventId: 'PHASE_CHANGED',
      roomId: this.roomId,
      payload: { phase: to, currentPlayer: room.activeTurnPlayerId },
    });

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
    this.waitingForResponse = true;
    this.eventBus.emit({
      eventId: 'PRIORITY_GIVEN',
      roomId: this.roomId,
      payload: { playerId },
    });
    return [{ type: 'SET_PRIORITY', playerId }];
  }

  passPriority(room: GameRoom, playerId: PlayerId): { success: boolean; mutations: GameMutation[] } {
    if (room.priorityPlayerId !== playerId) {
      return { success: false, mutations: [] };
    }

    const opponent = playerId === room.player1Id ? room.player2Id! : room.player1Id;

    if (room.lastPassedPlayerId === opponent) {
      return { success: true, mutations: this.resolveCurrentPhase(room) };
    } else {
      return {
        success: true,
        mutations: [
          { type: 'SET_LAST_PASSED', playerId },
          ...this.givePriorityTo(opponent),
        ],
      };
    }
  }

  resolveCurrentPhase(room: GameRoom): GameMutation[] {
    if (room.currentPhase === 'Stack' && room.stack.length > 0) {
      this.waitingForResponse = false;
      return [
        { type: 'SET_PRIORITY', playerId: null },
        { type: 'SET_LAST_PASSED', playerId: null },
      ];
    }

    this.waitingForResponse = false;
    const mutations: GameMutation[] = [
      { type: 'SET_PRIORITY', playerId: null },
      { type: 'SET_LAST_PASSED', playerId: null },
    ];

    const prevPhase = room.previousPhase;
    if (prevPhase) {
      mutations.push(...this.transition(room, prevPhase));
      mutations.push({ type: 'SET_PREVIOUS_PHASE', phase: null });
      return mutations;
    }

    // previousPhase is null — no spell was cast, so both players simply passed
    // through the current phase. Advance to the natural next step in the turn
    // cycle instead of stalling (the old fallback to stateMainPhase was invalid
    // from most phases and left the game stuck with no priority player).
    const next = NEXT_PHASE[room.currentPhase];
    if (next) {
      const transitionMutations = this.transition(room, next);
      if (transitionMutations.length > 0) {
        mutations.push(...transitionMutations);
      }
    }

    return mutations;
  }

  /**
   * Handle stack addition: phase transition, event emission, and priority.
   * Returns mutations for the phase change + priority assignment.
   * The handler's propose() already pushed to room.stack via PUSH_STACK mutation.
   */
  addToStack(room: GameRoom, stackObj: StackObject): GameMutation[] {
    const mutations: GameMutation[] = [];

    if (room.currentPhase !== 'Stack') {
      mutations.push(...this.transition(room, 'Stack'));
    }

    this.eventBus.emit({
      eventId: 'STACK_UPDATED',
      roomId: this.roomId,
      payload: { stack: room.stack, newAction: stackObj },
    });

    const opponent = stackObj.controllerId === room.player1Id
      ? room.player2Id!
      : room.player1Id;
    mutations.push(...this.givePriorityTo(opponent));

    return mutations;
  }
}