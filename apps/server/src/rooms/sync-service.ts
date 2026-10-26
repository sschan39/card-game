// src/server/sync-service.ts
import type { Server } from 'socket.io';
import type { GameRoom, PlayerId } from '@card-game/engine/types/game.room.types';
import type { GameMutation } from '@card-game/engine/types/game-mutation.types';
import type { CardZone } from '@card-game/engine/types/card.types';
import type { DeltaChange, StateDelta } from '@card-game/engine/types/delta.types';
import { gameReducer } from '@card-game/engine/engine/game-reducer';
import type { AppliedEventBatch } from '@card-game/engine/types/game-event.types';
import { serverLogger } from '@card-game/engine/shared/game-logger';
import { gameConfig } from '@card-game/engine/config';
import { describeStackObject } from '@card-game/engine/shared/action-description';
import { battlefieldCardLabel } from '@card-game/engine/shared/card-label';
import * as fs from 'fs';
import * as path from 'path';
import type { ViewDelta } from '@card-game/protocol';
import { projectViewDelta } from '../projection/delta-projector';
import { canSeeStackSource, canSeeRetainedSource } from '../projection/reveal-policy';

export type { DeltaChange, StateDelta };

// ---------------------------------------------------------------------------
// Path helpers
// ---------------------------------------------------------------------------

/** Map a CardZone to its path prefix in GameRoom. */
function zonePath(zone: CardZone, playerId?: PlayerId): string {
  switch (zone) {
    case 'battlefield': return 'battlefield';
    case 'stack': return 'stack';
    case 'library': return `players.${playerId}.deck`;
    case 'hand': return `players.${playerId}.hand`;
    case 'graveyard': return `players.${playerId}.graveyard`;
    case 'exile': return `players.${playerId}.exile`;
  }
}

/** Read the array backing a zone in a room snapshot. */
function getZoneArray(room: GameRoom, zone: CardZone, playerId?: PlayerId): any[] {
  switch (zone) {
    case 'battlefield': return room.battlefield;
    case 'stack': return room.stack;
    case 'library': return room.players[playerId!]?.deck ?? [];
    case 'hand': return room.players[playerId!]?.hand ?? [];
    case 'graveyard': return room.players[playerId!]?.graveyard ?? [];
    case 'exile': return room.players[playerId!]?.exile ?? [];
  }
}

/**
 * Find a card's index in a zone array. For the stack zone, cards live inside
 * StackObject.source, so we match against source.uuid.
 */
function findInZone(arr: any[], zone: CardZone, cardUuid: string): number {
  return arr.findIndex(item => {
    if (zone === 'stack') return item?.type === 'spell' && item?.source?.uuid === cardUuid;
    return item?.uuid === cardUuid;
  });
}

/** Read a value at a dot/bracket path (e.g. "players.player1.mana.red"). */
function getAtPath(obj: unknown, path: string): unknown {
  if (!path) return obj;
  const segments = path.split(/[.[\]]+/).filter(Boolean);
  let current: any = obj;
  for (const seg of segments) {
    if (current == null) return undefined;
    current = current[seg];
  }
  return current;
}

/** Build the path to a card's state field, searching battlefield then player zones. */
function cardStatePath(room: GameRoom, cardUuid: string, field: string): string {
  const bfIdx = room.battlefield.findIndex(c => c.uuid === cardUuid);
  if (bfIdx !== -1) return `battlefield[${bfIdx}].state.${field}`;

  for (const [pid, player] of Object.entries(room.players)) {
    for (const zone of ['hand', 'graveyard', 'deck'] as const) {
      const idx = player[zone].findIndex(c => c.uuid === cardUuid);
      if (idx !== -1) return `players.${pid}.${zone}[${idx}].state.${field}`;
    }
  }
  return '';
}

function updateChange(path: string, oldState: GameRoom, newState: GameRoom): DeltaChange {
  return {
    path,
    op: 'update',
    value: getAtPath(newState, path),
    oldValue: getAtPath(oldState, path),
  };
}

