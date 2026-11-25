import type { RuntimeContext } from '../shared/runtime-context';
import type { AppliedEventBatch } from '../types/game-event.types';
import type { GameRoom, MatchPosition, PlayerId } from '../types/game.room.types';
import type { MatchRules } from '../types/setup-config.types';
import type { ActionResult } from './action-registry';
import { GameEngine } from './game-engine';
import type { OpeningDecks } from './opening-decks';

export interface MatchCommand {
  readonly playerId: PlayerId;
  readonly actionId: string;
  readonly data?: unknown;
  readonly commandId?: string;
}

export interface MatchExecution {
  readonly runtime: RuntimeContext;
  readonly correlationId: string;
  readonly lastBatchId?: string;
}

export interface MatchTransition<T> {
  readonly position: MatchPosition;
  readonly result: T;
  readonly batches: AppliedEventBatch[];
  readonly lastBatchId?: string;
}

/** An application may reuse its engine runner while keeping the committed position in its own store. */
export function executeBoundMatchCommand(engine: GameEngine, command: MatchCommand): {
  readonly room: GameRoom;
  readonly result: ActionResult;
  readonly batches: AppliedEventBatch[];
} {
  const result = applyCommand(engine, command);
  return { room: engine.roomState, result, batches: engine.drainEventBatches() };
}

function applyCommand(engine: GameEngine, command: MatchCommand): ActionResult {
  return engine.withCommandContext(
    command.actionId, command.playerId,
    () => engine.executePlayerAction(command.playerId, command.actionId, command.data),
    command.commandId,
  );
}

/** Execute from a caller-owned position and release all temporary engine listeners. */
function runMatchTransition<T>(
  position: MatchPosition,
  execution: MatchExecution,
  run: (engine: GameEngine) => T,
): MatchTransition<T> {
  const engine = new GameEngine({ ...position, roomId: execution.correlationId }, execution.runtime, undefined, execution.lastBatchId);
  try {
    engine.initRoom();
    const result = run(engine);
    const { roomId: _correlationId, ...next } = engine.roomState;
    return { position: next, result, batches: engine.drainEventBatches(), lastBatchId: engine.lastBatchId };
  } finally {
    engine.dispose();
  }
}

export function startMatchPosition(
  position: MatchPosition & { setup: MatchRules },
  firstPlayerId: PlayerId,
  opening: OpeningDecks,
  execution: MatchExecution,
): MatchTransition<void> {
  return runMatchTransition(position, execution, engine => engine.startMatch(firstPlayerId, opening));
}

export function executeMatchCommand(
  position: MatchPosition,
  command: MatchCommand,
  execution: MatchExecution,
): MatchTransition<ActionResult> {
  return runMatchTransition(position, execution, engine => applyCommand(engine, command));
}
