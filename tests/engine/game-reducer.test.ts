import { describe, it, expect, beforeEach } from 'vitest';
import { gameReducer } from '../../src/engine/game-reducer';
import type { GameMutation } from '../../src/types/game-mutation.types';
import { createTestRoom } from '../helpers/test-room-factory';
import { instantiateCard } from '../../src/library/card-factory';
import type { GameRoom } from '../../src/types/game.room.types';
import type { CardInstance } from '../../src/types/card.types';
import type { StackObject } from '../../src/types/effect.types';

function makeStackObj(uuid: string, source: CardInstance): StackObject {
  return {
    uuid,
    type: 'spell',
    controllerId: 'player1',
    source,
    effects: [],
    countered: false,
  };
}

describe('gameReducer', () => {
  let room: GameRoom;

  beforeEach(() => {
    room = createTestRoom();
  });

  describe('player mutations', () => {
    it('SET_LIFE sets a player life total', () => {
      const next = gameReducer(room, { type: 'SET_LIFE', playerId: 'player1', amount: 12 });
      expect(next.players['player1'].life).toBe(12);
      // original untouched
      expect(room.players['player1'].life).toBe(20);
    });

    it('SET_MANA sets a specific mana color', () => {
      const next = gameReducer(room, { type: 'SET_MANA', playerId: 'player1', color: 'red', amount: 3 });
      expect(next.players['player1'].mana.red).toBe(3);
      expect(room.players['player1'].mana.red).toBe(5);
    });

    it('ADD_MANA increments a mana color', () => {
      const next = gameReducer(room, { type: 'ADD_MANA', playerId: 'player1', color: 'red', amount: 2 });
      expect(next.players['player1'].mana.red).toBe(7);
    });

    it('SPEND_MANA deducts a full mana cost', () => {
      const next = gameReducer(room, {
        type: 'SPEND_MANA',
        playerId: 'player1',
        cost: { red: 2, blue: 1 },
      });
      expect(next.players['player1'].mana.red).toBe(3);
      expect(next.players['player1'].mana.blue).toBe(4);
      expect(next.players['player1'].mana.green).toBe(5);
    });
  });

  describe('card state mutations', () => {
    it('TAP_CARD taps a battlefield card', () => {
      const card = instantiateCard('empire-servant');
      card.state.zone = 'battlefield';
      card.state.controllerId = 'player1';
      room.battlefield.push(card);

      const next = gameReducer(room, { type: 'TAP_CARD', cardUuid: card.uuid });
      expect(next.battlefield[0].state.isTapped).toBe(true);
      expect(room.battlefield[0].state.isTapped).toBe(false);
    });

    it('UNTAP_CARD untaps a tapped card', () => {
      const card = instantiateCard('empire-servant');
      card.state.zone = 'battlefield';
      card.state.controllerId = 'player1';
      card.state.isTapped = true;
      room.battlefield.push(card);

      const next = gameReducer(room, { type: 'UNTAP_CARD', cardUuid: card.uuid });
      expect(next.battlefield[0].state.isTapped).toBe(false);
    });

    it('SET_SUMMONING_SICKNESS updates the flag', () => {
      const card = instantiateCard('empire-servant');
      card.state.zone = 'battlefield';
      card.state.controllerId = 'player1';
      room.battlefield.push(card);

      const next = gameReducer(room, { type: 'SET_SUMMONING_SICKNESS', cardUuid: card.uuid, value: true });
      expect(next.battlefield[0].state.summoningSickness).toBe(true);
    });

    it('SET_DAMAGE sets absolute damage', () => {
      const card = instantiateCard('empire-servant');
      card.state.zone = 'battlefield';
      card.state.controllerId = 'player1';
      room.battlefield.push(card);

      const next = gameReducer(room, { type: 'SET_DAMAGE', cardUuid: card.uuid, amount: 3 });
      expect(next.battlefield[0].state.damageTaken).toBe(3);
    });

    it('ADD_COUNTER increments a counter type', () => {
      const card = instantiateCard('empire-servant');
      card.state.zone = 'battlefield';
      card.state.controllerId = 'player1';
      room.battlefield.push(card);

      const next = gameReducer(room, { type: 'ADD_COUNTER', cardUuid: card.uuid, counterType: '+1/+1', amount: 2 });
      expect(next.battlefield[0].state.counters['+1/+1']).toBe(2);
    });

    it('REMOVE_COUNTER decrements but never below zero', () => {
      const card = instantiateCard('empire-servant');
      card.state.zone = 'battlefield';
      card.state.controllerId = 'player1';
      card.state.counters['+1/+1'] = 1;
      room.battlefield.push(card);

      const next = gameReducer(room, { type: 'REMOVE_COUNTER', cardUuid: card.uuid, counterType: '+1/+1', amount: 5 });
      expect(next.battlefield[0].state.counters['+1/+1']).toBe(0);
    });

    it('card mutations are no-ops when the card is not found', () => {
      const next = gameReducer(room, { type: 'TAP_CARD', cardUuid: 'missing' });
      expect(next).toBe(room);
    });
  });

  describe('continuous effect pool mutations', () => {
    it('ADD_CONTINUOUS_EFFECT appends an entry to the pool', () => {
      const entry = {
        source: 'card-123',
        layer: 7,
        effect: { type: 'STAT_DELTA', power: 2 } as const,
        scope: { cardTypes: ['Creature'] },
        duration: 'END_OF_TURN' as const,
      };

      const next = gameReducer(room, { type: 'ADD_CONTINUOUS_EFFECT', entry });
      expect(next.continuousEffectPool).toHaveLength(1);
      expect(next.continuousEffectPool[0]).toEqual(entry);
      // original untouched
      expect(room.continuousEffectPool).toHaveLength(0);
    });

    it('REMOVE_CONTINUOUS_EFFECT removes all entries from a source', () => {
      room.continuousEffectPool = [
        { source: 'card-A', layer: 7, effect: { type: 'STAT_DELTA', power: 1 }, scope: {}, duration: 'END_OF_TURN' },
        { source: 'card-B', layer: 7, effect: { type: 'STAT_DELTA', toughness: 1 }, scope: {}, duration: 'PERMANENT' },
        { source: 'card-A', layer: 7, effect: { type: 'STAT_DELTA', toughness: 2 }, scope: {}, duration: 'END_OF_TURN' },
      ];

      const next = gameReducer(room, { type: 'REMOVE_CONTINUOUS_EFFECT', source: 'card-A' });
      expect(next.continuousEffectPool).toHaveLength(1);
      expect(next.continuousEffectPool[0].source).toBe('card-B');
    });

    it('CLEAR_END_OF_TURN_EFFECTS strips only END_OF_TURN entries', () => {
      room.continuousEffectPool = [
        { source: 'card-A', layer: 7, effect: { type: 'STAT_DELTA', power: 1 }, scope: {}, duration: 'END_OF_TURN' },
        { source: 'card-B', layer: 7, effect: { type: 'STAT_DELTA', toughness: 1 }, scope: {}, duration: 'PERMANENT' },
        { source: 'card-C', layer: 7, effect: { type: 'STAT_DELTA', power: 2 }, scope: {}, duration: 'END_OF_TURN' },
      ];

      const next = gameReducer(room, { type: 'CLEAR_END_OF_TURN_EFFECTS' });
      expect(next.continuousEffectPool).toHaveLength(1);
      expect(next.continuousEffectPool[0].source).toBe('card-B');
    });

    it('REMOVE_CONTINUOUS_EFFECT is a no-op when source has no entries', () => {
      const next = gameReducer(room, { type: 'REMOVE_CONTINUOUS_EFFECT', source: 'nonexistent' });
      expect(next.continuousEffectPool).toEqual(room.continuousEffectPool);
    });
  });

  describe('zone mutations', () => {
    it('MOVE_CARD moves a card from hand to battlefield', () => {
      const card = room.players['player1'].hand[0];
      const next = gameReducer(room, {
        type: 'MOVE_CARD',
        cardUuid: card.uuid,
        playerId: 'player1',
        from: 'hand',
        to: 'battlefield',
      });

      expect(next.players['player1'].hand.length).toBe(0);
      expect(next.battlefield.length).toBe(1);
      expect(next.battlefield[0].uuid).toBe(card.uuid);
      expect(next.battlefield[0].state.zone).toBe('battlefield');
    });

    it('MOVE_CARD moves a card between per-player zones', () => {
      const card = room.players['player1'].hand[0];
      const next = gameReducer(room, {
        type: 'MOVE_CARD',
        cardUuid: card.uuid,
        playerId: 'player1',
        from: 'hand',
        to: 'graveyard',
      });

      expect(next.players['player1'].hand.length).toBe(0);
      expect(next.players['player1'].graveyard.length).toBe(1);
      expect(next.players['player1'].graveyard[0].state.zone).toBe('graveyard');
    });

    it('MOVE_CARD from stack to battlefield finds the card inside the StackObject', () => {
      const card = instantiateCard('empire-servant');
      card.state.zone = 'stack';
      card.state.controllerId = 'player1';
      room.stack.push(makeStackObj('stack-1', card));

      const next = gameReducer(room, {
        type: 'MOVE_CARD',
        cardUuid: card.uuid,
        playerId: 'player1',
        from: 'stack',
        to: 'battlefield',
      });

      expect(next.battlefield.length).toBe(1);
      expect(next.battlefield[0].state.zone).toBe('battlefield');
    });

    it('MOVE_CARD to stack removes from source zone and sets zone to stack', () => {
      const card = room.players['player1'].hand[0];
      const next = gameReducer(room, {
        type: 'MOVE_CARD',
        cardUuid: card.uuid,
        playerId: 'player1',
        from: 'hand',
        to: 'stack',
      });

      expect(next.players['player1'].hand.length).toBe(0);
      // card is not pushed into room.stack (that is PUSH_STACK's job)
      expect(next.stack.length).toBe(0);
    });

    it('SET_CARD_ZONE updates only the zone flag', () => {
      const card = room.players['player1'].hand[0];
      const next = gameReducer(room, { type: 'SET_CARD_ZONE', cardUuid: card.uuid, playerId: 'player1', zone: 'graveyard' });

      // still in hand array, but zone flag changed
      expect(next.players['player1'].hand.length).toBe(1);
      expect(next.players['player1'].hand[0].state.zone).toBe('graveyard');
    });
  });

  describe('stack mutations', () => {
    it('PUSH_STACK appends a StackObject', () => {
      const card = instantiateCard('empire-servant');
      const stackObj = makeStackObj('stack-1', card);
      const next = gameReducer(room, { type: 'PUSH_STACK', stackObject: stackObj });

      expect(next.stack.length).toBe(1);
      expect(next.stack[0].uuid).toBe('stack-1');
    });

    it('POP_STACK removes the top StackObject', () => {
      const card = instantiateCard('empire-servant');
      room.stack.push(makeStackObj('stack-1', card));
      room.stack.push(makeStackObj('stack-2', card));

      const next = gameReducer(room, { type: 'POP_STACK' });
      expect(next.stack.length).toBe(1);
      expect(next.stack[0].uuid).toBe('stack-1');
    });

    it('POP_STACK on empty stack is a no-op', () => {
      const next = gameReducer(room, { type: 'POP_STACK' });
      expect(next).toBe(room);
    });

    it('SET_COUNTERED marks a StackObject countered', () => {
      const card = instantiateCard('empire-servant');
      room.stack.push(makeStackObj('stack-1', card));

      const next = gameReducer(room, { type: 'SET_COUNTERED', stackUuid: 'stack-1' });
      expect(next.stack[0].countered).toBe(true);
    });
  });

  describe('phase / turn mutations', () => {
    it('SET_PHASE changes currentPhase', () => {
      const next = gameReducer(room, { type: 'SET_PHASE', phase: 'stateBattlePhase' });
      expect(next.currentPhase).toBe('stateBattlePhase');
    });

    it('SET_PREVIOUS_PHASE changes previousPhase', () => {
      const next = gameReducer(room, { type: 'SET_PREVIOUS_PHASE', phase: 'stateMainPhase' });
      expect(next.previousPhase).toBe('stateMainPhase');
    });

    it('SET_TURN changes activeTurnPlayerId', () => {
      const next = gameReducer(room, { type: 'SET_TURN', playerId: 'player2' });
      expect(next.activeTurnPlayerId).toBe('player2');
    });

    it('SET_PRIORITY changes priorityPlayerId', () => {
      const next = gameReducer(room, { type: 'SET_PRIORITY', playerId: 'player2' });
      expect(next.priorityPlayerId).toBe('player2');
    });

    it('SET_LAST_PASSED changes lastPassedPlayerId', () => {
      const next = gameReducer(room, { type: 'SET_LAST_PASSED', playerId: 'player1' });
      expect(next.lastPassedPlayerId).toBe('player1');
    });
  });

  describe('RPS mutations', () => {
    it('SET_RPS_STATUS changes rpsState.status', () => {
      const next = gameReducer(room, { type: 'SET_RPS_STATUS', status: 'resolved' });
      expect(next.rpsState.status).toBe('resolved');
    });

    it('SET_RPS_PLAYED_CARD records a player choice', () => {
      const next = gameReducer(room, { type: 'SET_RPS_PLAYED_CARD', playerId: 'player1', card: 'rock' });
      expect(next.rpsState.playedCards['player1']).toBe('rock');
    });
  });

  describe('immutability', () => {
    it('does not mutate the input state', () => {
      const snapshot = JSON.parse(JSON.stringify(room));
      gameReducer(room, { type: 'SET_LIFE', playerId: 'player1', amount: 1 });
      gameReducer(room, { type: 'SET_PHASE', phase: 'stateBattlePhase' });
      gameReducer(room, { type: 'SET_RPS_STATUS', status: 'resolved' });
      expect(room).toEqual(snapshot);
    });

    it('shares untouched subtrees by reference', () => {
      const next = gameReducer(room, { type: 'SET_LIFE', playerId: 'player1', amount: 1 });
      // player2 subtree untouched — shared by reference
      expect(next.players['player2']).toBe(room.players['player2']);
      // battlefield untouched — shared by reference
      expect(next.battlefield).toBe(room.battlefield);
    });
  });
});
