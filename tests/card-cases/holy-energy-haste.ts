import { expect } from 'vitest';
import { castWithPayment, resolveByPassing, type CardCase } from '../helpers/card-test-cases';
import { creature } from '../helpers/combat-fixture';

export default [
  {
    name: 'draws from the bottom without drawing the top',
    covers: ['play', 'mode:bottom-draw'],
    prepare(room) {
      room.players.player1.deck = ['bottom', 'top'].map(id => {
        const card = creature(id, 'player1');
        card.state.zone = 'library';
        return card;
      });
    },
    run(engine, source) {
      castWithPayment(engine, source, { red: 1 }, { modes: ['bottom-draw'] });
      resolveByPassing(engine);
      expect(engine.roomState.players.player1.hand.map(card => card.uuid)).toEqual(['bottom']);
      expect(engine.roomState.players.player1.deck.map(card => card.uuid)).toEqual(['top']);
    },
  },
  {
    name: 'heals one during the opponent’s turn and rejects the sorcery mode',
    covers: ['mode:heal'],
    prepare(room) { room.activeTurnPlayerId = 'player2'; },
    run(engine, source) {
      expect(engine.executePlayerAction('player1', 'cast_spell', {
        cardUuid: source.uuid, payment: { red: 1 }, modes: ['bottom-draw'],
      }).success).toBe(false);
      castWithPayment(engine, source, { red: 1 }, { modes: ['heal'] });
      resolveByPassing(engine);
      expect(engine.roomState.players.player1.life).toBe(21);
      expect(engine.roomState.players.player2.life).toBe(20);
    },
  },
] satisfies CardCase[];
