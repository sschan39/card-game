import { describe, it, expect, beforeEach } from 'vitest';
import { CardCharacteristicService } from '../../src/engine/card-characteristic-service';
import { createTestRoom } from '../helpers/test-room-factory';
import { instantiateCard } from '../../src/library/card-factory';
import type { GameRoom } from '../../src/types/game.room.types';
import type { CardInstance } from '../../src/types/card.types';

function makeCreature(room: GameRoom, overrides?: Partial<CardInstance['state']>): CardInstance {
  const card = instantiateCard('empire-servant'); // 1/1 creature
  card.state = {
    ...card.state,
    zone: 'battlefield',
    ownerId: 'player1',
    controllerId: 'player1',
    ...overrides,
  };
  room.battlefield.push(card);
  return card;
}

describe('CardCharacteristicService', () => {
  let room: GameRoom;

  beforeEach(() => {
    room = createTestRoom();
  });

  describe('resolvePower / resolveToughness', () => {
    it('returns blueprint stats when pool is empty', () => {
      const card = makeCreature(room);
      expect(CardCharacteristicService.resolvePower(room, card)).toBe(1);
      expect(CardCharacteristicService.resolveToughness(room, card)).toBe(1);
    });

    it('applies STAT_DELTA entries from the pool', () => {
      const card = makeCreature(room);
      room.continuousEffectPool.push({
        source: card.uuid,
        layer: 7,
        effect: { type: 'STAT_DELTA', power: 2, toughness: 2 },
        scope: { cardUuid: card.uuid },
        duration: 'END_OF_TURN',
      });

      expect(CardCharacteristicService.resolvePower(room, card)).toBe(3);
      expect(CardCharacteristicService.resolveToughness(room, card)).toBe(3);
    });

    it('sums multiple STAT_DELTA entries', () => {
      const card = makeCreature(room);
      const anthemSource = instantiateCard('empire-servant');
      anthemSource.state.zone = 'battlefield';
      anthemSource.state.controllerId = 'player1';
      room.battlefield.push(anthemSource);

      room.continuousEffectPool.push(
        {
          source: anthemSource.uuid,
          layer: 7,
          effect: { type: 'STAT_DELTA', power: 1 },
          scope: { cardTypes: ['Creature'] },
          duration: 'WHILE_ON_BATTLEFIELD',
        },
        {
          source: anthemSource.uuid,
          layer: 7,
          effect: { type: 'STAT_DELTA', power: 2, toughness: 2 },
          scope: { cardUuid: card.uuid },
          duration: 'END_OF_TURN',
        },
      );

      expect(CardCharacteristicService.resolvePower(room, card)).toBe(4); // 1 + 1 + 2
      expect(CardCharacteristicService.resolveToughness(room, card)).toBe(3); // 1 + 0 + 2
    });

    it('adds +1/+1 counters on top of pool deltas', () => {
      const card = makeCreature(room);
      card.state.counters['+1/+1'] = 3;
      room.continuousEffectPool.push({
        source: card.uuid,
        layer: 7,
        effect: { type: 'STAT_DELTA', power: 2 },
        scope: { cardUuid: card.uuid },
        duration: 'END_OF_TURN',
      });

      expect(CardCharacteristicService.resolvePower(room, card)).toBe(6); // 1 + 2 + 3
      expect(CardCharacteristicService.resolveToughness(room, card)).toBe(4); // 1 + 0 + 3
    });

    it('ignores non-STAT_DELTA entries', () => {
      const card = makeCreature(room);
      room.continuousEffectPool.push({
        source: card.uuid,
        layer: 7,
        effect: { type: 'SET_STATS', power: 5, toughness: 5 },
        scope: { cardUuid: card.uuid },
        duration: 'PERMANENT',
      });

      // SET_STATS has no handler yet; resolver only applies STAT_DELTA
      expect(CardCharacteristicService.resolvePower(room, card)).toBe(1);
      expect(CardCharacteristicService.resolveToughness(room, card)).toBe(1);
    });

    it('handles cards with no power/toughness (non-creatures)', () => {
      const card = instantiateCard('land-red');
      card.state.zone = 'battlefield';
      room.battlefield.push(card);

      expect(CardCharacteristicService.resolvePower(room, card)).toBe(0);
      expect(CardCharacteristicService.resolveToughness(room, card)).toBe(0);
    });
  });

  describe('hasValidSourceZone', () => {
    it('returns true for emblem sources', () => {
      const card = makeCreature(room);
      room.continuousEffectPool.push({
        source: 'emblem',
        layer: 7,
        effect: { type: 'STAT_DELTA', power: 1 },
        scope: { cardTypes: ['Creature'] },
        duration: 'PERMANENT',
      });

      expect(CardCharacteristicService.resolvePower(room, card)).toBe(2);
    });

    it('returns false when source card is not in requiredZone', () => {
      const card = makeCreature(room);
      // Entry references a source that doesn't exist on battlefield
      room.continuousEffectPool.push({
        source: 'missing-card-uuid',
        layer: 7,
        effect: { type: 'STAT_DELTA', power: 5 },
        scope: { cardTypes: ['Creature'] },
        requiredZone: 'battlefield',
        duration: 'WHILE_ON_BATTLEFIELD',
      });

      // Effect should NOT apply — source not found in required zone
      expect(CardCharacteristicService.resolvePower(room, card)).toBe(1);
    });

    it('finds source in graveyard when requiredZone is graveyard', () => {
      const card = makeCreature(room);
      const graveyardSource = instantiateCard('empire-servant');
      graveyardSource.state.zone = 'graveyard';
      graveyardSource.state.ownerId = 'player1';
      graveyardSource.state.controllerId = 'player1';
      room.players['player1'].graveyard.push(graveyardSource);

      room.continuousEffectPool.push({
        source: graveyardSource.uuid,
        layer: 7,
        effect: { type: 'STAT_DELTA', power: 3 },
        scope: { cardTypes: ['Creature'] },
        requiredZone: 'graveyard',
        duration: 'PERMANENT',
      });

      expect(CardCharacteristicService.resolvePower(room, card)).toBe(4); // 1 + 3
    });
  });

  describe('matchesScope', () => {
    it('matches by cardUuid', () => {
      const card1 = makeCreature(room);
      const card2 = makeCreature(room);
      const sourceCard = instantiateCard('empire-servant');
      sourceCard.state.zone = 'battlefield';
      sourceCard.state.controllerId = 'player1';
      room.battlefield.push(sourceCard);

      room.continuousEffectPool.push({
        source: sourceCard.uuid,
        layer: 7,
        effect: { type: 'STAT_DELTA', power: 2 },
        scope: { cardUuid: card1.uuid },
        duration: 'END_OF_TURN',
      });

      expect(CardCharacteristicService.resolvePower(room, card1)).toBe(3);
      expect(CardCharacteristicService.resolvePower(room, card2)).toBe(1); // not matched
    });

    it('matches by cardTypes', () => {
      const creature = makeCreature(room);
      const land = instantiateCard('land-red');
      land.state.zone = 'battlefield';
      room.battlefield.push(land);
      const anthemSource = instantiateCard('empire-servant');
      anthemSource.state.zone = 'battlefield';
      anthemSource.state.controllerId = 'player1';
      room.battlefield.push(anthemSource);

      room.continuousEffectPool.push({
        source: anthemSource.uuid,
        layer: 7,
        effect: { type: 'STAT_DELTA', power: 1, toughness: 1 },
        scope: { cardTypes: ['Creature'] },
        duration: 'WHILE_ON_BATTLEFIELD',
      });

      expect(CardCharacteristicService.resolvePower(room, creature)).toBe(2);
      // Land is not a creature — anthem doesn't apply
      expect(CardCharacteristicService.resolvePower(room, land)).toBe(0);
    });

    it('matches by controller (self)', () => {
      const myCreature = makeCreature(room); // controllerId: 'player1'
      const theirCreature = makeCreature(room, { controllerId: 'player2' });

      const sourceCard = instantiateCard('empire-servant');
      sourceCard.state.zone = 'battlefield';
      sourceCard.state.controllerId = 'player1';
      room.battlefield.push(sourceCard);

      room.continuousEffectPool.push({
        source: sourceCard.uuid,
        layer: 7,
        effect: { type: 'STAT_DELTA', power: 2 },
        scope: { cardTypes: ['Creature'], controller: 'self' },
        duration: 'WHILE_ON_BATTLEFIELD',
      });

      expect(CardCharacteristicService.resolvePower(room, myCreature)).toBe(3);
      expect(CardCharacteristicService.resolvePower(room, theirCreature)).toBe(1);
    });
  });
});