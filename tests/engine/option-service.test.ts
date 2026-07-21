import { describe, it, expect, beforeEach } from 'vitest';
import { OptionService, type ActionOption } from '../../src/engine/option-service';
import { createTestRoom } from '../helpers/test-room-factory';
import type { GameRoom } from '../../src/types/game.room.types';

describe('OptionService', () => {
  let service: OptionService;
  let room: GameRoom;

  beforeEach(() => {
    service = new OptionService();
    room = createTestRoom();
  });

  describe('getOptions for hand cards', () => {
    it('should return playCardAction for a card in hand with enough mana', () => {
      const card = room.players['player1'].hand[0];
      card.blueprint.castRequirements.cost = { mana: { red: 1 } };

      const options = service.getOptions(room, 'player1', card.uuid, 'hand');
      expect(options.length).toBeGreaterThan(0);
      expect(options.some(o => o.actionId === 'playCardAction')).toBe(true);
    });

    it('should return disabled playCardAction when insufficient mana', () => {
      room.players['player1'].mana.red = 0;
      const card = room.players['player1'].hand[0];
      card.blueprint.castRequirements.cost = { mana: { red: 5 } };

      const options = service.getOptions(room, 'player1', card.uuid, 'hand');
      const playOption = options.find(o => o.actionId === 'playCardAction');
      expect(playOption).toBeDefined();
      expect(playOption!.disabled).toBe(true);
    });

    it('should return empty array for card not in hand', () => {
      const options = service.getOptions(room, 'player1', 'nonexistent-uuid', 'hand');
      expect(options).toEqual([]);
    });
  });

  describe('getOptions for battlefield cards', () => {
    it('should return tapForManaAction for untapped land on battlefield', () => {
      const card = room.players['player1'].hand[0];
      card.blueprint.cardTypes = ['Land'];
      card.state.zone = 'battlefield';
      card.state.isTapped = false;
      room.battlefield.push(card);
      room.players['player1'].hand = [];

      const options = service.getOptions(room, 'player1', card.uuid, 'battlefield');
      expect(options.some(o => o.actionId === 'tapForManaAction')).toBe(true);
    });

    it('should return disabled tapForManaAction for tapped land', () => {
      const card = room.players['player1'].hand[0];
      card.blueprint.cardTypes = ['Land'];
      card.state.zone = 'battlefield';
      card.state.isTapped = true;
      room.battlefield.push(card);
      room.players['player1'].hand = [];

      const options = service.getOptions(room, 'player1', card.uuid, 'battlefield');
      const tapOption = options.find(o => o.actionId === 'tapForManaAction');
      expect(tapOption).toBeDefined();
      expect(tapOption!.disabled).toBe(true);
    });

    it('should return empty array for card not on battlefield', () => {
      const options = service.getOptions(room, 'player1', 'nonexistent-uuid', 'battlefield');
      expect(options).toEqual([]);
    });
  });
});