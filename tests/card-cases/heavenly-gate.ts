import { expect } from 'vitest';
import { act, castWithPayment, fixtureCard, resolveByPassing, type CardCase } from '../helpers/card-test-cases';

export default [
  {
    name: 'entry heals then draws, and main-phase sacrifice yields yellow without destroying the gate',
    covers: ['play', 'entry effects', 'ability:sacrifice-for-yellow'],
    prepare(room) { room.players.player1.deck = [fixtureCard('draw', 'player1', 'library')]; },
    run(engine, source) {
      castWithPayment(engine, source, { yellow: 2, red: 1 });
      resolveByPassing(engine);
      resolveByPassing(engine);
      expect(engine.roomState.players.player1.life).toBe(21);
      expect(engine.roomState.players.player1.hand.map(card => card.uuid)).toEqual(['draw']);
      const effects = engine.drainEventBatches().flatMap(batch => batch.events)
        .filter(event => event.eventId === 'STACK_ITEM_RESOLVED').map(event => event.payload.effectId);
      expect(effects).toEqual(['MODIFY_LIFE', 'DRAW']);
      const payment = { cardUuid: source.uuid, abilityId: 'sacrifice-for-yellow' };
      engine.roomState.phase = 'declareAttackersStep';
      expect(engine.executePlayerAction('player1', 'tapForMana', payment).success).toBe(false);
      engine.roomState.phase = 'stateMainPhase';
      act(engine, 'tapForMana', payment);
      expect(engine.roomState.players.player1.graveyard.map(card => card.uuid)).toEqual([source.uuid]);
      expect(engine.roomState.players.player1.mana.yellow).toBe(4);
      const events = engine.drainEventBatches().flatMap(batch => batch.events).map(event => event.eventId);
      expect(events).not.toContain('PERMANENT_DESTROYED');
      expect(events).not.toContain('CARD_DISCARDED_FROM_HAND');
    },
  },
  {
    name: 'discarding it in a main phase produces one yellow with no entry rewards',
    covers: ['ability:discard-for-yellow'],
    run(engine, source) {
      const payment = { cardUuid: source.uuid, abilityId: 'discard-for-yellow' };
      engine.roomState.phase = 'declareAttackersStep';
      expect(engine.executePlayerAction('player1', 'activate_ability', payment).success).toBe(false);
      engine.roomState.phase = 'postcombatMainPhase';
      act(engine, 'activate_ability', payment);
      expect(engine.roomState.stack).toHaveLength(0);
      expect(engine.roomState.players.player1.mana.yellow).toBe(6);
      expect(engine.roomState.players.player1.life).toBe(20);
      expect(engine.roomState.players.player1.graveyard.map(card => card.uuid)).toEqual([source.uuid]);
      expect(engine.roomState.players.player1.hand).toHaveLength(0);
    },
  },
] satisfies CardCase[];
