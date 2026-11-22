import { expect } from 'vitest';
import { CardCharacteristicService as stats } from '@engine/card-characteristic-service';
import { deckEligibility } from '@card-game/protocol';
import { act, castWithPayment, fixtureCard, resolveByPassing, type CardCase } from '../helpers/card-test-cases';

export default [{
  name: 'grants tap-to-draw only to friendly Puppets until the castle leaves',
  covers: ['play', 'ability:grant-puppet-draw'],
  prepare(room) {
    room.battlefield = [
      fixtureCard('friendly-puppet', 'player1', 'battlefield', { subTypes: ['幻影木偶'] }),
      fixtureCard('friendly-ordinary', 'player1', 'battlefield'),
      fixtureCard('opposing-puppet', 'player2', 'battlefield', { subTypes: ['幻影木偶'] }),
    ];
    room.players.player1.deck = [fixtureCard('draw', 'player1', 'library')];
  },
  run(engine, source) {
    expect(deckEligibility.copyLimits[source.blueprint.id]).toBe(1);
    castWithPayment(engine, source, { black: 2 });
    resolveByPassing(engine);
    const granted = () => engine.roomState.battlefield.flatMap(card => stats.resolveAbilities(engine.roomState, card)
      .filter(ability => ability.type === 'activated' && ability.cost?.tap && ability.effect.action === 'DRAW')
      .map(ability => ({ cardUuid: card.uuid, abilityId: ability.id })));
    const abilities = granted();
    expect(abilities.map(ability => ability.cardUuid)).toEqual(['friendly-puppet']);
    act(engine, 'activate_ability', abilities[0]);
    resolveByPassing(engine);
    expect(engine.roomState.players.player1.hand.map(card => card.uuid)).toEqual(['draw']);
    engine.applyMutations([{ type: 'MOVE_CARD', cardUuid: source.uuid, playerId: 'player1', from: 'battlefield', to: 'graveyard' }]);
    expect(granted()).toEqual([]);
  },
}] satisfies CardCase[];
