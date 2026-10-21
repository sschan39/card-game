import { describe, it, expect, vi } from 'vitest';
import { createRoom, joinRoom, setupRPS, buildTestDeck, dealStartingHands } from '../../src/engine/room-factory';
import { instantiateCard } from '../../src/library/card-factory';
import { gameConfig } from '../../src/config';

describe('buildTestDeck', () => {
  it('builds a 12-card configured deck with zone=library and correct ownership', () => {
    const deck = buildTestDeck('p1');

    expect(deck.length).toBe(12);
    for (const card of deck) {
      expect(card.state.zone).toBe('library');
      expect(card.state.ownerId).toBe('p1');
      expect(card.state.controllerId).toBe('p1');
      expect(card.uuid).toBeTruthy();
      expect(['empire-servant', 'land-red', 'broken-fireball', 'choice-practice']).toContain(card.blueprint.id);
    }
  });

  it('uses injected UUIDs and randomness while preserving the configured card multiset', () => {
    let nextId = 0;
    const uuid = vi.fn(() => `card-${++nextId}`);
    const random = vi.fn(() => 0);
    const setup = { ...gameConfig.setup, shuffleDevelopmentDeck: true };

    const deck = buildTestDeck('p1', setup, { uuid, random });

    expect(uuid).toHaveBeenCalledTimes(setup.developmentDeck.length);
    expect(random).toHaveBeenCalledTimes(setup.developmentDeck.length - 1);
    expect(deck.map(card => card.uuid).sort()).toEqual(
      Array.from({ length: setup.developmentDeck.length }, (_, index) => `card-${index + 1}`).sort(),
    );
    expect(deck.map(card => card.blueprint.id).sort()).toEqual([...setup.developmentDeck].sort());
  });
});

describe('dealStartingHands', () => {
  it('provides two loaded choice consumers in the first development draws', () => {
    const room = createRoom('choices', 'p1'); joinRoom(room, 'p2');
    room.players.p1.deck = buildTestDeck('p1'); room.players.p2.deck = buildTestDeck('p2'); dealStartingHands(room);
    expect(room.players.p1.deck.slice(-2).map(card => card.blueprint.id)).toEqual(['choice-practice', 'choice-practice']);
  });
  it('deals a repeatable useful development hand using current definitions', () => {
    for (let i = 0; i < 3; i++) {
      const room = createRoom('demo-' + i, 'p1'); joinRoom(room, 'p2');
      room.players.p1.deck = buildTestDeck('p1'); room.players.p2.deck = buildTestDeck('p2'); dealStartingHands(room);
      for (const player of Object.values(room.players)) expect(player.hand.map(card => card.blueprint.id).sort()).toEqual(['broken-fireball', 'empire-servant', 'empire-servant', 'land-red', 'land-red']);
    }
  });
  it('deals 5 cards to each player and leaves 7 in each deck', () => {
    const room = createRoom('room-1', 'p1');
    joinRoom(room, 'p2');
    room.players['p1'].deck = buildTestDeck('p1');
    room.players['p2'].deck = buildTestDeck('p2');

    dealStartingHands(room);

    expect(room.players['p1'].hand.length).toBe(5);
    expect(room.players['p2'].hand.length).toBe(5);
    expect(room.players['p1'].deck.length).toBe(7);
    expect(room.players['p2'].deck.length).toBe(7);

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

    expect(room.players['p1'].hand.length).toBe(5);
    expect(room.players['p2'].hand.length).toBe(5);
  });
});

describe('setupRPS', () => {
  it('uses injected UUIDs for all six RPS cards', () => {
    const room = createRoom('room-1', 'p1');
    joinRoom(room, 'p2');
    let nextId = 0;

    setupRPS(room, { uuid: () => `rps-${++nextId}` });

    expect([...room.players.p1.hand, ...room.players.p2.hand].map(card => card.uuid)).toEqual([
      'rps-1', 'rps-3', 'rps-5', 'rps-2', 'rps-4', 'rps-6',
    ]);
  });

  it('deals RPS cards into both hands with zone=hand and correct ownership', () => {
    const room = createRoom('room-1', 'p1');
    joinRoom(room, 'p2');
    setupRPS(room);

    expect(room.status).toBe('RPS');

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
