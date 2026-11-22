import { expect } from 'vitest';
import { CardCharacteristicService as stats } from '@engine/card-characteristic-service';
import { instantiateCard } from '@library/card-factory';
import { castWithPayment, choose, fixtureCard, passPriorityPair, permanent, type CardCase } from '../helpers/card-test-cases';

const candidates = ['phantom-puppet', 'phantom-puppet-legionnaire', 'phantom-giant'];

export default (['friendly main', 'friendly combat', 'opponent main'] as const).map(timing => ({
  name: `reanimates a friendly Puppet within the printed mana limit during ${timing}`,
  requires: candidates,
  covers: ['play', 'cast effects'],
  prepare(room) {
    room.phase = timing === 'friendly combat' ? 'beginCombatStep' : 'stateMainPhase';
    room.activeTurnPlayerId = timing === 'opponent main' ? 'player2' : 'player1';
    room.battlefield = Array.from({ length: 5 }, (_, i) => fixtureCard(`ally-${i}`, 'player1', 'battlefield', { colors: ['black'] }));
    room.players.player1.graveyard = candidates.map(id => {
      const card = instantiateCard(id);
      card.state = { ...card.state, ownerId: 'player1', controllerId: 'player1', zone: 'graveyard' };
      return card;
    });
  },
  run(engine, source) {
    const [low, medium, giant] = engine.roomState.players.player1.graveyard;
    expect(stats.resolveManaValue(engine.roomState, giant)).toBe(timing === 'friendly combat' ? 0 : 4);
    castWithPayment(engine, source, { black: 4 });
    passPriorityPair(engine);
    const choice = engine.roomState.pendingChoice;
    if (choice?.kind !== 'search') throw new Error('Expected a printed-cost Puppet choice');
    const main = timing === 'friendly main';
    expect(choice.options.map(option => option.id)).toEqual(main ? [low.uuid, medium.uuid] : [low.uuid]);
    const selected = main ? medium.uuid : low.uuid;
    choose(engine, [selected]);
    expect(permanent(engine, selected).state.summonKind).toBe('effect');
    expect(engine.roomState.players.player1.graveyard.map(card => card.uuid)).toContain(giant.uuid);
  },
}) satisfies CardCase);