function moveCardChanges(
  mutation: Extract<GameMutation, { type: 'MOVE_CARD' }>,
  oldState: GameRoom,
  newState: GameRoom,
): DeltaChange[] {
  const changes: DeltaChange[] = [];

  // Remove from source zone
  const fromArr = getZoneArray(oldState, mutation.from, mutation.playerId);
  const fromIdx = findInZone(fromArr, mutation.from, mutation.cardUuid);
  if (fromIdx !== -1) {
    changes.push({
      path: `${zonePath(mutation.from, mutation.playerId)}[${fromIdx}]`,
      op: 'remove',
      oldValue: fromArr[fromIdx],
    });
  }

  // The reset card, or its destination spell, is added by the same move.
  {
    if (mutation.to === 'exile' && oldState.players[mutation.playerId].exile === undefined) {
      changes.push({ path: `players.${mutation.playerId}.exile`, op: 'add', value: newState.players[mutation.playerId].exile });
      return changes;
    }
    const toArr = getZoneArray(newState, mutation.to, mutation.playerId);
    const toIdx = findInZone(toArr, mutation.to, mutation.cardUuid);
    if (toIdx !== -1) {
      changes.push({
        path: `${zonePath(mutation.to, mutation.playerId)}[${toIdx}]`,
        op: 'add',
        value: toArr[toIdx],
      });
    }
  }

  return changes;
}

/**
 * Map a single mutation to its ordered DeltaChange[] by replaying it through
 * the pure reducer and reading old/new values at the affected path.
 */
function mutationToChanges(mutation: GameMutation, oldState: GameRoom, newState: GameRoom): DeltaChange[] {
  if (newState === oldState) return [];
  const changes = mutationChanges(mutation, oldState, newState);
  // Participant reconciliation accompanies any battlefield change, including departures.
  if (oldState.combat !== newState.combat && !changes.some(change => change.path === 'combat')) changes.push(updateChange('combat', oldState, newState));
  newState.battlefield.forEach((card, index) => {
    const old = oldState.battlefield.find(c => c.uuid === card.uuid);
    const path = `battlefield[${index}].state.summoningSickness`;
    if (old && old.state.summoningSickness !== card.state.summoningSickness && !changes.some(c => c.path === path)) changes.push({ path, op: 'update', oldValue: old.state.summoningSickness, value: card.state.summoningSickness });
    const worldPath = `battlefield[${index}].state.worldTimestamp`;
    if (old && old.state.worldTimestamp !== card.state.worldTimestamp && !changes.some(c => c.path === worldPath))
      changes.push(card.state.worldTimestamp === undefined ? { path: worldPath, op: 'remove', oldValue: old.state.worldTimestamp } : { path: worldPath, op: 'update', oldValue: old.state.worldTimestamp, value: card.state.worldTimestamp });
  });
  return changes;
}

