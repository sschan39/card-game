import { describe, it, expect, beforeEach } from 'vitest';
import { EffectRegistry } from '../../src/engine/effect-registry';
import { createTestRoom } from '../helpers/test-room-factory';
import { gameReducer } from '../../src/engine/game-reducer';
import { instantiateCard } from '../../src/library/card-factory';
import type { GameMutation } from '../../src/types/game-mutation.types';
import type { GameRoom } from '../../src/types/game.room.types';
import type { StackObject, StackEffect } from '../../src/types/effect.types';
import { v4 as uuidv4 } from 'uuid';

function makeStackObj(overrides: Partial<StackObject> = {}): StackObject {
  return {
    uuid: uuidv4(),
    type: 'spell',
    controllerId: 'player1',
    source: {} as any,
    effects: [],
    countered: false,
    ...overrides,
  } as StackObject;
}

function makeEffect(overrides: Partial<StackEffect> = {}): StackEffect {
  return {
    action: 'DRAW',
    params: {},
    tags: [],
    targets: [],
    ...overrides,
  };
}

describe('EffectRegistry', () => {
  let room: GameRoom;

  /** Apply mutations through the pure reducer, committing to `room`. */
  function apply(mutations: GameMutation[]): void {
    for (const m of mutations) {
      room = gameReducer(room, m);
    }
  }

  beforeEach(() => {
    room = createTestRoom();
  });

  describe('DRAW', () => {
    it('should draw cards from library to hand', () => {
      const card1 = instantiateCard('empire-servant');
      const card2 = instantiateCard('empire-servant');
      card1.state.ownerId = 'player1';
      card1.state.controllerId = 'player1';
      card2.state.ownerId = 'player1';
      card2.state.controllerId = 'player1';
      room.players['player1'].deck = [card1, card2];
      const initialHandSize = room.players['player1'].hand.length;

      const effect = makeEffect({ action: 'DRAW', params: { amount: 2 } });
      const stackObj = makeStackObj({ effects: [effect] });

      apply(EffectRegistry['DRAW'](room, stackObj, effect));

      expect(room.players['player1'].hand.length).toBe(initialHandSize + 2);
      expect(room.players['player1'].deck.length).toBe(0);
    });

    it('should draw only available cards if deck has fewer', () => {
      const card1 = instantiateCard('empire-servant');
      card1.state.ownerId = 'player1';
      card1.state.controllerId = 'player1';
      room.players['player1'].deck = [card1];
      const initialHandSize = room.players['player1'].hand.length;

      const effect = makeEffect({ action: 'DRAW', params: { amount: 3 } });
      const stackObj = makeStackObj({ effects: [effect] });

      apply(EffectRegistry['DRAW'](room, stackObj, effect));

      expect(room.players['player1'].hand.length).toBe(initialHandSize + 1);
      expect(room.players['player1'].deck.length).toBe(0);
    });
  });

  describe('MODIFY_LIFE', () => {
    it('should add life to a player', () => {
      const effect = makeEffect({
        action: 'MODIFY_LIFE',
        params: { amount: 5 },
        targets: [{ targetType: 'player', playerId: 'player1' }],
      });
      const stackObj = makeStackObj({ effects: [effect] });

      apply(EffectRegistry['MODIFY_LIFE'](room, stackObj, effect));

      expect(room.players['player1'].life).toBe(25);
    });

    it('should subtract life (damage to player)', () => {
      const effect = makeEffect({
        action: 'MODIFY_LIFE',
        params: { amount: -3 },
        tags: ['damage'],
        targets: [{ targetType: 'player', playerId: 'player2' }],
      });
      const stackObj = makeStackObj({ effects: [effect] });

      apply(EffectRegistry['MODIFY_LIFE'](room, stackObj, effect));

      expect(room.players['player2'].life).toBe(17);
    });
  });

  describe('MODIFY_STATS', () => {
    it('should deal damage to a creature', () => {
      const creature = instantiateCard('empire-servant');
      creature.state.zone = 'battlefield';
      creature.state.controllerId = 'player2';
      room.battlefield.push(creature);

      const effect = makeEffect({
        action: 'MODIFY_STATS',
        params: { damage: 3 },
        tags: ['damage'],
        targets: [{ targetType: 'permanent', cardUuid: creature.uuid }],
      });
      const stackObj = makeStackObj({ effects: [effect] });

      apply(EffectRegistry['MODIFY_STATS'](room, stackObj, effect));

      const updated = room.battlefield.find(c => c.uuid === creature.uuid)!;
      expect(updated.state.damageTaken).toBe(3);
    });

    it('should modify power and toughness', () => {
      const creature = instantiateCard('empire-servant');
      creature.state.zone = 'battlefield';
      creature.state.controllerId = 'player1';
      room.battlefield.push(creature);

      const effect = makeEffect({
        action: 'MODIFY_STATS',
        params: { power: 2, toughness: 2 },
        tags: ['until_end_of_turn'],
        targets: [{ targetType: 'permanent', cardUuid: creature.uuid }],
      });
      const stackObj = makeStackObj({ effects: [effect] });

      apply(EffectRegistry['MODIFY_STATS'](room, stackObj, effect));

      // Power/toughness modifications are applied as net stat mods and feed
      // combat/lethality resolution via currentPower/currentToughness.
      const updated = room.battlefield.find(c => c.uuid === creature.uuid)!;
      expect(updated.state.powerMod).toBe(2);
      expect(updated.state.toughnessMod).toBe(2);
    });
  });

  describe('ADD_MANA', () => {
    it('should add mana to a player pool', () => {
      const effect = makeEffect({
        action: 'ADD_MANA',
        params: { color: 'red', amount: 3 },
      });
      const stackObj = makeStackObj({ effects: [effect], controllerId: 'player1' });

      const initialRed = room.players['player1'].mana.red;
      apply(EffectRegistry['ADD_MANA'](room, stackObj, effect));

      expect(room.players['player1'].mana.red).toBe(initialRed + 3);
    });
  });

  describe('TAP and UNTAP', () => {
    it('TAP should tap a permanent', () => {
      const creature = instantiateCard('empire-servant');
      creature.state.zone = 'battlefield';
      creature.state.isTapped = false;
      room.battlefield.push(creature);

      const effect = makeEffect({
        action: 'TAP',
        params: {},
        targets: [{ targetType: 'permanent', cardUuid: creature.uuid }],
      });
      const stackObj = makeStackObj({ effects: [effect] });

      apply(EffectRegistry['TAP'](room, stackObj, effect));

      const updated = room.battlefield.find(c => c.uuid === creature.uuid)!;
      expect(updated.state.isTapped).toBe(true);
    });

    it('UNTAP should untap a permanent', () => {
      const creature = instantiateCard('empire-servant');
      creature.state.zone = 'battlefield';
      creature.state.isTapped = true;
      room.battlefield.push(creature);

      const effect = makeEffect({
        action: 'UNTAP',
        params: {},
        targets: [{ targetType: 'permanent', cardUuid: creature.uuid }],
      });
      const stackObj = makeStackObj({ effects: [effect] });

      apply(EffectRegistry['UNTAP'](room, stackObj, effect));

      const updated = room.battlefield.find(c => c.uuid === creature.uuid)!;
      expect(updated.state.isTapped).toBe(false);
    });
  });

  describe('MOVE_ZONE', () => {
    it('should move a card from battlefield to graveyard', () => {
      const creature = instantiateCard('empire-servant');
      creature.state.zone = 'battlefield';
      creature.state.ownerId = 'player1';
      creature.state.controllerId = 'player1';
      room.battlefield.push(creature);

      const effect = makeEffect({
        action: 'MOVE_ZONE',
        params: { origin: 'battlefield', destination: 'graveyard' },
        tags: ['sacrifice'],
        targets: [{ targetType: 'permanent', cardUuid: creature.uuid }],
      });
      const stackObj = makeStackObj({ effects: [effect] });

      apply(EffectRegistry['MOVE_ZONE'](room, stackObj, effect));

      expect(room.battlefield.find(c => c.uuid === creature.uuid)).toBeUndefined();
      const moved = room.players['player1'].graveyard.find(c => c.uuid === creature.uuid)!;
      expect(moved).toBeDefined();
      expect(moved.state.zone).toBe('graveyard');
    });

    it('should mark stack object as countered when moving from stack to graveyard with counter tag', () => {
      const targetStackObj = makeStackObj({ countered: false });
      room.stack.push(targetStackObj);

      const effect = makeEffect({
        action: 'MOVE_ZONE',
        params: { origin: 'stack', destination: 'graveyard' },
        tags: ['counter'],
        targets: [{ targetType: 'stack', stackUuid: targetStackObj.uuid }],
      });
      const stackObj = makeStackObj({ effects: [effect] });

      apply(EffectRegistry['MOVE_ZONE'](room, stackObj, effect));

      const updatedStackObj = room.stack.find(s => s.uuid === targetStackObj.uuid)!;
      expect(updatedStackObj.countered).toBe(true);
    });
  });

  describe('ADD_COUNTER and REMOVE_COUNTER', () => {
    it('ADD_COUNTER should place counters on a permanent', () => {
      const creature = instantiateCard('empire-servant');
      creature.state.zone = 'battlefield';
      room.battlefield.push(creature);

      const effect = makeEffect({
        action: 'ADD_COUNTER',
        params: { counterType: '+1/+1', amount: 2 },
        targets: [{ targetType: 'permanent', cardUuid: creature.uuid }],
      });
      const stackObj = makeStackObj({ effects: [effect] });

      apply(EffectRegistry['ADD_COUNTER'](room, stackObj, effect));

      const updated = room.battlefield.find(c => c.uuid === creature.uuid)!;
      expect(updated.state.counters['+1/+1']).toBe(2);
    });

    it('REMOVE_COUNTER should remove counters from a permanent', () => {
      const creature = instantiateCard('empire-servant');
      creature.state.zone = 'battlefield';
      creature.state.counters['+1/+1'] = 3;
      room.battlefield.push(creature);

      const effect = makeEffect({
        action: 'REMOVE_COUNTER',
        params: { counterType: '+1/+1', amount: 1 },
        targets: [{ targetType: 'permanent', cardUuid: creature.uuid }],
      });
      const stackObj = makeStackObj({ effects: [effect] });

      apply(EffectRegistry['REMOVE_COUNTER'](room, stackObj, effect));

      const updated = room.battlefield.find(c => c.uuid === creature.uuid)!;
      expect(updated.state.counters['+1/+1']).toBe(2);
    });
  });
});