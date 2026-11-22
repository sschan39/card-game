import { expect } from 'vitest';
import { CardCharacteristicService as stats } from '@engine/card-characteristic-service';
import { castWithPayment, fixtureCard, permanent, resolveByPassing, type CardCase } from '../helpers/card-test-cases';
import { windRevealClaim } from '../helpers/wind-reveal-card-case';

export default [...windRevealClaim(), {
  name: 'discards the caster’s remaining hand and draws according to the opponent’s hand size at resolution',
  covers: ['play', 'mode:replace-hand'],
  prepare(room) {
    room.players.player1.hand.push(fixtureCard('old-1', 'player1', 'hand'), fixtureCard('old-2', 'player1', 'hand'));
    room.players.player1.deck = ['bottom', 'second', 'first'].map(id => fixtureCard(id, 'player1', 'library'));
    room.players.player2.hand = [fixtureCard('opponent-old', 'player2', 'hand')];
    room.players.player2.deck = [fixtureCard('opponent-new', 'player2', 'library')];
  },
  run(engine, source) {
    castWithPayment(engine, source, { green: 1, red: 1 }, { modes: ['replace-hand'] });
    engine.applyMutations([{ type: 'MOVE_CARD', playerId: 'player2', cardUuid: 'opponent-new', from: 'library', to: 'hand' }]);
    resolveByPassing(engine);
    const { player1, player2 } = engine.roomState.players;
    expect(player1.hand.map(card => card.uuid)).toEqual(['first', 'second']);
    expect(player1.graveyard.map(card => card.uuid)).toEqual(['old-1', 'old-2', source.uuid]);
    expect(player2.hand.map(card => card.uuid)).toEqual(['opponent-old', 'opponent-new']);
  },
}, {
  name: 'adds one attack to the selected friendly creature only through the current combat',
  covers: ['mode:combat-boost'],
  prepare(room) {
    room.phase = 'beginCombatStep';
    room.battlefield = [fixtureCard('ally', 'player1', 'battlefield'), fixtureCard('enemy', 'player2', 'battlefield')];
  },
  run(engine, source) {
    const castAt = (cardUuid: string) => ({ modes: ['combat-boost'], targets: [{ targetType: 'permanent', cardUuid }] });
    expect(engine.executePlayerAction('player1', 'cast_spell', { cardUuid: source.uuid, ...castAt('enemy') }).success).toBe(false);
    expect(engine.executePlayerAction('player1', 'cast_spell', { cardUuid: source.uuid, modes: ['replace-hand'] }).success).toBe(false);
    castWithPayment(engine, source, { green: 1, red: 1 }, castAt('ally'));
    resolveByPassing(engine);
    const power = () => stats.resolvePower(engine.roomState, permanent(engine, 'ally'));
    expect(power()).toBe(3);
    engine.applyMutations([{ type: 'CLEAR_COMBAT' }]);
    expect(power()).toBe(2);
  },
}] satisfies CardCase[];
