import { describe, it, expect } from 'vitest';
import { createRoom, joinRoom, setupRPS } from '../../src/engine/room-factory';

describe('setupRPS', () => {
  it('deals RPS cards into both hands with zone=hand and correct ownership', () => {
    const room = createRoom('room-1', 'p1');
    joinRoom(room, 'p2');
    setupRPS(room);

    expect(room.currentPhase).toBe('RPS');

    const p1 = room.players['p1'];
    const p2 = room.players['p2'];

    expect(p1.hand.length).toBe(3);
    expect(p2.hand.length).toBe(3);

    for (const card of p1.hand) {
      expect(card.state.zone).toBe('hand');
      expect(card.state.ownerId).toBe('p1');
      expect(card.state.controllerId).toBe('p1');
      expect(['rock', 'paper', 'scissors']).toContain(card.blueprint.id);
    }

    for (const card of p2.hand) {
      expect(card.state.zone).toBe('hand');
      expect(card.state.ownerId).toBe('p2');
      expect(card.state.controllerId).toBe('p2');
      expect(['rock', 'paper', 'scissors']).toContain(card.blueprint.id);
    }
  });
});