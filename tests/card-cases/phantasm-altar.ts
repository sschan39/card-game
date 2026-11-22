import { expect } from 'vitest';
import { act, choose, fixtureCard, passPriorityPair, type CardCase } from '../helpers/card-test-cases';

export default [true, false].map(accept => ({
  name: `enters tapped after paying two black and recovers only an eligible card it mills (${accept ? 'accept' : 'decline'})`,
  covers: ['play', 'ability:altar-entry', 'ability:produce-black'],
  prepare(room) {
    room.players.player1.hand.push(fixtureCard('regular-land', 'player1', 'hand', { cardTypes: ['Land'] }));
    room.players.player1.deck = [fixtureCard('recent', 'player1', 'library', { colors: ['black'], cardTypes: ['Artifact'] })];
    room.players.player1.graveyard = [fixtureCard('older', 'player1', 'graveyard', { colors: ['black'], cardTypes: ['Artifact'] })];
    room.players.player1.mana.black = 2;
  },
  run(engine, source) {
    act(engine, 'play_land', { cardUuid: 'regular-land', zoneRevision: 0 });
    engine.drainEventBatches();
    act(engine, 'play_land', { cardUuid: source.uuid, zoneRevision: source.state.zoneRevision ?? 0 });
    expect(engine.roomState.players.player1.mana.black).toBe(0);
    expect(engine.roomState.turnHistory?.landPlays.player1).toBe(1);
    const altar = () => engine.roomState.battlefield.find(card => card.uuid === source.uuid);
    expect(altar()?.state.isTapped).toBe(true);
    const events = engine.drainEventBatches().flatMap(batch => batch.events);
    expect(events.find(event => event.eventId === 'PERMANENT_ENTERED')?.payload.card.state.isTapped).toBe(true);
    expect(events.some(event => event.eventId === 'PERMANENT_TAPPED')).toBe(false);
    passPriorityPair(engine);
    choose(engine, [accept ? 'yes' : 'no']);
    if (accept) {
      const choice = engine.roomState.pendingChoice;
      if (choice?.kind !== 'search') throw new Error('Expected the recovery selection');
      expect(choice.options.map(option => option.id)).toEqual(['recent']);
      choose(engine, ['recent']);
    }
    expect(engine.roomState.players.player1.hand.map(card => card.uuid)).toEqual(accept ? ['recent'] : []);
    expect(engine.roomState.players.player1.graveyard.map(card => card.uuid)).toEqual(['older']);
    const mana = { cardUuid: source.uuid, abilityId: 'produce-black' };
    expect(engine.executePlayerAction('player1', 'tapForMana', mana).success).toBe(false);
    engine.applyMutations([{ type: 'UNTAP_CARD', cardUuid: source.uuid }]);
    act(engine, 'tapForMana', mana);
    expect(engine.roomState.players.player1.mana.black).toBe(1);
  },
}) satisfies CardCase);
