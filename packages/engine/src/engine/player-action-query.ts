import type { GameRoom, PlayerId } from '../types/game.room.types';
import type { PendingChoice } from '../types/choice.types';
import type { ActionData, ActionRegistry } from './action-registry';
import { applyActionChoice, prepareActionChoice, type ActionChoicePreparation } from './action-choices';
import { createDefaultActionRegistry } from './default-action-registry';
import { playerCommands, validateActionData } from './player-commands';
import { engineDiagnostics } from '../shared/diagnostic-settings';
import { declarationPlayer } from '../shared/turn-utils';
import { preparePendingChoiceAnswer } from './choice-continuation';
import { combatAttackerCandidates } from './handlers/declare-attackers-handler';
import { combatBlockerCandidates, combatBlockableAttackers } from './handlers/declare-blockers-handler';
import { ACTION_IDS, type ActionId, type CombatDeclarationInput } from '../types/action.ids';

export type PlayerActionInspection =
  | { kind: 'ready' }
  | { kind: 'input'; choice: PendingChoice }
  | { kind: 'combat'; declaration: CombatDeclarationInput }
  | { kind: 'unavailable'; reason: string };

const defaultRegistry = createDefaultActionRegistry();
const ready = { kind: 'ready' } as const;
const unavailable = (reason: string): PlayerActionInspection => ({ kind: 'unavailable', reason });

/** Check the actor and packet shared by all player commands. */
export function playerCommandError(room: GameRoom, playerId: PlayerId, actionId: string, data: unknown): string | undefined {
  if (room.status === 'gameOver' || room.outcome !== undefined) return 'Game is over';
  if ((playerId !== room.player1Id && playerId !== room.player2Id) ||
      !Object.prototype.hasOwnProperty.call(room.players, playerId) || !room.players[playerId]) return 'Player is not in this room';
  if (typeof actionId !== 'string' || !actionId.trim()) return 'actionId must be a nonempty string';
  return validateActionData(data);
}

/** Look up the built-in command descriptor by its registered name. */
export function commandFor(actionId: string) {
  return Object.prototype.hasOwnProperty.call(playerCommands, actionId) ? playerCommands[actionId] : undefined;
}

/** Find the opposing seat for an active match concession. */
export function concedeOpponent(room: GameRoom, playerId: PlayerId): PlayerId | null {
  if (room.status !== 'playing') return null;
  return playerId === room.player1Id ? room.player2Id : room.player1Id;
}

/** Shared by submission, action-choice continuation and discovery. */
export function preparePlayerAction(
  room: GameRoom, playerId: PlayerId, actionId: string, data: ActionData,
  registry: ActionRegistry, continuing = false,
): ActionChoicePreparation {
  const reject = (error: string): ActionChoicePreparation => ({ kind: 'reject', error });
  const declaration = declarationPlayer(room);
  if (declaration && !room.stack.length && actionId !== 'declare_attackers' && actionId !== 'declare_blockers' && actionId !== 'end_turn')
    return reject('Combat declaration is required');

  const command = commandFor(actionId);
  if (!command && !registry.has(actionId)) return reject('No handler registered for action: ' + actionId);
  const status = command?.status ?? 'playing';
  if (room.status !== status) return reject('Action requires ' + status + ' status');
  if (room.engineState !== 'waiting_for_player') return reject('Engine is not ready for player input');

  const mode = room.debugMode ?? engineDiagnostics.debugMode;
  if (command?.debug && mode !== 'flow' && mode !== command.debug) return reject('Debug command is disabled in this mode');
  const error = command?.validate(data);
  return error ? reject(error) : prepareActionChoice(room, playerId, actionId, data, continuing);
}

