import { expect } from 'vitest';
import { collectCards } from '@rules/card-query';
import { cardReference } from '@rules/card-identity';
import { buildPlayerView } from '@server/projection/view-builder';
import { act, choose, fixtureCard, passPriorityPair, permanent, type CardCase } from '../helpers/card-test-cases';

export default [true, false].map(release => ({
  name: `stores green cards publicly at friendly upkeep, produces mana up to its stored count, and offers release when destroyed (${release})`,
  covers: ['play', 'ability:store-at-upkeep', 'ability:produce-from-stored-cards', 'ability:release-on-destroy'],
  prepare(room) {
    room.players.player1.hand.push(
      fixtureCard('green-1', 'player1', 'hand', { colors: ['green'] }),
      fixtureCard('green-2', 'player1', 'hand', { colors: ['green'] }),
      fixtureCard('red', 'player1', 'hand', { colors: ['red'] }),
    );
  },
  run(engine, source) {
    act(engine, 'play_land', { cardUuid: source.uuid, zoneRevision: source.state.zoneRevision ?? 0 });
    const upkeep = (playerId: string) => engine.applyMutations([
      { type: 'SET_PHASE', phase: 'mainPhase' }, { type: 'SET_TURN', playerId, advance: true },
      { type: 'SET_PHASE', phase: 'upkeepStep' }, { type: 'SET_PRIORITY', playerId },
    ]);
    const mana = { cardUuid: source.uuid, abilityId: 'produce-from-stored-cards' };
    upkeep('player2');
    expect(engine.roomState.stack).toEqual([]);
    for (const selection of [undefined, 'green-1', 'green-2']) {
      upkeep('player1');
      passPriorityPair(engine);
      const choice = engine.roomState.pendingChoice;
      if (choice?.kind !== 'search') throw new Error('Expected the optional green hand choice');
      expect([choice.min, choice.max]).toEqual([0, 1]);
      expect(choice.options.map(option => option.id)).toEqual(selection === 'green-2' ? ['green-2'] : ['green-1', 'green-2']);
      choose(engine, selection ? [selection] : []);
      const green = engine.roomState.players.player1.mana.green;
      const actions = selection === 'green-2' ? 2 : selection ? 1 : 0;
      for (let i = 0; i < actions; i++) act(engine, 'tapForMana', mana);
      expect(engine.executePlayerAction('player1', 'tapForMana', mana).success).toBe(false);
      expect(engine.roomState.players.player1.mana.green).toBe(green + actions);
      expect(permanent(engine, source.uuid).state.isTapped).toBe(false);
    }
    const host = cardReference(permanent(engine, source.uuid));
    for (const viewer of ['player1', 'player2']) {
      expect(buildPlayerView(engine.roomState, viewer).hostedCards?.find(group => group.hostUuid === source.uuid)?.cards.map(card => card.uuid))
        .toEqual(['green-1', 'green-2']);
    }
    engine.applyMutations([{ type: 'DESTROY_CARD', ...host }]);
    expect(collectCards(engine.roomState, { host }).map(card => card.uuid)).toEqual(['green-1', 'green-2']);
    passPriorityPair(engine);
    choose(engine, [release ? 'yes' : 'no']);
    expect(engine.roomState.players.player1.hand.map(card => card.uuid)).toEqual(release ? ['red', 'green-1', 'green-2'] : ['red']);
    expect(collectCards(engine.roomState, { host }).map(card => card.uuid)).toEqual(release ? [] : ['green-1', 'green-2']);
  },
}) satisfies CardCase);
