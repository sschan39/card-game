import { expect } from 'vitest';
import { CardCharacteristicService as stats } from '@engine/card-characteristic-service';
import { castWithPayment, declareAttack, fixtureCard, permanent, resolveByPassing, type CardCase } from '../helpers/card-test-cases';

export default [{
  name: 'mills ten once, gains attack from creatures that reached the graveyard, and mills in pairs on attack',
  covers: ['play', 'ability:wisdom-entry', 'ability:wisdom-attack'],
  prepare(room) {
    room.players.player1.mana.blue = 6;
    room.players.player2.deck = [
      ...Array.from({ length: 5 }, (_, i) => fixtureCard(`deep-${i}`, 'player2', 'library')),
      ...Array.from({ length: 4 }, (_, i) => fixtureCard(`land-${i}`, 'player2', 'library', { cardTypes: ['Land'] })),
      ...Array.from({ length: 5 }, (_, i) => fixtureCard(`creature-${i}`, 'player2', 'library')),
      fixtureCard('redirected', 'player2', 'library'),
    ];
    room.players.player2.graveyard = [fixtureCard('old-creature', 'player2', 'graveyard')];
    room.replacementEffects = [{
      id: 'exile', label: 'Exile this discarded card', match: { kinds: ['discard'], card: { cardUuid: 'redirected', zoneRevision: 0 } },
      operation: { type: 'move_destination', to: 'exile' },
    }];
  },
  run(engine, source) {
    const power = () => stats.resolvePower(engine.roomState, permanent(engine, source.uuid));
    const opponent = () => engine.roomState.players.player2;
    castWithPayment(engine, source, { blue: 6 });
    resolveByPassing(engine);
    resolveByPassing(engine);
    expect(opponent().deck.map(card => card.uuid)).toEqual(['deep-0', 'deep-1', 'deep-2', 'deep-3', 'deep-4']);
    expect(opponent().exile?.map(card => card.uuid)).toEqual(['redirected']);
    expect(power()).toBe(5);
    engine.applyMutations([{ type: 'CLEAR_END_OF_TURN_EFFECTS' }]);
    expect(power()).toBe(5);
    declareAttack(engine, source.uuid);
    resolveByPassing(engine);
    expect(opponent().deck.map(card => card.uuid)).toEqual(['deep-0']);
    engine.applyMutations([
      { type: 'MOVE_CARD', cardUuid: source.uuid, playerId: 'player1', from: 'battlefield', to: 'graveyard' },
      { type: 'MOVE_CARD', cardUuid: source.uuid, playerId: 'player1', from: 'graveyard', to: 'battlefield' },
    ]);
    expect(engine.roomState.stack).toEqual([]);
    expect(power()).toBe(0);
  },
}] satisfies CardCase[];