/** Read-only inspection of a submission. An offered input can still affect later legality. */
export function inspectPlayerAction(
  room: GameRoom, playerId: PlayerId, actionId: string, input: unknown = {},
  registry = defaultRegistry, rulesPending = Boolean(room.triggerQueue || room.pendingTriggers?.length),
): PlayerActionInspection {
  const error = playerCommandError(room, playerId, actionId, input);
  if (error) return unavailable(error);
  const { stackUuid: _stackUuid, ...data } = input as ActionData;
  if (actionId === 'concede') return concedeOpponent(room, playerId) ? ready : unavailable('No active opponent to concede to');
  if (actionId === 'choose') {
    if (!room.pendingChoice) return unavailable('No choice is pending');
    if (room.pendingChoice.playerId !== playerId) return unavailable('This choice belongs to another player');
    if (data.choiceId === undefined && data.cancel === undefined && data.choices === undefined && data.number === undefined && data.allocations === undefined)
      return { kind: 'input', choice: room.pendingChoice };
    const prepared = preparePendingChoiceAnswer(room, playerId, data);
    if (prepared.kind === 'reject') return unavailable(prepared.reason);
    if (prepared.kind === 'action') {
      const continuation = prepared.continuation;
      return inspectAnnouncedAction({ ...room, pendingChoice: null }, playerId, continuation.actionId,
        applyActionChoice(continuation, prepared.answer), registry, true);
    }
    const next = nextChoiceAfterAnswer(prepared);
    return next?.playerId === playerId ? { kind: 'input', choice: next } : ready;
  }
  if (room.pendingChoice) return unavailable('A choice is pending');
  if (rulesPending) return unavailable('Rules checkpoint is pending');

  if ((actionId === 'declare_attackers' && data.attackers === undefined) ||
      (actionId === 'declare_blockers' && data.assignments === undefined)) {
    return inspectCombatDeclaration(room, playerId, actionId, registry);
  }
  return inspectAnnouncedAction(room, playerId, actionId, data, registry);
}

function inspectAnnouncedAction(
  room: GameRoom, playerId: PlayerId, actionId: string, data: ActionData, registry: ActionRegistry, continuing = false,
): PlayerActionInspection {
  const prepared = preparePlayerAction(room, playerId, actionId, data, registry, continuing);
  if (prepared.kind === 'reject') return unavailable(prepared.error);
  if (prepared.kind === 'prompt') return { kind: 'input', choice: prepared.choice };

  const checkRoom = commandFor(actionId)?.checkRoom;
  if (checkRoom) {
    const reason = checkRoom(room, playerId, data);
    return reason ? unavailable(reason) : ready;
  }
  const result = registry.get(actionId)?.validate(room, playerId, data);
  return result?.success ? ready : unavailable(result?.reason ?? 'No handler registered for action: ' + actionId);
}

function inspectCombatDeclaration(
  room: GameRoom, playerId: PlayerId, actionId: CombatDeclarationInput['actionId'], registry: ActionRegistry,
): PlayerActionInspection {
  const data = actionId === 'declare_attackers' ? { attackers: [] } : { assignments: [] };
  const prepared = preparePlayerAction(room, playerId, actionId, data, registry);
  if (prepared.kind === 'reject') return unavailable(prepared.error);
  const declarationAction = room.phase === 'declareAttackersStep' ? 'declare_attackers' : 'declare_blockers';
  if (actionId !== declarationAction || declarationPlayer(room) !== playerId || room.stack.length)
    return unavailable('No combat declaration for this player');
  return actionId === 'declare_attackers'
    ? { kind: 'combat', declaration: { actionId, attackerUuids: combatAttackerCandidates(room, playerId) } }
    : { kind: 'combat', declaration: { actionId, attackerUuids: combatBlockableAttackers(room), blockerUuids: combatBlockerCandidates(room, playerId) } };
}

const roomCommands = [
  ACTION_IDS.passPriority, ACTION_IDS.enterBattle, ACTION_IDS.concede, ACTION_IDS.endTurn, ACTION_IDS.resolveStack,
] as const;

/** Room controls. Per-card candidates and live choices are read from the same inspection API. */
export function discoverPlayerControls(room: GameRoom, playerId: PlayerId): {
  actions: ActionId[]; combat?: CombatDeclarationInput;
} {
  const actions = roomCommands.filter(actionId => inspectPlayerAction(room, playerId, actionId).kind === 'ready');
  const actionId = room.phase === 'declareAttackersStep' ? 'declare_attackers' : 'declare_blockers';
  const inspection = inspectPlayerAction(room, playerId, actionId);
  return inspection.kind === 'combat' ? { actions, combat: inspection.declaration } : { actions };
}

function nextChoiceAfterAnswer(prepared: ReturnType<typeof preparePendingChoiceAnswer>): PendingChoice | undefined {
  if (prepared.kind === 'payment' && 'pendingChoice' in prepared.payment) return prepared.payment.pendingChoice;
  if (prepared.kind === 'state_based' || prepared.kind === 'replacement') return prepared.plan.pendingChoice;
  if (prepared.kind === 'combat' && prepared.plan.kind === 'prompt') return prepared.plan.choice;
}
