import { expect } from 'vitest';
import { parseCardDefinition } from '@library/card-parser';
import { act, castWithPayment, fixtureCard, resolveByPassing, type CardCase } from '../helpers/card-test-cases';

export default [false, true].map(returned => ({
  name: `counters an opposing spell and exiles only the active incarnation (${returned ? 'Laila returns' : 'normal'})`,
  covers: ['play', 'ability:counter-and-exile'],
  prepare(room) {
    const spell = fixtureCard('opposing-spell', 'player2', 'hand', parseCardDefinition({
      schemaVersion: 1, id: 'opposing-spell', cardTypes: ['Spell'], onCastEffects: [{
        family: 'resources', operation: 'adjust_life', params: { amount: 3 },
      }],
    }));
    room.players.player2.hand.push(spell);
  },
  run(engine, source) {
    castWithPayment(engine, source, { yellow: 1, blue: 1 });
    resolveByPassing(engine);
    engine.roomState.activeTurnPlayerId = 'player2';
    engine.roomState.priorityPlayerId = 'player2';
    act(engine, 'cast_spell', { cardUuid: 'opposing-spell' }, 'player2');
    const pending = engine.roomState.stack[0].uuid;
    act(engine, 'pass_priority', {}, 'player2');
    act(engine, 'activate_ability', { cardUuid: source.uuid, abilityId: 'counter-and-exile',
      targets: [{ targetType: 'spell', stackUuid: pending }] });
    if (returned) engine.applyMutations([
      { type: 'MOVE_CARD', cardUuid: source.uuid, playerId: 'player1', from: 'battlefield', to: 'graveyard' },
      { type: 'MOVE_CARD', cardUuid: source.uuid, playerId: 'player1', from: 'graveyard', to: 'battlefield' },
    ]);
    resolveByPassing(engine);
    expect(engine.roomState.stack).toHaveLength(0);
    expect(engine.roomState.players.player2.life).toBe(20);
    expect(engine.roomState.players.player2.graveyard.map(card => card.uuid)).toEqual(['opposing-spell']);
    expect(engine.roomState.battlefield.some(card => card.uuid === source.uuid)).toBe(returned);
    expect(engine.roomState.players.player1.exile?.map(card => card.uuid) ?? []).toEqual(returned ? [] : [source.uuid]);
  },
}) satisfies CardCase);
