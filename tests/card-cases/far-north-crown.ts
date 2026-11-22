import { expect } from 'vitest';
import { CardCharacteristicService as stats } from '@engine/card-characteristic-service';
import { act, castWithPayment, fixtureCard, permanent, resolveByPassing, type CardCase } from '../helpers/card-test-cases';

export default [15, 16].map(life => ({
  name: `boosts an equipped Ice Dragon and taps once per game to bottom opposing creatures at life 15 or lower (${life})`,
  covers: ['play', 'ability:attach', 'ability:equipment-effects', 'ability:crown-return'],
  prepare(room) {
    room.players.player1.life = life;
    room.battlefield = [
      fixtureCard('dragon', 'player1', 'battlefield', { subTypes: ['冰龍'] }),
      fixtureCard('ordinary', 'player1', 'battlefield'),
      fixtureCard('enemy-1', 'player2', 'battlefield'),
      fixtureCard('enemy-2', 'player2', 'battlefield', { subTypes: ['冰龍'] }),
      fixtureCard('land', 'player2', 'battlefield', { cardTypes: ['Land'] }),
    ];
    room.players.player2.deck = [fixtureCard('original', 'player2', 'library')];
  },
  run(engine, source) {
    castWithPayment(engine, source, { white: 5 });
    resolveByPassing(engine);
    const attach = (cardUuid: string) => ({ cardUuid: source.uuid, abilityId: 'attach', targets: [{ targetType: 'permanent', cardUuid }] });
    for (const invalid of ['ordinary', 'enemy-2']) expect(engine.executePlayerAction('player1', 'activate_ability', attach(invalid)).success).toBe(false);
    act(engine, 'activate_ability', attach('dragon'));
    resolveByPassing(engine);
    expect(stats.resolvePower(engine.roomState, permanent(engine, 'dragon'))).toBe(4);
    const sweep = { cardUuid: source.uuid, abilityId: 'crown-return' };
    act(engine, 'activate_ability', sweep);
    expect(permanent(engine, source.uuid).state.isTapped).toBe(true);
    resolveByPassing(engine);
    const deck = engine.roomState.players.player2.deck.map(card => card.uuid);
    expect(deck.slice(0, -1).sort()).toEqual(life === 15 ? ['enemy-1', 'enemy-2'] : []);
    expect(deck.at(-1)).toBe('original');
    expect(engine.roomState.battlefield.filter(card => card.uuid !== source.uuid).map(card => card.uuid))
      .toEqual(life === 15 ? ['dragon', 'ordinary', 'land'] : ['dragon', 'ordinary', 'enemy-1', 'enemy-2', 'land']);
    engine.applyMutations([
      { type: 'MOVE_CARD', playerId: 'player1', cardUuid: source.uuid, from: 'battlefield', to: 'hand' },
      { type: 'MOVE_CARD', playerId: 'player1', cardUuid: source.uuid, from: 'hand', to: 'battlefield' },
    ]);
    expect(permanent(engine, source.uuid).state.isTapped).toBe(false);
    expect(engine.executePlayerAction('player1', 'activate_ability', sweep).success).toBe(false);
  },
}) satisfies CardCase);