function mutationChanges(mutation: GameMutation, oldState: GameRoom, newState: GameRoom): DeltaChange[] {
  switch (mutation.type) {
    case 'SHUFFLE_LIBRARY':
    case 'REORDER_LIBRARY': return [updateChange(`players.${mutation.playerId}.deck`, oldState, newState)];
    case 'ADD_REPLACEMENT_EFFECT': return ['replacementEffects', 'replacementSequence'].map(path => updateChange(path, oldState, newState));
    case 'REMOVE_REPLACEMENT_EFFECT': return [updateChange('replacementEffects', oldState, newState)];
    case 'SET_REPLACEMENT_EFFECTS': return [updateChange('replacementEffects', oldState, newState)];
    case 'CEASE_CARD': {
      if (mutation.zone === 'stack') return [updateChange('stack', oldState, newState)];
      const key = mutation.zone === 'library' ? 'deck' : mutation.zone;
      return [updateChange(`players.${mutation.playerId}.${key}`, oldState, newState)];
    }
    case 'ATTACH_CARD':
    case 'UNATTACH_CARD': return [updateChange(cardStatePath(newState, mutation.cardUuid, '').replace(/\.$/, ''), oldState, newState)];
    case 'SET_BATTLE_PROTECTOR': return [updateChange(cardStatePath(newState, mutation.cardUuid, 'protectorId'), oldState, newState)];
    case 'CHANGE_LIFE': return [updateChange(`players.${mutation.playerId}.life`, oldState, newState)];
    case 'ADD_POISON': return [updateChange(`players.${mutation.playerId}.poison`, oldState, newState)];
    case 'SET_FAILED_DRAW': return [updateChange(`players.${mutation.playerId}.failedDraw`, oldState, newState)];
    case 'DRAW_CARDS': return ['deck', 'hand', 'failedDraw'].map(key => updateChange(`players.${mutation.playerId}.${key}`, oldState, newState));
    case 'MARK_DAMAGE': return [updateChange(cardStatePath(newState, mutation.cardUuid, 'damageTaken'), oldState, newState)];
    case 'SET_DEATHTOUCH_DAMAGE': return [updateChange(cardStatePath(newState, mutation.cardUuid, 'deathtouchDamage'), oldState, newState)];
    case 'REGENERATE_CARD': return [updateChange(cardStatePath(newState, mutation.cardUuid, '').replace(/\.$/, ''), oldState, newState)];
    case 'DESTROY_CARD':
    case 'SACRIFICE_CARD': {
      const card = oldState.battlefield.find(c => c.uuid === mutation.cardUuid);
      return card ? moveCardChanges({ type: 'MOVE_CARD', cardUuid: card.uuid, playerId: card.state.ownerId, from: 'battlefield', to: 'graveyard' }, oldState, newState) : [];
    }
    case 'APPLY_DAMAGE_BATCH': {
      // Result replacements can create any supported mutation, including moves.
      // Replay those primitives with their own path mappings in commit order.
      if (mutation.results) {
        let working = oldState;
        return mutation.results.flatMap(result => {
          const after = gameReducer(working, result);
          const changes = mutationToChanges(result, working, after);
          working = after;
          return changes;
        });
      }
      const changes: DeltaChange[] = [];
      if (oldState.replacementEffects !== newState.replacementEffects) changes.push(updateChange('replacementEffects', oldState, newState));
      for (const [id, player] of Object.entries(newState.players)) for (const key of ['life', 'poison', 'failedDraw'] as const) {
        if (oldState.players[id][key] !== player[key]) changes.push(updateChange(`players.${id}.${key}`, oldState, newState));
      }
      newState.battlefield.forEach((card, index) => {
        if (oldState.battlefield[index]?.state !== card.state) changes.push(updateChange(`battlefield[${index}].state`, oldState, newState));
      });
      return changes;
    }
    case 'SET_COMBAT_DAMAGE': return [updateChange('combatDamage', oldState, newState)];
    case 'SET_PLAYER_ZONES':
      return ['deck', 'hand'].map(zone => updateChange(`players.${mutation.playerId}.${zone}`, oldState, newState));
    case 'END_GAME':
      return ['status', 'outcome', 'engineState', 'priorityPlayerId', 'lastPassedPlayerId']
        .map(path => updateChange(path, oldState, newState));
    case 'SET_LIFE':
      return [updateChange(`players.${mutation.playerId}.life`, oldState, newState)];
    case 'SET_MANA':
      return [updateChange(`players.${mutation.playerId}.mana.${mutation.color}`, oldState, newState)];
    case 'ADD_MANA':
      return [updateChange(`players.${mutation.playerId}.mana.${mutation.color}`, oldState, newState)];
    case 'SPEND_MANA':
      return [updateChange(`players.${mutation.playerId}.mana`, oldState, newState)];

    case 'TAP_CARD':
    case 'UNTAP_CARD':
      return [updateChange(cardStatePath(newState, mutation.cardUuid, 'isTapped'), oldState, newState)];
    case 'SET_SUMMONING_SICKNESS':
      return [updateChange(cardStatePath(newState, mutation.cardUuid, 'summoningSickness'), oldState, newState)];
    case 'SET_ATTACKED_THIS_TURN':
      return [updateChange(cardStatePath(newState, mutation.cardUuid, 'attackedThisTurn'), oldState, newState)];
    case 'SET_DAMAGE':
      return [updateChange(cardStatePath(newState, mutation.cardUuid, 'damageTaken'), oldState, newState)];
    case 'CLEAR_DAMAGE': {
      // Reset damageTaken to 0 on every battlefield permanent (CR 514.2).
      // Emit a per-card update only for cards whose damage actually changed.
      const changes: DeltaChange[] = [];
      for (let i = 0; i < newState.battlefield.length; i++) {
        const before = oldState.battlefield[i]?.state.damageTaken ?? 0;
        const after = newState.battlefield[i].state.damageTaken ?? 0;
        if (before !== after) {
          changes.push(updateChange(`battlefield[${i}].state.damageTaken`, oldState, newState));
        }
        if (oldState.battlefield[i]?.state.deathtouchDamage !== newState.battlefield[i].state.deathtouchDamage)
          changes.push(updateChange(`battlefield[${i}].state.deathtouchDamage`, oldState, newState));
      }
      return changes;
    }
    case 'ADD_COUNTER':
    case 'REMOVE_COUNTER':
      return [updateChange(cardStatePath(newState, mutation.cardUuid, `counters.${mutation.counterType}`), oldState, newState)];

    case 'ADD_CONTINUOUS_EFFECT': {
      const idx = newState.continuousEffectPool.length - 1;
      return [{ path: `continuousEffectPool[${idx}]`, op: 'add', value: newState.continuousEffectPool[idx] }];
    }

    case 'REMOVE_CONTINUOUS_EFFECT': {
      // Emit remove changes for each removed index, in REVERSE order.
      // Find which indices were removed by comparing old vs new pool.
      const changes: DeltaChange[] = [];
      const oldPool = oldState.continuousEffectPool;
      const newPool = newState.continuousEffectPool;
      // Collect indices in oldPool whose source matches, in reverse order
      for (let i = oldPool.length - 1; i >= 0; i--) {
        if (mutation.id !== undefined ? oldPool[i].id === mutation.id : oldPool[i].source === mutation.source && !(mutation.dependentOnly && oldPool[i].requiredZone === null)) {
          changes.push({ path: `continuousEffectPool[${i}]`, op: 'remove', oldValue: oldPool[i] });
        }
      }
      return changes;
    }

    case 'CLEAR_END_OF_TURN_EFFECTS': {
      // Emit remove changes for each removed index, in REVERSE order.
      const changes: DeltaChange[] = [];
      if (oldState.replacementEffects !== newState.replacementEffects) changes.push(updateChange('replacementEffects', oldState, newState));
      const oldPool = oldState.continuousEffectPool;
      for (let i = oldPool.length - 1; i >= 0; i--) {
        if (oldPool[i].duration === 'END_OF_TURN') {
          changes.push({ path: `continuousEffectPool[${i}]`, op: 'remove', oldValue: oldPool[i] });
        }
      }
      return changes;
    }

    case 'MOVE_CARD': {
      const changes = moveCardChanges(mutation, oldState, newState);
      newState.stack.forEach((object, index) => {
        const previous = oldState.stack.find(item => item.uuid === object.uuid);
        if (previous && previous.sourceInfo !== object.sourceInfo) changes.push({ path: `stack[${index}].sourceInfo`, op: 'update', value: object.sourceInfo, oldValue: previous.sourceInfo });
      });
      if (oldState.delayedTriggers !== newState.delayedTriggers) changes.push(updateChange('delayedTriggers', oldState, newState));
      return changes;
    }

    case 'REMOVE_STACK':
    case 'COUNTER_STACK': {
      const index = oldState.stack.findIndex(object => object.uuid === mutation.stackUuid);
      if (index === -1 || newState.stack.some(object => object.uuid === mutation.stackUuid)) return [];
      const object = oldState.stack[index];
      if (object.type === 'spell') return moveCardChanges({ type: 'MOVE_CARD', cardUuid: object.source.uuid, playerId: object.source.state.ownerId, from: 'stack', to: 'graveyard' }, oldState, newState);
      return [{ path: `stack[${index}]`, op: 'remove', oldValue: object }];
    }

    case 'PUSH_STACK': {
      const idx = newState.stack.length - 1;
      return [{ path: `stack[${idx}]`, op: 'add', value: newState.stack[idx] }];
    }
    case 'POP_STACK': {
      const idx = oldState.stack.length - 1;
      return [{ path: `stack[${idx}]`, op: 'remove', oldValue: oldState.stack[idx] }];
    }
    case 'SET_COUNTERED': {
      const idx = newState.stack.findIndex(so => so.uuid === mutation.stackUuid);
      if (idx === -1) return [];
      return [updateChange(`stack[${idx}].countered`, oldState, newState)];
    }
    case 'SET_FIZZLED': {
      const idx = newState.stack.findIndex(so => so.uuid === mutation.stackUuid);
      if (idx === -1) return [];
      return [updateChange(`stack[${idx}].fizzled`, oldState, newState)];
    }

    // -- Combat mutations (turn-based action — declared attackers) --
    // The whole `combat` array is replaced wholesale by the reducer, so emit a
    // single update of the array rather than per-declaration diffs.
    case 'DECLARE_ATTACKERS':
    case 'ASSIGN_BLOCKERS':
    case 'COMPLETE_BLOCKER_DECLARATION':
    case 'CLEAR_COMBAT':
      return [updateChange('combat', oldState, newState), updateChange('combatDeclarations', oldState, newState), ...(mutation.type === 'CLEAR_COMBAT' ? [updateChange('combatDamage', oldState, newState)] : [])];

    case 'SET_PHASE':
      return [updateChange('phase', oldState, newState), ...(oldState.delayedTriggers !== newState.delayedTriggers ? [updateChange('delayedTriggers', oldState, newState)] : [])];
    case 'SET_STATUS':
      return [updateChange('status', oldState, newState)];
    case 'SET_ENGINE_STATE':
      return [updateChange('engineState', oldState, newState)];
    case 'SET_PENDING_CHOICE': return [updateChange('pendingChoice', oldState, newState)];
    case 'SET_PENDING_TRIGGERS': return [updateChange('pendingTriggers', oldState, newState)];
    case 'SET_TRIGGER_QUEUE': return [updateChange('triggerQueue', oldState, newState)];
    case 'ADD_DELAYED_TRIGGER':
    case 'REMOVE_DELAYED_TRIGGER': return [updateChange('delayedTriggers', oldState, newState)];
    case 'SET_TURN_HISTORY':
    case 'RECORD_ABILITY_USE':
    case 'RECORD_LAND_PLAY': return [updateChange('turnHistory', oldState, newState)];
    case 'SET_TURN':
      return [updateChange('activeTurnPlayerId', oldState, newState), ...(mutation.advance ? [updateChange('turnNumber', oldState, newState), updateChange('turnHistory', oldState, newState)] : [])];
    case 'SET_PRIORITY':
      return [updateChange('priorityPlayerId', oldState, newState)];
    case 'SET_LAST_PASSED':
      return [updateChange('lastPassedPlayerId', oldState, newState)];

    case 'SET_RPS_STATUS':
      return [updateChange('rpsState.status', oldState, newState)];
    case 'SET_RPS_PLAYED_CARD':
      return [updateChange(`rpsState.playedCards.${mutation.playerId}`, oldState, newState)];

    default:
      // New mutations must explicitly define their wire patch mapping.
      const unsupported: never = mutation;
      throw new Error(`Missing delta mapping: ${JSON.stringify(unsupported)}`);
  }
}

