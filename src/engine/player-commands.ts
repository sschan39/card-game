import type { GameEngine } from './game-engine';
import type { ActionData, ActionResult } from './action-registry';
import { enterBattleHandler } from './handlers/enter-battle-handler';
import { ACTION_IDS } from '../types/action.ids';
import type { GameRoom, PlayerId } from '../types/game.room.types';
import type { DebugMode } from '../types/debug-mode.types';

interface PlayerCommand {
  status: GameRoom['status'];
  debug?: Exclude<DebugMode, 'off'>;
  validate: (data: ActionData) => string | undefined;
  execute: (engine: GameEngine, playerId: PlayerId, data: ActionData) => ActionResult;
}

const object = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const identifier = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;
const reject = (reason: string): ActionResult => ({ success: false, phase: 'validate', reason });

function validTarget(value: unknown): boolean {
  if (!object(value)) return false;
  // A player selects concrete targets. Expansion is built from card definitions
  // by the resolver, and must not be injected into a selected pointer.
  if (value.all !== undefined && value.all !== false) return false;
  for (const field of ['cardTypes', 'subTypes']) {
    if (value[field] !== undefined && (!Array.isArray(value[field]) || !value[field].every(identifier))) return false;
  }
  switch (value.targetType) {
    case 'self': return true;
    case 'player': return identifier(value.playerId);
    case 'card': case 'permanent': return identifier(value.cardUuid);
    case 'spell': case 'stack': return identifier(value.stackUuid);
    case 'zone': return identifier(value.zone);
    case 'any': return identifier(value.playerId) || identifier(value.cardUuid) || identifier(value.stackUuid);
    default: return false;
  }
}

/** Check shared fields before handlers inspect targets or look up a card. */
export function validateActionData(data: unknown): string | undefined {
  if (!object(data)) return 'Action data must be an object';
  if (data.cardUuid !== undefined && !identifier(data.cardUuid)) return 'cardUuid must be a nonempty string';
  if (data.targets !== undefined && (!Array.isArray(data.targets) || !data.targets.every(validTarget))) {
    return 'targets must be an array of valid target pointers';
  }
  if (data.stackUuid !== undefined && !identifier(data.stackUuid)) return 'stackUuid must be a nonempty string';
}

const noFields = () => undefined;

function declareAndRespond(engine: GameEngine, playerId: PlayerId, actionId: string, data: ActionData): ActionResult {
  const result = engine.proposeAndStack(playerId, actionId, data);
  if (!result.success) return result;
  return { ...result, mutations: [...(result.mutations ?? []), ...engine.givePriorityTo(engine.roomState.activeTurnPlayerId)] };
}

/** Orchestration only. Card behavior continues to live in ActionRegistry. */
export const playerCommands: Record<string, PlayerCommand> = {
  [ACTION_IDS.enterBattle]: {
    status: 'playing', validate: noFields,
    execute: (engine, playerId, data) => {
      const result = enterBattleHandler.validate(engine.roomState, playerId, data);
      if (!result.success) return result;
      if (engine.priorityPlayerId !== playerId) return reject('Not your priority!');
      const passed = engine.passPriority(playerId);
      return passed.success ? { success: true, mutations: passed.mutations } : reject('Not your priority!');
    },
  },
  [ACTION_IDS.declareAttackers]: {
    status: 'playing',
    validate: data => Array.isArray(data.attackers) && data.attackers.every(a => object(a) && identifier(a.cardUuid))
      ? undefined : 'attackers must be an array of card UUID entries',
    execute: (engine, playerId, data) => declareAndRespond(engine, playerId, ACTION_IDS.declareAttackers, data),
  },
  [ACTION_IDS.declareBlockers]: {
    status: 'playing',
    validate: data => data.assignments === undefined || (Array.isArray(data.assignments) && data.assignments.every(a =>
      object(a) && identifier(a.attackerUuid) && Array.isArray(a.blockerUuids) && a.blockerUuids.every(identifier)))
      ? undefined : 'assignments must contain attacker UUIDs and blocker UUID arrays',
    execute: (engine, playerId, data) => declareAndRespond(engine, playerId, ACTION_IDS.declareBlockers, data),
  },
  [ACTION_IDS.passPriority]: {
    status: 'playing', validate: noFields,
    execute: (engine, playerId) => {
      const result = engine.passPriority(playerId);
      return result.success ? { success: true, mutations: result.mutations } : reject('Not your priority!');
    },
  },
  [ACTION_IDS.resolveStack]: {
    status: 'playing', debug: 'stack', validate: noFields,
    execute: engine => engine.resolveTopOfStack(),
  },
  [ACTION_IDS.endTurn]: {
    status: 'playing', debug: 'flow', validate: noFields,
    execute: engine => engine.roomState.stack.length > 0
      ? reject('Cannot end turn while the stack is not empty!')
      : { success: true, mutations: engine.advancePhase('skipToEnd') },
  },
  [ACTION_IDS.rpsPlay]: {
    status: 'RPS', validate: noFields,
    execute: (engine, playerId, data) => {
      const result = engine.handleAction(playerId, ACTION_IDS.rpsPlay, data);
      return result.success ? { ...result, mutations: engine.applyMutations(result.mutations ?? []) } : result;
    },
  },
};

