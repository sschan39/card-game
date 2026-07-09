// src/server/sync-service.ts
import type { Server } from 'socket.io';
import type { GameRoom, PlayerId } from '../types/game.room.types';
import * as fs from 'fs';
import * as path from 'path';

export interface DeltaChange {
  path: string;
  op: 'add' | 'remove' | 'replace' | 'update';
  value?: unknown;
  oldValue?: unknown;
}

export interface StateDelta {
  roomId: string;
  seq: number;
  timestamp: number;
  action?: string;
  playerId?: PlayerId;
  changes: DeltaChange[];
}

export class SyncService {
  private io: Server;
  private deltaLogPath: string | null;
  private sequences: Map<string, number> = new Map();

  constructor(io: Server, deltaLogPath?: string) {
    this.io = io;
    this.deltaLogPath = deltaLogPath || null;
  }

  sync(oldState: GameRoom, newState: GameRoom, context: { action: string; playerId: PlayerId }): void {
    const changes = this.computeDiff(oldState, newState, '');
    const seq = this.nextSeq(newState.roomId);

    const delta: StateDelta = {
      roomId: newState.roomId,
      seq,
      timestamp: Date.now(),
      action: context.action,
      playerId: context.playerId,
      changes,
    };

    // Emit to both players in the room
    this.io.to(newState.roomId).emit('stateDelta', delta);

    // Write to delta log
    if (this.deltaLogPath) {
      this.appendToLog(delta);
    }
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

  private nextSeq(roomId: string): number {
    const current = this.sequences.get(roomId) || 0;
    const next = current + 1;
    this.sequences.set(roomId, next);
    return next;
  }

  private computeDiff(oldState: unknown, newState: unknown, basePath: string): DeltaChange[] {
    const changes: DeltaChange[] = [];

    if (oldState === newState) return changes;

    if (Array.isArray(oldState) && Array.isArray(newState)) {
      if (oldState.length !== newState.length) {
        if (newState.length > oldState.length) {
          for (let i = oldState.length; i < newState.length; i++) {
            changes.push({
              path: basePath,
              op: 'add',
              value: newState[i],
            });
          }
        } else {
          for (let i = newState.length; i < oldState.length; i++) {
            changes.push({
              path: basePath,
              op: 'remove',
              value: oldState[i],
            });
          }
        }
      }
      const minLen = Math.min(oldState.length, newState.length);
      for (let i = 0; i < minLen; i++) {
        changes.push(...this.computeDiff(oldState[i], newState[i], `${basePath}[${i}]`));
      }
    } else if (typeof oldState === 'object' && typeof newState === 'object' && oldState !== null && newState !== null) {
      const oldObj = oldState as Record<string, unknown>;
      const newObj = newState as Record<string, unknown>;
      const allKeys = new Set([...Object.keys(oldObj), ...Object.keys(newObj)]);

      for (const key of allKeys) {
        const childPath = basePath ? `${basePath}.${key}` : key;
        if (!(key in newObj) || newObj[key] === undefined) {
          if (key in oldObj && oldObj[key] !== undefined) {
            changes.push({ path: childPath, op: 'remove', oldValue: oldObj[key] });
          }
        } else if (!(key in oldObj) || oldObj[key] === undefined) {
          if (newObj[key] !== undefined) {
            changes.push({ path: childPath, op: 'add', value: newObj[key] });
          }
        } else if (typeof oldObj[key] !== 'object' || oldObj[key] === null) {
          if (oldObj[key] !== newObj[key]) {
            changes.push({ path: childPath, op: 'update', value: newObj[key], oldValue: oldObj[key] });
          }
        } else {
          changes.push(...this.computeDiff(oldObj[key], newObj[key], childPath));
        }
      }
    }

    return changes;
  }

  private appendToLog(delta: StateDelta): void {
    if (!this.deltaLogPath) return;
    const dir = path.dirname(this.deltaLogPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.appendFileSync(this.deltaLogPath, JSON.stringify(delta) + '\n');
  }
}