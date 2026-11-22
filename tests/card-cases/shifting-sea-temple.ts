import { expect } from 'vitest';
import { CardCharacteristicService as stats } from '@engine/card-characteristic-service';
import { act, castWithPayment, declareAttack, fixtureCard, permanent, resolveByPassing, type CardCase } from '../helpers/card-test-cases';

export default [{
  name: 'boosts friendly Giant mill and taps to grant a targeted attack trigger tied to that incarnation',
  covers: ['play', 'ability:giant-mill-bonus', 'ability:grant-attack-mill'],
  prepare(room) {
    room.battlefield = [
      fixtureCard('giant', 'player1', 'battlefield', { subTypes: ['蒼巨人'] }),
      fixtureCard('enemy', 'player2', 'battlefield', { subTypes: ['蒼巨人'] }),
      fixtureCard('ordinary', 'player1', 'battlefield'),
    ];
    room.players.player2.deck = ['bottom', 'second', 'first'].map(id => fixtureCard(id, 'player2', 'library'));
  },
  run(engine, source) {
    castWithPayment(engine, source, { blue: 2 });
    resolveByPassing(engine);
    const bonus = (uuid: string) => stats.resolve(engine.roomState, permanent(engine, uuid)).millBonus;
    expect(bonus('giant')).toBe(1);
    expect(bonus('enemy')).toBeUndefined();
    expect(bonus('ordinary')).toBeUndefined();
    const activation = (cardUuid: string) => ({
      cardUuid: source.uuid, abilityId: 'grant-attack-mill', targets: [{ targetType: 'permanent', cardUuid }],
    });
    for (const invalid of ['enemy', 'ordinary']) {
      expect(engine.executePlayerAction('player1', 'activate_ability', activation(invalid)).success).toBe(false);
    }
    act(engine, 'activate_ability', activation('giant'));
    expect(permanent(engine, source.uuid).state.isTapped).toBe(true);
    resolveByPassing(engine);
    declareAttack(engine, 'giant');
    engine.applyMutations([{ type: 'MOVE_CARD', playerId: 'player1', cardUuid: 'giant', from: 'battlefield', to: 'graveyard' }]);
    resolveByPassing(engine);
    expect(engine.roomState.players.player2.graveyard.map(card => card.uuid)).toEqual(['first', 'second']);
    engine.applyMutations([{ type: 'MOVE_CARD', playerId: 'player1', cardUuid: 'giant', from: 'graveyard', to: 'battlefield' }]);
    expect(stats.resolveAbilities(engine.roomState, permanent(engine, 'giant'))).toEqual([]);
  },
}] satisfies CardCase[];