// ---------------------------------------------------------------------------
// SyncService
// ---------------------------------------------------------------------------

export class SyncService {
  private io: Server;
  private deltaLogPath: string | null;
  private sequences: Map<string, number> = new Map();
  private readonly sourceStates = new WeakMap<StateDelta, GameRoom>();

  constructor(io: Server, deltaLogPath?: string) {
    this.io = io;
    this.deltaLogPath = deltaLogPath || null;
  }

  /**
   * Build a StateDelta from ordered mutations replayed through the pure reducer.
   * Each mutation maps to one or more DeltaChanges (MOVE_CARD → remove + add).
   */
  buildDelta(oldState: GameRoom, mutations: GameMutation[], context: { action: string; playerId: PlayerId; batches?: AppliedEventBatch[] }): StateDelta {
    let currentState = oldState;
    const changes: DeltaChange[] = [];

    for (const mutation of mutations) {
      const newState = gameReducer(currentState, mutation);
      if (newState !== currentState) changes.push(...mutationToChanges(mutation, currentState, newState));
      if (newState.effectTimestamp !== currentState.effectTimestamp) changes.push(updateChange('effectTimestamp', currentState, newState));
      if (newState.effectSequence !== currentState.effectSequence) changes.push(updateChange('effectSequence', currentState, newState));
      currentState = newState;
    }

    const delta: StateDelta = {
      roomId: currentState.roomId,
      seq: this.nextSeq(currentState.roomId),
      timestamp: Date.now(),
      action: context.action,
      playerId: context.playerId,
      commandId: context.batches?.find(batch => batch.command)?.command?.commandId,
      batches: context.batches?.map(({ batchId, command, cause, events }) => ({ batchId, command, cause, events })),
      changes,
    };
    this.sourceStates.set(delta, oldState);
    return delta;
  }

