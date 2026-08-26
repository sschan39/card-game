import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SyncService, type StateDelta } from '../../src/server/sync-service';
import { createTestRoom } from '../helpers/test-room-factory';
import { instantiateCard } from '../../src/library/card-factory';
import type { GameRoom } from '../../src/types/game.room.types';
import type { GameMutation } from '../../src/types/game-mutation.types';
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

  describe('buildDelta + broadcast', () => {
    it('should emit stateDelta to both players', () => {
      const oldState = JSON.parse(JSON.stringify(room)) as GameRoom;
      const mutations: GameMutation[] = [
        { type: 'SET_MANA', playerId: 'player1', color: 'red', amount: 4 },
      ];

      const delta = service.buildDelta(oldState, mutations, { action: 'CARD_PLAYED', playerId: 'player1' });
      service.broadcast(delta, room);

      expect(emittedDeltas.length).toBe(2); // one per player
      const p1Delta = emittedDeltas[0];
      expect(p1Delta.roomId).toBe(room.roomId);
      expect(p1Delta.action).toBe('CARD_PLAYED');
      expect(p1Delta.playerId).toBe('player1');
      expect(p1Delta.changes.length).toBeGreaterThan(0);
    });

    it('should detect updated values', () => {
      const oldState = JSON.parse(JSON.stringify(room)) as GameRoom;
      const mutations: GameMutation[] = [
        { type: 'SET_MANA', playerId: 'player1', color: 'red', amount: 3 },
      ];

      const delta = service.buildDelta(oldState, mutations, { action: 'PAID_MANA', playerId: 'player1' });

      const updateChange = delta.changes.find(c => c.op === 'update');
      expect(updateChange).toBeDefined();
      expect(updateChange!.path).toBe('players.player1.mana.red');
      expect(updateChange!.oldValue).toBe(5);
      expect(updateChange!.value).toBe(3);
    });

    it('should produce no changes when mutations are empty', () => {
      const oldState = JSON.parse(JSON.stringify(room)) as GameRoom;
      const mutations: GameMutation[] = [];

      const delta = service.buildDelta(oldState, mutations, { action: 'NOOP', playerId: 'player1' });

      expect(delta.changes.length).toBe(0);
    });

    it('should increment sequence numbers', () => {
      const oldState1 = JSON.parse(JSON.stringify(room)) as GameRoom;
      const mutations1: GameMutation[] = [
        { type: 'SET_MANA', playerId: 'player1', color: 'red', amount: 4 },
      ];
      const delta1 = service.buildDelta(oldState1, mutations1, { action: 'ACTION_1', playerId: 'player1' });

      const oldState2 = JSON.parse(JSON.stringify(room)) as GameRoom;
      const mutations2: GameMutation[] = [
        { type: 'SET_MANA', playerId: 'player1', color: 'blue', amount: 4 },
      ];
      const delta2 = service.buildDelta(oldState2, mutations2, { action: 'ACTION_2', playerId: 'player1' });

      expect(delta1.seq).toBe(1);
      expect(delta2.seq).toBe(2);
    });

    it('should write delta to log file', () => {
      const oldState = JSON.parse(JSON.stringify(room)) as GameRoom;
      const mutations: GameMutation[] = [
        { type: 'SET_MANA', playerId: 'player1', color: 'red', amount: 4 },
      ];

      const delta = service.buildDelta(oldState, mutations, { action: 'CARD_PLAYED', playerId: 'player1' });
      service.broadcast(delta, room);

      const logPath = path.join(tmpDir, 'deltas.jsonl');
      expect(fs.existsSync(logPath)).toBe(true);
      const content = fs.readFileSync(logPath, 'utf-8');
      expect(content).toContain('CARD_PLAYED');
    });
  });

  describe('filterForPlayer', () => {
    it('should redact opponent hand changes and replace with handCount', () => {
      // Give player2 a card in hand so a MOVE_CARD into hand produces a real change
      const p2Card = instantiateCard('empire-servant');
      p2Card.state.zone = 'hand';
      p2Card.state.ownerId = 'player2';
      p2Card.state.controllerId = 'player2';
      room.players['player2'].hand.push(p2Card);

      const oldState = JSON.parse(JSON.stringify(room)) as GameRoom;
      // Move a card from player2's library to player2's hand
      const mutations: GameMutation[] = [
        { type: 'MOVE_CARD', cardUuid: p2Card.uuid, playerId: 'player2', from: 'hand', to: 'graveyard' },
      ];

      const delta = service.buildDelta(oldState, mutations, { action: 'DISCARD', playerId: 'player2' });
      const filtered = service.filterForPlayer(delta, 'player1', room);

      // Should NOT contain the raw hand remove for player2 (bracket notation)
      const handChanges = filtered.changes.filter(c => c.path.startsWith('players.player2.hand['));
      expect(handChanges.length).toBe(0);

      // Should contain a handCount update for player2
      const handCountChange = filtered.changes.find(c => c.path === 'players.player2.handCount');
      expect(handCountChange).toBeDefined();
      expect(handCountChange!.op).toBe('update');
    });

    it('should drop opponent deck changes entirely', () => {
      // Give player2 a card in deck so a MOVE_CARD from library produces a real change
      const p2Card = instantiateCard('empire-servant');
      p2Card.state.zone = 'library';
      p2Card.state.ownerId = 'player2';
      p2Card.state.controllerId = 'player2';
      room.players['player2'].deck.push(p2Card);

      const oldState = JSON.parse(JSON.stringify(room)) as GameRoom;
      const mutations: GameMutation[] = [
        { type: 'MOVE_CARD', cardUuid: p2Card.uuid, playerId: 'player2', from: 'library', to: 'hand' },
      ];

      const delta = service.buildDelta(oldState, mutations, { action: 'DRAW', playerId: 'player2' });
      const filtered = service.filterForPlayer(delta, 'player1', room);

      // Should NOT contain any deck changes for player2
      const deckChanges = filtered.changes.filter(c => c.path.startsWith('players.player2.deck'));
      expect(deckChanges.length).toBe(0);
    });

    it('should pass through own hand changes unchanged', () => {
      // player1 already has a card in hand (from createTestRoom)
      const p1Card = room.players['player1'].hand[0];

      const oldState = JSON.parse(JSON.stringify(room)) as GameRoom;
      const mutations: GameMutation[] = [
        { type: 'MOVE_CARD', cardUuid: p1Card.uuid, playerId: 'player1', from: 'hand', to: 'graveyard' },
      ];

      const delta = service.buildDelta(oldState, mutations, { action: 'DISCARD', playerId: 'player1' });
      const filtered = service.filterForPlayer(delta, 'player1', room);

      // Should contain the raw hand remove for player1
      const handChanges = filtered.changes.filter(c => c.path.startsWith('players.player1.hand['));
      expect(handChanges.length).toBeGreaterThan(0);
    });
  });

  describe('replay', () => {
    it('should read deltas from log file', () => {
      const oldState1 = JSON.parse(JSON.stringify(room)) as GameRoom;
      const mutations1: GameMutation[] = [
        { type: 'SET_MANA', playerId: 'player1', color: 'red', amount: 4 },
      ];
      const delta1 = service.buildDelta(oldState1, mutations1, { action: 'ACTION_1', playerId: 'player1' });
      service.broadcast(delta1, room);

      const oldState2 = JSON.parse(JSON.stringify(room)) as GameRoom;
      const mutations2: GameMutation[] = [
        { type: 'SET_MANA', playerId: 'player1', color: 'blue', amount: 4 },
      ];
      const delta2 = service.buildDelta(oldState2, mutations2, { action: 'ACTION_2', playerId: 'player1' });
      service.broadcast(delta2, room);

      const deltas = service.replay(room.roomId);
      expect(deltas.length).toBe(2);
      expect(deltas[0].action).toBe('ACTION_1');
      expect(deltas[1].action).toBe('ACTION_2');
    });
  });
});