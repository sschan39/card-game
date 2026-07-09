import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SyncService, type StateDelta } from '../../src/server/sync-service';
import { createTestRoom } from '../helpers/test-room-factory';
import type { GameRoom } from '../../src/types/game.room.types';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('SyncService', () => {
  let service: SyncService;
  let room: GameRoom;
  let emittedDeltas: StateDelta[];
  let tmpDir: string;

  // Mock io server
  const mockIo = {
    to: (roomId: string) => ({
      emit: (event: string, data: unknown) => {
        if (event === 'stateDelta') {
          emittedDeltas.push(data as StateDelta);
        }
      },
    }),
  } as any;

  beforeEach(() => {
    emittedDeltas = [];
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sync-test-'));
    service = new SyncService(mockIo, path.join(tmpDir, 'deltas.jsonl'));
    room = createTestRoom();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('sync', () => {
    it('should emit stateDelta to both players', () => {
      const oldState = JSON.parse(JSON.stringify(room)) as GameRoom;
      room.players['player1'].mana.red -= 1;
      room.players['player1'].hand.pop();

      service.sync(oldState, room, { action: 'CARD_PLAYED', playerId: 'player1' });

      expect(emittedDeltas.length).toBeGreaterThan(0);
      const delta = emittedDeltas[0];
      expect(delta.roomId).toBe(room.roomId);
      expect(delta.action).toBe('CARD_PLAYED');
      expect(delta.playerId).toBe('player1');
      expect(delta.changes.length).toBeGreaterThan(0);
    });

    it('should detect added items', () => {
      const oldState = JSON.parse(JSON.stringify(room)) as GameRoom;
      const card = room.players['player1'].hand.pop()!;
      card.state.zone = 'battlefield';
      room.battlefield.push(card);

      service.sync(oldState, room, { action: 'CARD_PLAYED', playerId: 'player1' });

      const delta = emittedDeltas[0];
      const addChange = delta.changes.find(c => c.op === 'add');
      expect(addChange).toBeDefined();
    });

    it('should detect removed items', () => {
      const oldState = JSON.parse(JSON.stringify(room)) as GameRoom;
      room.players['player1'].hand.pop();

      service.sync(oldState, room, { action: 'CARD_PLAYED', playerId: 'player1' });

      const delta = emittedDeltas[0];
      const removeChange = delta.changes.find(c => c.op === 'remove');
      expect(removeChange).toBeDefined();
    });

    it('should detect updated values', () => {
      const oldState = JSON.parse(JSON.stringify(room)) as GameRoom;
      room.players['player1'].mana.red -= 2;

      service.sync(oldState, room, { action: 'PAID_MANA', playerId: 'player1' });

      const delta = emittedDeltas[0];
      const updateChange = delta.changes.find(c => c.op === 'update');
      expect(updateChange).toBeDefined();
    });

    it('should produce no changes when state is identical', () => {
      const oldState = JSON.parse(JSON.stringify(room)) as GameRoom;

      service.sync(oldState, room, { action: 'NOOP', playerId: 'player1' });

      const delta = emittedDeltas[0];
      expect(delta.changes.length).toBe(0);
    });

    it('should increment sequence numbers', () => {
      const oldState1 = JSON.parse(JSON.stringify(room)) as GameRoom;
      room.players['player1'].mana.red -= 1;
      service.sync(oldState1, room, { action: 'ACTION_1', playerId: 'player1' });

      const oldState2 = JSON.parse(JSON.stringify(room)) as GameRoom;
      room.players['player1'].mana.blue -= 1;
      service.sync(oldState2, room, { action: 'ACTION_2', playerId: 'player1' });

      expect(emittedDeltas[0].seq).toBe(1);
      expect(emittedDeltas[1].seq).toBe(2);
    });

    it('should write delta to log file', () => {
      const oldState = JSON.parse(JSON.stringify(room)) as GameRoom;
      room.players['player1'].mana.red -= 1;

      service.sync(oldState, room, { action: 'CARD_PLAYED', playerId: 'player1' });

      const logPath = path.join(tmpDir, 'deltas.jsonl');
      expect(fs.existsSync(logPath)).toBe(true);
      const content = fs.readFileSync(logPath, 'utf-8');
      expect(content).toContain('CARD_PLAYED');
    });
  });

  describe('replay', () => {
    it('should read deltas from log file', () => {
      const oldState = JSON.parse(JSON.stringify(room)) as GameRoom;
      room.players['player1'].mana.red -= 1;
      service.sync(oldState, room, { action: 'ACTION_1', playerId: 'player1' });

      const oldState2 = JSON.parse(JSON.stringify(room)) as GameRoom;
      room.players['player1'].mana.blue -= 1;
      service.sync(oldState2, room, { action: 'ACTION_2', playerId: 'player1' });

      const deltas = service.replay(room.roomId);
      expect(deltas.length).toBe(2);
      expect(deltas[0].action).toBe('ACTION_1');
      expect(deltas[1].action).toBe('ACTION_2');
    });
  });
});