  /**
   * Build a synthetic snapshot delta (e.g. initial RPS hands after room setup).
   * The caller supplies the changes; seq/timestamp are assigned here.
   */
  snapshot(room: GameRoom, changes: DeltaChange[]): StateDelta {
    return {
      roomId: room.roomId,
      seq: this.nextSeq(room.roomId),
      timestamp: Date.now(),
      action: 'snapshot',
      changes,
    };
  }

  /** Project both states through the same audience policy used by snapshots. */
  filterForPlayer(delta: StateDelta, playerId: PlayerId, room: GameRoom): ViewDelta {
    const notifications: NonNullable<ViewDelta['notifications']> = [];
    for (const event of delta.batches?.flatMap(batch => batch.events) ?? []) {
      if (event.eventId === 'ACTION_RESOLVED') notifications.push({ eventId: event.eventId, eventUuid: event.eventUuid,
        summary: 'Resolved immediately: ' + (canSeeStackSource(room, playerId, event.payload.stackObj) ? describeStackObject(room, event.payload.stackObj, playerId, event.payload.effects) : 'Hidden source') });
      if (event.eventId === 'CARD_REVEALED') notifications.push({ eventId: event.eventId, eventUuid: event.eventUuid,
        summary: 'Revealed: ' + event.payload.revealedCard.blueprint.name + ' · source: ' + (canSeeRetainedSource(room, playerId, event.payload.sourceInfo.card) ? battlefieldCardLabel(room, event.payload.sourceInfo.card) : 'Hidden source') });
    }
    return projectViewDelta(this.sourceStates.get(delta), room, playerId, { seq: delta.seq, timestamp: delta.timestamp,
      action: delta.action, playerId: delta.playerId, commandId: delta.commandId, notifications });
  }

