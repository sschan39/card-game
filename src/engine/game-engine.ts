// src/engine/game-engine.ts
import { v4 as uuidv4 } from 'uuid';
import { EventBus } from './event-bus';
import { StateMachine } from './state-machine';
import { ActionService } from './action-service';
import { ActionRegistry, type ActionData, type ActionResult } from './action-registry';
import { gameReducer } from './game-reducer';
import { checkStateBasedActions } from './state-based-actions';
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
   * Tear down the engine's per-room systems (TriggerManager listeners).
   * Call when the room is destroyed to prevent listener leaks.
   */
  dispose(): void {
    this.actionService.destroyRoom();
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

        // Emit PERMANENT_LEFT when a card leaves the battlefield for graveyard
        if (m.type === 'MOVE_CARD' && m.from === 'battlefield' && m.to === 'graveyard') {
          const movedCard = this.room.players[m.playerId]?.graveyard.find(c => c.uuid === m.cardUuid);
          if (movedCard) {
            this.eventBus.emit({
              eventId: 'PERMANENT_LEFT',
              roomId: this.room.roomId,
              payload: { card: movedCard, controllerId: movedCard.state.controllerId },
            });
            // Also emit PERMANENT_DIED for death triggers (ON_DIE).
            // PERMANENT_LEFT fires for any leave (bounce, exile, destroy).
            // PERMANENT_DIED fires specifically when a creature is destroyed (lethal damage / destroy effect).
            this.eventBus.emit({
              eventId: 'PERMANENT_DIED',
              roomId: this.room.roomId,
              payload: { card: movedCard, controllerId: movedCard.state.controllerId },
            });
          }
        }

        // Emit DAMAGE_TAKEN when a creature takes damage
        if (m.type === 'SET_DAMAGE') {
          const damagedCard = this.room.battlefield.find(c => c.uuid === m.cardUuid);
          if (damagedCard && damagedCard.blueprint.cardTypes.includes('Creature')) {
            this.eventBus.emit({
              eventId: 'DAMAGE_TAKEN',
              roomId: this.room.roomId,
              payload: { card: damagedCard, controllerId: damagedCard.state.controllerId, amount: m.amount },
            });
          }
        }

        // Housekeeping: drop pool entries whose source just changed zones.
        // Correctness does NOT depend on this — hasValidSourceZone() would
        // already make these entries inert. This keeps the pool small.
        if (m.type === 'MOVE_CARD') {
          if (this.room.continuousEffectPool.some(entry => entry.source === m.cardUuid)) {
            this.mutationCollector.push({ type: 'REMOVE_CONTINUOUS_EFFECT', source: m.cardUuid });
          }
        }

        // Emit LIFE_CHANGED when player life changes
        if (m.type === 'SET_LIFE') {
          this.eventBus.emit({
            eventId: 'LIFE_CHANGED',
            roomId: this.room.roomId,
            payload: { playerId: m.playerId, newLife: m.amount },
          });
        }
      }
    };

    apply(mutations);

    // Drain trigger-produced mutations (may produce more triggers)
    while (this.mutationCollector.length > 0) {
      const triggered = this.mutationCollector.splice(0);
      apply(triggered);
    }

    // State-Based Actions — check after every mutation batch, looping until
    // no more SBAs fire (a destroyed creature may trigger more SBAs).
    // MTG CR 704.3: SBAs are checked whenever a player would receive priority.
    let sbaMutations = checkStateBasedActions(this.room);
    while (sbaMutations.length > 0) {
      apply(sbaMutations);
      sbaMutations = checkStateBasedActions(this.room);
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

    // Emit ATTACK_DECLARED for attack triggers. The target is the opponent
    // player (attack-the-face model). When creature-targeting is added, this
    // TargetPointer will point at the chosen creature instead.
    if (result.attackingCard) {
      const opponentId = this.room.player1Id === playerId ? this.room.player2Id! : this.room.player1Id;
      this.eventBus.emit({
        eventId: 'ATTACK_DECLARED',
        roomId: this.room.roomId,
        payload: {
          card: result.attackingCard,
          controllerId: playerId,
          target: { targetType: 'player', playerId: opponentId },
        },
      });
      // Drain any trigger-produced mutations from ATTACK_DECLARED
      while (this.mutationCollector.length > 0) {
        const triggered = this.mutationCollector.splice(0);
        for (const m of triggered) {
          this.room = gameReducer(this.room, m);
          allApplied.push(m);
        }
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

  isPlayerTurn(playerId: PlayerId): boolean {
    return this.stateMachine.isPlayerTurn(this.room, playerId);
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
      const applied = this.applyMutations(result.mutations);

      // MTG 116.4: When all players pass in succession, the top object on the
      // stack resolves automatically. After resolution, the active player gets
      // priority (116.3b). If the stack is now empty, return to the phase that
      // was active before the stack opened (room.previousPhase).
      if (
        this.room.currentPhase === 'Stack' &&
        this.room.stack.length > 0 &&
        this.room.priorityPlayerId === null
      ) {
        const resolveResult = this.resolveTopOfStack();
        if (resolveResult.success) {
          applied.push(...(resolveResult.mutations ?? []));

          if (this.room.stack.length === 0) {
            const prevPhase = this.room.previousPhase;
            if (prevPhase) {
              applied.push(...this.transition(prevPhase));
            } else {
              applied.push(...this.transition('stateMainPhase'));
            }
            // Clear previousPhase so a later resolveCurrentPhase() doesn't
            // attempt a redundant transition back to the same phase.
            applied.push({ type: 'SET_PREVIOUS_PHASE', phase: null });
          }

          // MTG 116.3b: after a spell/ability resolves, the active player gets priority.
          applied.push(...this.givePriorityTo(this.room.activeTurnPlayerId));
        }
      }

      return { success: result.success, mutations: applied };
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