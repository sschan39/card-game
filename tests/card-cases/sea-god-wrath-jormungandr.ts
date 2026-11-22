import { expect } from 'vitest';
import { CardCharacteristicService as stats } from '@engine/card-characteristic-service';
import { act, castWithPayment, declareAttack, fixtureCard, resolveByPassing, type CardCase } from '../helpers/card-test-cases';

export default [true, false].map(hasLoki => ({
  name: `checks the controlled Loki discount, discards one opponent card per turn, and mills five on attack (discount: ${hasLoki})`,
  covers: ['play', 'ability:loki-cost', 'ability:random-hand-discard', 'ability:attack-mill'],
  prepare(room) {
    room.players.player1.mana.blue = 8;
    room.battlefield = [fixtureCard('enemy-loki', 'player2', 'battlefield', { name: '蒼海帝 洛基' })];
    if (hasLoki) room.battlefield.push(fixtureCard('friendly-loki', 'player1', 'battlefield', { name: '幻變之海 洛基尼亞' }));
    room.players.player2.hand = ['hand-1', 'hand-2'].map(id => fixtureCard(id, 'player2', 'hand'));
    room.players.player2.deck = Array.from({ length: 6 }, (_, i) => fixtureCard(`library-${i}`, 'player2', 'library'));
  },
  run(engine, source) {
    expect(stats.resolveManaCost(engine.roomState, source)).toEqual(hasLoki ? { blue: 3, generic: 1 } : { blue: 6 });
    castWithPayment(engine, source, hasLoki ? { blue: 3, red: 1 } : { blue: 6 });
    resolveByPassing(engine);
    const activation = { cardUuid: source.uuid, abilityId: 'random-hand-discard' };
    const blue = engine.roomState.players.player1.mana.blue;
    act(engine, 'activate_ability', activation);
    expect(engine.roomState.players.player1.mana.blue).toBe(blue - 1);
    resolveByPassing(engine);
    expect(engine.roomState.players.player2.hand).toHaveLength(1);
    const discarded = engine.roomState.players.player2.graveyard.map(card => card.uuid);
    expect(discarded).toHaveLength(1);
    expect(['hand-1', 'hand-2']).toContain(discarded[0]);
    expect(engine.executePlayerAction('player1', 'activate_ability', activation).success).toBe(false);
    declareAttack(engine, source.uuid);
    resolveByPassing(engine);
    expect(engine.roomState.players.player2.deck.map(card => card.uuid)).toEqual(['library-0']);
    expect(engine.roomState.players.player2.graveyard.map(card => card.uuid))
      .toEqual([...discarded, 'library-5', 'library-4', 'library-3', 'library-2', 'library-1']);
  },
}) satisfies CardCase);