  /**
   * Emit a delta to a specific player's socket. The player's CURRENT socket.id
   * is resolved via the resolver (a reconnecting player gets a new socket.id,
   * so we must not rely on the stable playerId being a valid socket room).
   */
  private emit(playerId: PlayerId, delta: ViewDelta, resolveSocketId: (playerId: PlayerId) => string): void {
    this.io.to(resolveSocketId(playerId)).emit('stateDelta', delta);
  }

  /**
   * Emit per-player filtered deltas, then log the unfiltered delta to JSONL.
   */
  broadcast(delta: StateDelta, room: GameRoom, resolveSocketId: (playerId: PlayerId) => string): void {
    for (const pid of [room.player1Id, room.player2Id]) {
      if (!pid) continue;
      this.emit(pid, this.filterForPlayer(delta, pid, room), resolveSocketId);
    }
    this.appendToLog(delta);
    if (gameConfig.logging.actions) serverLogger.info('delta:published', 'State sent to players', {
      roomId: delta.roomId, commandId: delta.commandId, action: delta.action, playerId: delta.playerId, seq: delta.seq, changes: delta.changes.length,
    });
    if (gameConfig.logging.appliedEvents) serverLogger.withContext({ roomId: delta.roomId, commandId: delta.commandId,
      deltaSeq: delta.seq, action: delta.action, playerId: delta.playerId })
      .debug('delta:details', undefined, { batchIds: delta.batches?.map(batch => batch.batchId), changes: delta.changes.length });
  }

  replay(roomId: string, fromSeq?: number): StateDelta[] {
    if (!this.deltaLogPath) return [];

    const logFile = path.join(this.deltaLogPath);
    if (!fs.existsSync(logFile)) return [];

    const lines = fs.readFileSync(logFile, 'utf-8').trim().split('\n').filter(Boolean);
    const deltas: StateDelta[] = [];

    for (const line of lines) {
      try {
        const delta: StateDelta = JSON.parse(line);
        if (delta.roomId === roomId) {
          if (fromSeq === undefined || delta.seq >= fromSeq) {
            deltas.push(delta);
          }
        }
      } catch {
        // Skip malformed lines
      }
    }

    return deltas;
  }

  appendToLog(delta: StateDelta): void {
    if (!this.deltaLogPath) return;
    const dir = path.dirname(this.deltaLogPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.appendFileSync(this.deltaLogPath, JSON.stringify(delta) + '\n');
  }

  private nextSeq(roomId: string): number {
    const current = this.sequences.get(roomId) || 0;
    const next = current + 1;
    this.sequences.set(roomId, next);
    return next;
  }

  currentSeq(roomId: string): number { return this.sequences.get(roomId) ?? 0; }
}
