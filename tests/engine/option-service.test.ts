import { describe, it, expect, beforeEach } from 'vitest';
import { OptionService, type ActionOption } from '../../src/engine/option-service';
import { createTestRoom } from '../helpers/test-room-factory';
import { ACTION_IDS } from '../../src/types/action.ids';
import type { GameRoom } from '../../src/types/game.room.types';

describe('OptionService', () => {
  let service: OptionService;
  let room: GameRoom;

  beforeEach(() => {
    service = new OptionService();
    room = createTestRoom();
  });

  describe('getOptions for hand cards', () => {
    it('should return cast_spell for a card in hand with enough mana', () => {
      const card = room.players['player1'].hand[0];
      card.blueprint.castRequirements.cost = { mana: { red: 1 } };

      const options = service.getOptions(room, 'player1', card.uuid, 'hand');
      expect(options.length).toBeGreaterThan(0);
      expect(options.some(o => o.actionId === ACTION_IDS.castSpell)).toBe(true);
    });

    it('should return disabled cast_spell when insufficient mana', () => {
      room.players['player1'].mana.red = 0;
      const card = room.players['player1'].hand[0];
      card.blueprint.castRequirements.cost = { mana: { red: 5 } };

      const options = service.getOptions(room, 'player1', card.uuid, 'hand');
      const playOption = options.find(o => o.actionId === ACTION_IDS.castSpell);
      expect(playOption).toBeDefined();
      expect(playOption!.disabled).toBe(true);
    });

    it('should return empty array for card not in hand', () => {
      const options = service.getOptions(room, 'player1', 'nonexistent-uuid', 'hand');
      expect(options).toEqual([]);
    });

    it('should NOT emit a stale playCardAction actionId (regression)', () => {
      // The actionId must match the registered handler name `cast_spell`,
      // not the legacy `playCardAction` that caused "No handler registered".
      const card = room.players['player1'].hand[0];
      card.blueprint.castRequirements.cost = { mana: { red: 1 } };

      const options = service.getOptions(room, 'player1', card.uuid, 'hand');
      expect(options.some(o => o.actionId === 'playCardAction')).toBe(false);
      expect(options.some(o => o.actionId === ACTION_IDS.castSpell)).toBe(true);
    });
  });

  describe('getOptions for battlefield cards', () => {
    it('should return tapForMana for untapped land on battlefield', () => {
      const card = room.players['player1'].hand[0];
      card.blueprint.cardTypes = ['Land'];
      card.state.zone = 'battlefield';
      card.state.isTapped = false;
      room.battlefield.push(card);
      room.players['player1'].hand = [];

      const options = service.getOptions(room, 'player1', card.uuid, 'battlefield');
      expect(options.some(o => o.actionId === ACTION_IDS.tapForMana)).toBe(true);
    });

    it('should return disabled tapForMana for tapped land', () => {
      const card = room.players['player1'].hand[0];
      card.blueprint.cardTypes = ['Land'];
      card.state.zone = 'battlefield';
      card.state.isTapped = true;
      room.battlefield.push(card);
      room.players['player1'].hand = [];

      const options = service.getOptions(room, 'player1', card.uuid, 'battlefield');
      const tapOption = options.find(o => o.actionId === ACTION_IDS.tapForMana);
      expect(tapOption).toBeDefined();
      expect(tapOption!.disabled).toBe(true);
    });

    it('should return empty array for card not on battlefield', () => {
      const options = service.getOptions(room, 'player1', 'nonexistent-uuid', 'battlefield');
      expect(options).toEqual([]);
    });

    it('should not emit a duplicate activateAbility_* option for a mana ability', () => {
      // empire-servant has an ADD_MANA activated ability. It should surface as
      // a single "Tap for Mana" option, NOT also as activateAbility_ADD_MANA.
      const card = room.players['player1'].hand[0];
      card.blueprint.cardTypes = ['Creature'];
      card.blueprint.abilities = [
        { type: 'activated', cost: { tap: true, mana: null }, effect: { effectId: 'ADD_MANA', params: { color: 'red', amount: 1 } }, castSpeed: 'instant' },
      ];
      card.state.zone = 'battlefield';
      card.state.isTapped = false;
      room.battlefield.push(card);
      room.players['player1'].hand = [];

      const options = service.getOptions(room, 'player1', card.uuid, 'battlefield');
      expect(options.some(o => o.actionId === ACTION_IDS.tapForMana)).toBe(true);
      expect(options.some(o => o.actionId === 'activateAbility_ADD_MANA')).toBe(false);
    });

    it('should NOT emit a stale tapForManaAction actionId (regression)', () => {
      // The actionId must match the registered handler name `tapForMana`,
      // not the legacy `tapForManaAction` that caused "No handler registered".
      const card = room.players['player1'].hand[0];
      card.blueprint.cardTypes = ['Land'];
      card.state.zone = 'battlefield';
      card.state.isTapped = false;
      room.battlefield.push(card);
      room.players['player1'].hand = [];

      const options = service.getOptions(room, 'player1', card.uuid, 'battlefield');
      expect(options.some(o => o.actionId === 'tapForManaAction')).toBe(false);
      expect(options.some(o => o.actionId === ACTION_IDS.tapForMana)).toBe(true);
    });

    it('should still emit activateAbility_* for a NON-mana activated ability', () => {
      // Only pure mana abilities are folded into "Tap for Mana". A real
      // activated ability (e.g. a damage ping) must still surface as
      // activateAbility_<EFFECT_ID> so it is not over-filtered.
      const card = room.players['player1'].hand[0];
      card.blueprint.cardTypes = ['Creature'];
      card.blueprint.abilities = [
        { type: 'activated', cost: { tap: true, mana: { red: 1 } }, effect: { effectId: 'DEAL_DAMAGE', params: { amount: 1 } }, castSpeed: 'instant' },
      ];
      card.state.zone = 'battlefield';
      card.state.isTapped = false;
      room.battlefield.push(card);
      room.players['player1'].hand = [];

      const options = service.getOptions(room, 'player1', card.uuid, 'battlefield');
      expect(options.some(o => o.actionId === 'activateAbility_DEAL_DAMAGE')).toBe(true);
      expect(options.some(o => o.actionId === ACTION_IDS.tapForMana)).toBe(false);
    });
  });
});