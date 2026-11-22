import { expect } from 'vitest';
import { act, choose, fixtureCard, passPriorityPair, permanent, type CardCase } from '../helpers/card-test-cases';
import { windRevealClaim } from '../helpers/wind-reveal-card-case';

const cast: CardCase[] = (['pay', 'decline', 'unaffordable'] as const).map(decision => ({
  name: `reveals three, offers paid deployment of a named Wind Beast, and orders the remainder (${decision})`,
  covers: ['play', 'cast effects'],
  prepare(room) {
    room.players.player1.mana = { green: decision === 'unaffordable' ? 3 : 4, red: 0, blue: 0, black: 0, white: 0, yellow: 0 };
    room.players.player1.deck = [
      fixtureCard('deep', 'player1', 'library', { name: '風靈獸 deep' }),
      fixtureCard('land', 'player1', 'library', { name: '風靈獸 land', cardTypes: ['Land'] }),
      fixtureCard('other', 'player1', 'library', { name: '風靈 other' }),
      fixtureCard('beast', 'player1', 'library', { name: '風靈獸 beast' }),
    ];
  },
  run(engine, source) {
    act(engine, 'cast_spell', { cardUuid: source.uuid, payment: { green: 3 } });
    expect(engine.roomState.players.player1.mana.green).toBe(decision === 'unaffordable' ? 0 : 1);
    passPriorityPair(engine);
    if (decision !== 'unaffordable') choose(engine, [decision === 'pay' ? 'yes' : 'no']);
    if (decision === 'pay') {
      const choice = engine.roomState.pendingChoice;
      if (choice?.kind !== 'search') throw new Error('Expected a deployment choice');
      expect(choice.options.map(option => option.id)).toEqual(['beast']);
      choose(engine, ['beast']);
      expect(permanent(engine, 'beast').state.summonKind).toBe('effect');
    }
    expect(engine.roomState.players.player1.mana.green).toBe(decision === 'decline' ? 1 : 0);
    const rest = decision === 'pay' ? ['land', 'other'] : ['land', 'beast', 'other'];
    choose(engine, rest);
    expect(engine.roomState.players.player1.deck.map(card => card.uuid)).toEqual([...rest.toReversed(), 'deep']);
    expect(engine.roomState.players.player1.hand).toEqual([]);
  },
}));

export default [...cast, ...windRevealClaim()];
