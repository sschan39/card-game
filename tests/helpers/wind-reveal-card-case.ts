import { expect } from 'vitest';
import { instantiateCard } from '@library/card-factory';
import { castWithPayment, choose, fixtureCard, passPriorityPair, resolveByPassing, type CardCase } from './card-test-cases';

export function windRevealClaim(): CardCase[] {
  return [true, false].map(accept => ({
    name: `can claim itself after a Wind Spirit reveal (${accept ? 'accept' : 'decline'})`,
    covers: ['ability:recover-when-revealed'],
    requires: ['wind-spirit-hornblower-murad'],
    prepare(room) {
      const player = room.players.player1;
      const [source] = player.hand.splice(0, 1);
      source.state.zone = 'library';
      player.deck = [fixtureCard('ordinary', 'player1', 'library'), source];
      const murad = instantiateCard('wind-spirit-hornblower-murad');
      murad.state = { ...murad.state, zone: 'hand', ownerId: 'player1', controllerId: 'player1' };
      player.hand.push(murad);
    },
    run(engine, source) {
      const player = () => engine.roomState.players.player1;
      castWithPayment(engine, player().hand[0], { green: 2 });
      resolveByPassing(engine);
      passPriorityPair(engine);
      const deployment = engine.roomState.pendingChoice;
      if (deployment?.kind !== 'search') throw new Error('Expected the optional deployment choice');
      expect(deployment.options).toEqual([]);
      choose(engine, []);
      choose(engine, [source.uuid, 'ordinary']);
      expect(engine.roomState.stack.at(-1)?.source.uuid).toBe(source.uuid);
      passPriorityPair(engine);
      choose(engine, [accept ? 'yes' : 'no']);
      expect(player().hand.map(card => card.uuid)).toEqual(accept ? [source.uuid] : []);
      expect(player().deck.map(card => card.uuid)).toEqual(accept ? ['ordinary'] : ['ordinary', source.uuid]);
    },
  }));
}
