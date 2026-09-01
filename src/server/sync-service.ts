// src/server/sync-service.ts
import type { Server } from 'socket.io';
import type { GameRoom, PlayerId } from '../types/game.room.types';
import type { GameMutation } from '../types/game-mutation.types';
import type { CardZone } from '../types/card.types';
import type { DeltaChange, StateDelta } from '../types/delta.types';
import { gameReducer } from '../engine/game-reducer';
import * as fs from 'fs';
import * as path from 'path';

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
  }
}

/**
 * Find a card's index in a zone array. For the stack zone, cards live inside
 * StackObject.source, so we match against source.uuid.
 */
function findInZone(arr: any[], zone: CardZone, cardUuid: string): number {
  return arr.findIndex(item => {
    if (zone === 'stack') return item?.source?.uuid === cardUuid;
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

  // Add to destination zone. Cards never enter the stack array via MOVE_CARD —
  // that is PUSH_STACK's job — so skip the add for 'stack'.
  if (mutation.to !== 'stack') {
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
  switch (mutation.type) {
    case 'SET_LIFE':
      return [updateChange(`players.${mutation.playerId}.life`, oldState, newState)];
    case 'DRAW_CARD': {
      // The player's own client must see the drawn card move deck→hand so
      // their hand grows. Emit the remove+(add) via the replayed states.
      const changes: DeltaChange[] = [];
      const player = newState.players[mutation.playerId];
      const toDraw = mutation.amount ?? 1;
      const drawnIdxDeck = (oldState.players[mutation.playerId]?.deck.length ?? 0) - 1;
      for (let i = 0; i < toDraw; i++) {
        const deckIdx = drawnIdxDeck - i;
        const drawnCard = (oldState.players[mutation.playerId]?.deck ?? [])[deckIdx];
        if (!drawnCard) break;
        changes.push({
          path: `players.${mutation.playerId}.deck[${deckIdx}]`,
          op: 'remove',
          oldValue: drawnCard,
        });
        const handIdx = (newState.players[mutation.playerId]?.hand ?? []).length - (toDraw - i);
        if (handIdx >= 0) {
          changes.push({
            path: `players.${mutation.playerId}.hand[${handIdx}]`,
            op: 'add',
            value: (newState.players[mutation.playerId]?.hand ?? [])[handIdx],
          });
        }
      }
      return changes.length > 0 ? changes : [updateChange(`players.${mutation.playerId}.hand`, oldState, newState)];
    }
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
    case 'SET_DAMAGE':
      return [updateChange(cardStatePath(newState, mutation.cardUuid, 'damageTaken'), oldState, newState)];
    case 'ADD_COUNTER':
    case 'REMOVE_COUNTER':
      return [updateChange(cardStatePath(newState, mutation.cardUuid, `counters.${mutation.counterType}`), oldState, newState)];

    case 'MOVE_CARD':
      return moveCardChanges(mutation, oldState, newState);
    case 'SET_CARD_ZONE':
      return [updateChange(cardStatePath(newState, mutation.cardUuid, 'zone'), oldState, newState)];

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

    case 'SET_PHASE':
      return [updateChange('currentPhase', oldState, newState)];
    case 'SET_PREVIOUS_PHASE':
      return [updateChange('previousPhase', oldState, newState)];
    case 'SET_TURN':
      return [updateChange('activeTurnPlayerId', oldState, newState)];
    case 'SET_PRIORITY':
      return [updateChange('priorityPlayerId', oldState, newState)];
    case 'SET_LAST_PASSED':
      return [updateChange('lastPassedPlayerId', oldState, newState)];

    case 'GAME_OVER':
      return [
        updateChange('currentPhase', oldState, newState),
        updateChange('winnerId', oldState, newState),
        updateChange('priorityPlayerId', oldState, newState),
      ];

    case 'SET_RPS_STATUS':
      return [updateChange('rpsState.status', oldState, newState)];
    case 'SET_RPS_PLAYED_CARD':
      return [updateChange(`rpsState.playedCards.${mutation.playerId}`, oldState, newState)];
    case 'RESET_RPS':
      return [
        updateChange('rpsState.status', oldState, newState),
        updateChange('rpsState.playedCards', oldState, newState),
      ];

    default:
      return [];
  }
}

// ---------------------------------------------------------------------------
// SyncService
// ---------------------------------------------------------------------------

export class SyncService {
  private io: Server;
  private deltaLogPath: string | null;
  private sequences: Map<string, number> = new Map();

  constructor(io: Server, deltaLogPath?: string) {
    this.io = io;
    this.deltaLogPath = deltaLogPath || null;
  }

  /**
   * Build a StateDelta from ordered mutations replayed through the pure reducer.
   * Each mutation maps to one or more DeltaChanges (MOVE_CARD → remove + add).
   */
  buildDelta(oldState: GameRoom, mutations: GameMutation[], context: { action: string; playerId: PlayerId }): StateDelta {
    let currentState = oldState;
    const changes: DeltaChange[] = [];

    for (const mutation of mutations) {
      const newState = gameReducer(currentState, mutation);
      changes.push(...mutationToChanges(mutation, currentState, newState));
      currentState = newState;
    }

    return {
      roomId: currentState.roomId,
      seq: this.nextSeq(currentState.roomId),
      timestamp: Date.now(),
      action: context.action,
      playerId: context.playerId,
      changes,
    };
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

  /**
   * Redact opponent hidden-zone changes for a specific player.
   * - Opponent deck changes are dropped entirely.
   * - Opponent hand changes are dropped and replaced with a single
   *   hand-count-only change at `players.<opponentId>.handCount`.
   */
  filterForPlayer(delta: StateDelta, playerId: PlayerId, room: GameRoom): StateDelta {
    const opponentId = room.player1Id === playerId ? room.player2Id : room.player1Id;
    if (!opponentId) return delta;

    const handPrefix = `players.${opponentId}.hand`;
    const deckPrefix = `players.${opponentId}.deck`;

    const changes: DeltaChange[] = [];
    let handChanged = false;

    for (const change of delta.changes) {
      if (change.path.startsWith(deckPrefix)) continue;
      if (change.path.startsWith(handPrefix)) {
        handChanged = true;
        continue;
      }
      changes.push(change);
    }

    if (handChanged) {
      changes.push({
        path: `players.${opponentId}.handCount`,
        op: 'update',
        value: room.players[opponentId].hand.length,
      });
    }

    return { ...delta, changes };
  }

  /**
   * Emit a delta to a specific player's socket. Player sockets join the room
   * by roomId, but their socket.id is also a room containing only that socket,
   * so `io.to(playerId)` targets exactly one player.
   */
  emit(playerId: PlayerId, delta: StateDelta): void {
    this.io.to(playerId).emit('stateDelta', delta);
  }

  /**
   * Emit per-player filtered deltas, then log the unfiltered delta to JSONL.
   */
  broadcast(delta: StateDelta, room: GameRoom): void {
    for (const pid of [room.player1Id, room.player2Id]) {
      if (!pid) continue;
      this.emit(pid, this.filterForPlayer(delta, pid, room));
    }
    this.appendToLog(delta);
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
}