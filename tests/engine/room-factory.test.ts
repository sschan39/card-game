import { describe, it, expect } from 'vitest';
import { createRoom, joinRoom, setupRPS, buildTestDeck, dealStartingHands } from '../../src/engine/room-factory';
import { instantiateCard } from '../../src/library/card-factory';

describe('buildTestDeck', () => {
  it('builds a 9-card shuffled deck with zone=library and correct ownership', () => {
    const deck = buildTestDeck('p1');

    expect(deck.length).toBe(9);
    for (const card of deck) {
      expect(card.state.zone).toBe('library');
      expect(card.state.ownerId).toBe('p1');
      expect(card.state.controllerId).toBe('p1');
      expect(card.uuid).toBeTruthy();
      expect(['empire-servant', 'land-red', 'fire-bolt']).toContain(card.blueprint.id);
    }
  });

  it('produces a shuffled (non-deterministic) order across builds', () => {
    // Extremely unlikely that two independent shuffles of 9 cards are identical.
    const a = buildTestDeck('p1').map(c => c.blueprint.id).join(',');
    const b = buildTestDeck('p1').map(c => c.blueprint.id).join(',');
    expect(a).not.toBe(b);
  });
});

describe('dealStartingHands', () => {
  it('deals 4 cards to each player and leaves 5 in each deck', () => {
    const room = createRoom('room-1', 'p1');
    joinRoom(room, 'p2');
    room.players['p1'].deck = buildTestDeck('p1');
    room.players['p2'].deck = buildTestDeck('p2');

    dealStartingHands(room);

    expect(room.players['p1'].hand.length).toBe(4);
    expect(room.players['p2'].hand.length).toBe(4);
    expect(room.players['p1'].deck.length).toBe(5);
    expect(room.players['p2'].deck.length).toBe(5);

    // Every dealt card must have a valid uuid and zone=hand (regression for
    // the "Cannot read properties of undefined (reading 'uuid')" TypeError).
    for (const card of room.players['p1'].hand) {
      expect(card.uuid).toBeTruthy();
      expect(card.state.zone).toBe('hand');
    }
    for (const card of room.players['p2'].hand) {
      expect(card.uuid).toBeTruthy();
      expect(card.state.zone).toBe('hand');
    }
  });

  it('clears any prior hand contents before dealing', () => {
    const room = createRoom('room-1', 'p1');
    joinRoom(room, 'p2');
    room.players['p1'].deck = buildTestDeck('p1');
    room.players['p2'].deck = buildTestDeck('p2');
    // Simulate leftover RPS cards in hand.
    room.players['p1'].hand = [instantiateCard('rock')];
    room.players['p2'].hand = [instantiateCard('paper')];

    dealStartingHands(room);

    expect(room.players['p1'].hand.length).toBe(4);
    expect(room.players['p2'].hand.length).toBe(4);
  });
});

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