import { expect } from 'vitest';
import { CardCharacteristicService as stats } from '@engine/card-characteristic-service';
import { act, castWithPayment, choose, fixtureCard, passPriorityPair, permanent, resolveByPassing, type CardCase } from '../helpers/card-test-cases';

export default [true, false].map(accept => ({
  name: `offers one optional hand exchange and gives an ordinary friendly creature +2 attack while attached (${accept})`,
  covers: ['play', 'entry effects', 'ability:attach', 'ability:equipped-creature'],
  prepare(room) {
    room.battlefield = [fixtureCard('host', 'player1', 'battlefield'), fixtureCard('enemy', 'player2', 'battlefield')];
    room.players.player1.hand.push(fixtureCard('old', 'player1', 'hand'));
    room.players.player1.deck = ['bottom', 'second', 'first'].map(id => fixtureCard(id, 'player1', 'library'));
    room.players.player2.hand = ['enemy-1', 'enemy-2'].map(id => fixtureCard(id, 'player2', 'hand'));
  },
  run(engine, source) {
    castWithPayment(engine, source, { green: 2, red: 1 });
    resolveByPassing(engine);
    passPriorityPair(engine);
    choose(engine, accept ? ['replace-hand'] : []);
    const { player1, player2 } = engine.roomState.players;
    expect(player1.hand.map(card => card.uuid)).toEqual(accept ? ['first', 'second'] : ['old']);
    expect(player1.graveyard.map(card => card.uuid)).toEqual(accept ? ['old'] : []);
    expect(player2.hand.map(card => card.uuid)).toEqual(['enemy-1', 'enemy-2']);
    const attach = (cardUuid: string) => ({ cardUuid: source.uuid, abilityId: 'attach', targets: [{ targetType: 'permanent', cardUuid }] });
    const hostPower = () => stats.resolvePower(engine.roomState, permanent(engine, 'host'));
    expect(engine.executePlayerAction('player1', 'activate_ability', attach('enemy')).success).toBe(false);
    expect(hostPower()).toBe(2);
    act(engine, 'activate_ability', attach('host'));
    resolveByPassing(engine);
    expect(hostPower()).toBe(4);
    engine.applyMutations([{ type: 'MOVE_CARD', cardUuid: source.uuid, playerId: 'player1', from: 'battlefield', to: 'hand' }]);
    expect(hostPower()).toBe(2);
  },
}) satisfies CardCase);
