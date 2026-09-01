// src/engine/game-engine.ts
import { v4 as uuidv4 } from 'uuid';
import { EventBus } from './event-bus';
import { StateMachine } from './state-machine';
import { ActionService } from './action-service';
import { ActionRegistry, type ActionData, type ActionResult } from './action-registry';
import { gameReducer } from './game-reducer';
import { detectGameWinner } from './state-machine';
import type { GameMutation } from '../types/game-mutation.types';
import type { GameRoom, PlayerId } from '../types/game.room.types';
import type { GameStateName } from '../types/game.state.types';

/**
 * GameEngine — single public API for all engine operations.
 *
 * Owns and coordinates EventBus, StateMachine, and ActionService internally.
 * server.ts talks only to GameEngine — no more juggling 3 separate engine objects.
 *
 * Mutation pipeline:
 * 1. Handlers produce GameMutation[] (pure, no side effects)
 * 2. applyMutations() sequences each through gameReducer
 * 3. Mutation collector drains trigger-produced mutations after event dispatch
 */
export class GameEngine {
  private eventBus: EventBus;
  private stateMachine: StateMachine;
  private actionService: ActionService;
  private room: GameRoom;

  /** Per-room mutation collector for TriggerManager to push into during event dispatch. */
  mutationCollector: GameMutation[] = [];

  constructor(room: GameRoom) {
    this.room = room;
    this.eventBus = new EventBus(room.roomId);
    this.stateMachine = new StateMachine(room, this.eventBus);
    this.actionService = new ActionService(this.eventBus, this.mutationCollector, () => this.generateUuid());
  }

  /** Wire TriggerManager for ETB/triggered abilities. Call once after room creation. */
  initRoom(): void {
    this.actionService.initRoom(this.room);
  }

  /**
   * Generate a UUID for StackObject creation.
   * All non-determinism is injected at the engine boundary.
   */
  generateUuid(): string {
    return uuidv4();
  }

  /**
   * Apply an array of mutations through the pure reducer, then drain the
   * mutation collector (trigger-produced mutations) in a loop until empty.
   * Returns all mutations applied (for delta emission).
   */
  applyMutations(mutations: GameMutation[]): GameMutation[] {
    const allApplied: GameMutation[] = [];

    const apply = (muts: GameMutation[]): void => {
      for (const m of muts) {
        this.room = gameReducer(this.room, m);
        allApplied.push(m);
      }
    };

    apply(mutations);

    // Drain trigger-produced mutations (may produce more triggers)
    while (this.mutationCollector.length > 0) {
      const triggered = this.mutationCollector.splice(0);
      apply(triggered);
    }

    // Win-condition rule: after every mutation batch, if a player's life fell
    // to 0 or below, end the game. Applying the GAME_OVER mutation here keeps
    // the rule centralized (combat damage, life costs, triggered damage all
    // flow through applyMutations) and includes it in the emitted delta.
    if (this.room.currentPhase !== 'gameOver') {
      const winnerId = detectGameWinner(this.room);
      if (winnerId) {
        apply([{ type: 'GAME_OVER', winnerId }]);
      }
    }

    return allApplied;
  }

  // -- Action pipeline --

  handleAction(playerId: PlayerId, actionType: string, actionData: ActionData): ActionResult {
    // Inject stackUuid if not provided — UUID generation is the engine's responsibility
    const dataWithUuid: ActionData = actionData.stackUuid != null ? actionData : { ...actionData, stackUuid: this.generateUuid() };
    return this.actionService.handleAction(this.room, playerId, actionType, dataWithUuid);
  }

  proposeAndStack(playerId: PlayerId, actionType: string, actionData: ActionData): ActionResult {
    // Inject stackUuid if not provided — UUID generation is the engine's responsibility
    const dataWithUuid: ActionData = actionData.stackUuid != null ? actionData : { ...actionData, stackUuid: this.generateUuid() };
    const result = this.actionService.proposeAndStack(this.room, playerId, actionType, dataWithUuid);
    if (!result.success) return result;

    const allApplied: GameMutation[] = [];

    // Apply handler-produced mutations
    if (result.mutations) {
      allApplied.push(...this.applyMutations(result.mutations));
    }

    // Sync stack to StateMachine (phase transition + event + priority)
    if (result.stackObject) {
      const smMutations = this.stateMachine.addToStack(this.room, result.stackObject);
      if (smMutations.length > 0) {
        allApplied.push(...this.applyMutations(smMutations));
      }
    }

    return { ...result, mutations: allApplied };
  }

  resolveTopOfStack(): ActionResult {
    const result = this.actionService.resolveTopOfStack(this.room);
    if (!result.success) return result;

    // Apply resolution mutations (zone change + effects + triggers)
    const allApplied: GameMutation[] = [];
    if (result.mutations) {
      allApplied.push(...this.applyMutations(result.mutations));
    }

    return { ...result, mutations: allApplied };
  }

  // -- Phase / Turn delegation --

  transition(to: GameStateName): GameMutation[] {
    const mutations = this.stateMachine.transition(this.room, to);
    if (mutations.length > 0) {
      return this.applyMutations(mutations);
    }
    return mutations;
  }

  switchTurn(): GameMutation[] {
    const mutations = this.stateMachine.switchTurn(this.room);
    if (mutations.length > 0) {
      return this.applyMutations(mutations);
    }
    return mutations;
  }

