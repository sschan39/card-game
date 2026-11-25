import { describe, it, expect, vi } from 'vitest';
import { createRoom, joinRoom, buildTestDeck, dealStartingHands } from '@server/rooms/room-factory';
import { instantiateCard } from '@library/card-factory';
import { gameConfig } from '@config';

describe('buildTestDeck', () => {
  it('builds a 12-card configured deck with zone=library and correct ownership', () => {
    const deck = buildTestDeck('p1');

    expect(deck.length).toBe(12);
    for (const card of deck) {
      expect(card.state.zone).toBe('library');
      expect(card.state.visibility).toBe('hidden');
      expect(card.state.visibilityZone).toBe('library');
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
    const lobby = createRoom('choices', 'p1'); joinRoom(lobby, 'p2'); const { room } = lobby;
    room.players.p1.deck = buildTestDeck('p1'); room.players.p2.deck = buildTestDeck('p2'); dealStartingHands(room);
    expect(room.players.p1.deck.slice(-2).map(card => card.blueprint.id)).toEqual(['choice-practice', 'choice-practice']);
  });
  it('deals a repeatable useful development hand using current definitions', () => {
    for (let i = 0; i < 3; i++) {
      const lobby = createRoom('demo-' + i, 'p1'); joinRoom(lobby, 'p2'); const { room } = lobby;
      room.players.p1.deck = buildTestDeck('p1'); room.players.p2.deck = buildTestDeck('p2'); dealStartingHands(room);
      for (const player of Object.values(room.players)) expect(player.hand.map(card => card.blueprint.id).sort()).toEqual(['broken-fireball', 'empire-servant', 'empire-servant', 'land-red', 'land-red']);
    }
  });
  it('deals 5 cards to each player and leaves 7 in each deck', () => {
    const lobby = createRoom('room-1', 'p1');
    joinRoom(lobby, 'p2'); const { room } = lobby;
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
      expect(card.state.visibility).toBe('owner');
      expect(card.state.visibilityZone).toBe('hand');
    }
    for (const card of room.players['p2'].hand) {
      expect(card.uuid).toBeTruthy();
      expect(card.state.zone).toBe('hand');
      expect(card.state.visibility).toBe('owner');
      expect(card.state.visibilityZone).toBe('hand');
    }
  });

  it('clears any prior hand contents before dealing', () => {
    const lobby = createRoom('room-1', 'p1');
    joinRoom(lobby, 'p2'); const { room } = lobby;
    room.players['p1'].deck = buildTestDeck('p1');
    room.players['p2'].deck = buildTestDeck('p2');
    // Simulate pre-existing cards in hand.
    room.players['p1'].hand = [instantiateCard('empire-servant')];
    room.players['p2'].hand = [instantiateCard('empire-servant')];

    dealStartingHands(room);

    expect(room.players['p1'].hand.length).toBe(5);
    expect(room.players['p2'].hand.length).toBe(5);
  });
});
