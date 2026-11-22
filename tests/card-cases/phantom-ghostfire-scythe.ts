import { expect } from 'vitest';
import { CardCharacteristicService as stats } from '@engine/card-characteristic-service';
import { act, castWithPayment, choose, declareAttack, fixtureCard, passPriorityPair, permanent, resolveByPassing, type CardCase } from '../helpers/card-test-cases';

export default (['recover', 'ineligible', 'decline'] as const).map(decision => ({
  name: `gives a friendly Puppet +2 and its own optional mill and recovery while equipped (${decision})`,
  covers: ['play', 'ability:attach', 'ability:equipment-effects'],
  prepare(room) {
    room.battlefield = [
      fixtureCard('host', 'player1', 'battlefield', { subTypes: ['幻影木偶'] }),
      fixtureCard('ordinary', 'player1', 'battlefield'),
      fixtureCard('enemy', 'player2', 'battlefield', { subTypes: ['幻影木偶'] }),
    ];
    room.players.player1.deck = [
      fixtureCard('deep', 'player1', 'library', { colors: ['black'], cardTypes: ['Spell'] }),
      fixtureCard('top', 'player1', 'library', { colors: ['black'], cardTypes: [decision === 'ineligible' ? 'Creature' : 'Spell'] }),
    ];
    room.players.player1.graveyard = [fixtureCard('old', 'player1', 'graveyard', { colors: ['black'], cardTypes: ['Spell'] })];
  },
  run(engine, source) {
    castWithPayment(engine, source, { black: 2, red: 1 });
    resolveByPassing(engine);
    const attach = (cardUuid: string) => ({ cardUuid: source.uuid, abilityId: 'attach', targets: [{ targetType: 'permanent', cardUuid }] });
    for (const invalid of ['ordinary', 'enemy']) expect(engine.executePlayerAction('player1', 'activate_ability', attach(invalid)).success).toBe(false);
    act(engine, 'activate_ability', attach('host'));
    resolveByPassing(engine);
    const power = () => stats.resolvePower(engine.roomState, permanent(engine, 'host'));
    expect(power()).toBe(4);
    declareAttack(engine, 'host');
    expect(engine.roomState.stack.at(-1)?.source.uuid).toBe('host');
    passPriorityPair(engine);
    choose(engine, [decision === 'decline' ? 'no' : 'yes']);
    if (decision === 'recover') {
      const choice = engine.roomState.pendingChoice;
      if (choice?.kind !== 'search') throw new Error('Expected recovery choice for the card the host milled');
      expect(choice.options.map(option => option.id)).toEqual(['top']);
      choose(engine, ['top']);
    }
    const player = engine.roomState.players.player1;
    expect(player.hand.map(card => card.uuid)).toEqual(decision === 'recover' ? ['top'] : []);
    expect(player.graveyard.map(card => card.uuid)).toEqual(decision === 'ineligible' ? ['old', 'top'] : ['old']);
    expect(player.deck.map(card => card.uuid)).toEqual(decision === 'decline' ? ['deep', 'top'] : ['deep']);
    engine.applyMutations([{ type: 'MOVE_CARD', cardUuid: source.uuid, playerId: 'player1', from: 'battlefield', to: 'hand' }]);
    expect(power()).toBe(2);
    expect(stats.resolveAbilities(engine.roomState, permanent(engine, 'host'))).toEqual([]);
  },
}) satisfies CardCase);