  /**
   * End the current turn and begin the opponent's turn.
   *
   * Order matters: run the end-of-turn phase transitions for the current
   * (outgoing) player, SWITCH to the next player, and only THEN enter
   * stateTurnStart so the untap/refill step targets the incoming player —
   * not the player whose turn just ended.
   */
  endTurn(): { success: boolean; mutations: GameMutation[]; reason?: string } {
    // Only valid when a game is underway (past RPS) and it's the caller's turn.
    if (this.room.currentPhase === 'RPS') {
      return { success: false, mutations: [], reason: 'Cannot end turn during Rock Paper Scissors phase!' };
    }

    const allMutations: GameMutation[] = [];
    allMutations.push(...this.transition('stateEndPhase'));
    allMutations.push(...this.transition('cleanupStep'));
    allMutations.push(...this.switchTurn());
    allMutations.push(...this.transition('stateTurnStart'));
    return { success: true, mutations: allMutations };
  }

  isPlayerTurn(playerId: PlayerId): boolean {
    return this.stateMachine.isPlayerTurn(this.room, playerId);
  }

  /**
   * RPS mini-game resolution.
   *
   * Fixes the RPS dead-end: the server prompted players to choose
   * Rock/Paper/Scissors and dealt RPS cards, but no method accepted a choice,
   * so a match could never leave the RPS phase. This records a player's choice
   * and, once both have played, resolves the matchup:
   *  - Tie       → clear both choices, stay in RPS (re-prompt) with status 'tie'.
   *  - Non-tie   → status 'resolved', winner takes the active turn, transition
   *                to stateTurnStart (game begins).
   */
  submitRpsChoice(playerId: PlayerId, choice: string): {
    success: boolean;
    mutations: GameMutation[];
    reason?: string;
    result?: { winner?: PlayerId; tie?: boolean; choice: string };
  } {
    if (this.room.currentPhase !== 'RPS') {
      return { success: false, mutations: [], reason: 'Not in the Rock Paper Scissors phase' };
    }
    if (choice !== 'rock' && choice !== 'paper' && choice !== 'scissors') {
      return { success: false, mutations: [], reason: 'Invalid RPS choice' };
    }
    if (playerId !== this.room.player1Id && playerId !== this.room.player2Id) {
      return { success: false, mutations: [], reason: 'Unknown player' };
    }
    if (this.room.rpsState.playedCards[playerId] != null) {
      return { success: false, mutations: [], reason: 'You already made a choice!' };
    }

    // RPS needs both players present; both are guaranteed once the phase is set.
    const p1Id: PlayerId = this.room.player1Id;
    const p2Id: PlayerId = this.room.player2Id ?? '';
    if (!p2Id) {
      return { success: false, mutations: [], reason: 'Wait for opponent to join' };
    }

    const allMutations: GameMutation[] = [
      { type: 'SET_RPS_PLAYED_CARD', playerId, card: choice },
    ];

    const played = { ...this.room.rpsState.playedCards, [playerId]: choice };

    // Resolve only once both players have chosen.
    const hasP1 = played[p1Id] != null;
    const hasP2 = played[p2Id] != null;
    if (!hasP1 || !hasP2) {
      this.applyMutations(allMutations);
      return { success: true, mutations: allMutations, result: { choice } };
    }

    const p1Choice = played[p1Id];
    const p2Choice = played[p2Id];

    // Non-transitive win map: key beats value.
    const beats: Record<string, string> = {
      rock: 'scissors',
      scissors: 'paper',
      paper: 'rock',
    };

    if (p1Choice === p2Choice) {
      const tieMutations: GameMutation[] = [
        ...allMutations,
        { type: 'SET_RPS_STATUS', status: 'tie' },
        { type: 'RESET_RPS' },
      ];
      this.applyMutations(tieMutations);
      return {
        success: true,
        mutations: tieMutations,
        result: { tie: true, choice },
      };
    }

    const winner: PlayerId = beats[p1Choice] === p2Choice ? p1Id : p2Id;

    // Winner starts the game; entering stateTurnStart untaps/refills them.
    // Build the full ordered mutation list (play → status → turn → phase) and
    // apply once so the returned list matches exactly what was applied, which
    // the server uses to compute per-player deltas.
    //
    // A normal turn advance reaches stateTurnStart through StateMachine.transition(),
    // which additionally draws a card for the active player and grants them
    // priority. The RPS path short-circuits straight to SET_PHASE, so we must
    // reproduce those two invariants here or the winner's first turn is missing
    // its opening draw and starts with priorityPlayerId null — the exact state
    // transition() warns locks the game (canActivate rejects every action).
    const resolveMutations: GameMutation[] = [
      ...allMutations,
      { type: 'SET_RPS_STATUS', status: 'resolved' },
      { type: 'SET_TURN', playerId: winner },
      { type: 'DRAW_CARD', playerId: winner, amount: 1 },
      { type: 'SET_PHASE', phase: 'stateTurnStart' },
      { type: 'SET_PRIORITY', playerId: winner },
      { type: 'SET_LAST_PASSED', playerId: null },
    ];
    this.applyMutations(resolveMutations);

    return {
      success: true,
      mutations: resolveMutations,
      result: { winner, choice },
    };
  }

  // -- Priority delegation --

  givePriorityTo(playerId: PlayerId): GameMutation[] {
    const mutations = this.stateMachine.givePriorityTo(playerId);
    if (mutations.length > 0) {
      return this.applyMutations(mutations);
    }
    return mutations;
  }

  passPriority(playerId: PlayerId): { success: boolean; mutations: GameMutation[] } {
    const result = this.stateMachine.passPriority(this.room, playerId);
    if (result.mutations.length > 0) {
      return { success: result.success, mutations: this.applyMutations(result.mutations) };
    }
    return result;
  }

  // -- Accessors --

  get roomState(): GameRoom {
    return this.room;
  }

  get phase(): GameStateName {
    return this.room.currentPhase;
  }

  get activeTurnPlayerId(): PlayerId {
    return this.room.activeTurnPlayerId;
  }

  get priorityPlayerId(): PlayerId | null {
    return this.room.priorityPlayerId;
  }
}