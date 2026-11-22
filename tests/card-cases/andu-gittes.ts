import { expect } from 'vitest';
import { castWithPayment, choose, fixtureCard, permanent, resolveByPassing, type CardCase } from '../helpers/card-test-cases';
import { flameRevealCard, prepareFlameReveal, revealWithFlameBeast } from '../helpers/flame-reveal-card-case';

const reveals: CardCase[] = (['hand', 'library', 'decline', 'replaced'] as const).map(situation => ({
  name: `places two Scorch and draws only after the revealed card reaches the graveyard by discard (${situation})`,
  covers: ['ability:reveal-discard-scorch-draw'],
  requires: [flameRevealCard],
  prepare(room) {
    prepareFlameReveal(room);
    room.battlefield = [
      fixtureCard('enemy', 'player2', 'battlefield', { toughness: 5 }),
      fixtureCard('enemy-land', 'player2', 'battlefield', { cardTypes: ['Land'] }),
      fixtureCard('ally', 'player1', 'battlefield'),
    ];
    if (situation === 'replaced') room.replacementEffects = [{
      id: 'prevent', label: 'Prevent discard', match: { kinds: ['discard'] }, operation: { type: 'cancel_event' },
    }];
  },
  run(engine, source) {
    revealWithFlameBeast(engine, source, situation === 'hand');
    choose(engine, [situation === 'decline' ? 'no' : 'yes']);
    const resolves = situation === 'hand' || situation === 'library';
    if (resolves) {
      const choice = engine.roomState.pendingChoice;
      if (!choice || choice.kind === 'number') throw new Error('Expected the Scorch selection');
      expect(choice.options).toHaveLength(1);
      expect(choice.options[0].value).toMatchObject({ cardUuid: 'enemy' });
      choose(engine, [choice.options[0].id]);
    }
    expect(engine.roomState.pendingChoice).toBeFalsy();
    expect(permanent(engine, 'enemy').state.counters.scorch ?? 0).toBe(resolves ? 2 : 0);
    const player = engine.roomState.players.player1;
    expect(player.hand.map(card => card.uuid)).toEqual(resolves ? ['draw'] : []);
    expect(player.graveyard.map(card => card.uuid)).toEqual(resolves ? [source.uuid] : []);
    expect(player.deck.map(card => card.uuid)).toEqual(resolves ? [] : ['draw', source.uuid]);
  },
}));

export default [{
  name: 'can be summoned for two red without triggering its reveal effect',
  covers: ['play'],
  run(engine, source) {
    castWithPayment(engine, source, { red: 2 });
    resolveByPassing(engine);
    expect(permanent(engine, source.uuid).state.summonKind).toBe('cast');
    expect(engine.roomState.stack).toEqual([]);
  },
} satisfies CardCase, ...reveals];
