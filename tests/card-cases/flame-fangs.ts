import { expect } from 'vitest';
import { act, resolveByPassing, type CardCase } from '../helpers/card-test-cases';
import { creature } from '../helpers/combat-fixture';

export default [{
  name: 'rejects friendly land and creatures, then destroys opposing land before drawing',
  covers: ['play', 'cast effects'],
  prepare(room) {
    for (const id of ['player1', 'player2']) {
      const land = creature(id + '-land', id);
      land.blueprint = { ...land.blueprint, cardTypes: ['Land'] };
      room.battlefield.push(land);
    }
    room.battlefield.push(creature('enemy-creature', 'player2'));
    const draw = creature('draw-top', 'player1');
    draw.state.zone = 'library';
    room.players.player1.deck.push(draw);
  },
  run(engine, source) {
    const castAt = (cardUuid: string) => ({ cardUuid: source.uuid, targets: [{ targetType: 'permanent', cardUuid }] });
    for (const target of ['player1-land', 'enemy-creature']) {
      expect(engine.executePlayerAction('player1', 'cast_spell', castAt(target)).success).toBe(false);
    }
    expect(engine.roomState.players.player1.mana.red).toBe(5);
    act(engine, 'cast_spell', castAt('player2-land'));
    expect(engine.roomState.players.player1.mana.red).toBe(3);
    resolveByPassing(engine);
    expect(engine.roomState.players.player2.graveyard.map(card => card.uuid)).toEqual(['player2-land']);
    expect(engine.roomState.players.player1.hand.map(card => card.uuid)).toEqual(['draw-top']);
    const events = engine.drainEventBatches().flatMap(batch => batch.events);
    expect(events.filter(event => event.eventId === 'STACK_ITEM_RESOLVED').map(event => event.payload.effectId))
      .toEqual(['DESTROY', 'DRAW']);
  },
}] satisfies CardCase[];
