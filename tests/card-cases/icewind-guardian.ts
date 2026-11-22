import { expect } from 'vitest';
import { instantiateCard } from '@library/card-factory';
import { act, castWithPayment, choose, fixtureCard, passPriorityPair, permanent, resolveByPassing, type CardCase } from '../helpers/card-test-cases';

export default [true, false].map(leaves => ({
  name: `enters with Aurora and can take a hostile effect aimed at another friendly Ice Dragon (guardian leaves: ${leaves})`,
  covers: ['play', 'ability:entry-aurora', 'ability:guard-ice-dragon'],
  requires: ['fireball'],
  prepare(room) {
    room.battlefield = [fixtureCard('dragon', 'player1', 'battlefield', { subTypes: ['冰龍'], toughness: 8 })];
    const spell = instantiateCard('fireball');
    spell.state = { ...spell.state, zone: 'hand', ownerId: 'player2', controllerId: 'player2' };
    room.players.player2.hand = [spell];
  },
  run(engine, source) {
    castWithPayment(engine, source, { white: 3 });
    resolveByPassing(engine);
    resolveByPassing(engine);
    expect(permanent(engine, source.uuid).state.counters.aurora).toBe(1);
    engine.roomState.activeTurnPlayerId = 'player2';
    engine.roomState.priorityPlayerId = 'player2';
    act(engine, 'cast_spell', {
      cardUuid: engine.roomState.players.player2.hand[0].uuid, modes: ['main-scorch'],
      targets: [{ targetType: 'permanent', cardUuid: 'dragon' }],
    }, 'player2');
    expect(engine.roomState.stack.map(item => item.type)).toEqual(['spell', 'triggered']);
    if (leaves) {
      engine.applyMutations([{ type: 'MOVE_CARD', cardUuid: source.uuid, playerId: 'player1', from: 'battlefield', to: 'exile' }]);
      resolveByPassing(engine);
    } else {
      passPriorityPair(engine);
      choose(engine, ['yes']);
    }
    expect(engine.roomState.stack[0].targetGroups?.[0].targets[0].cardUuid).toBe(leaves ? 'dragon' : source.uuid);
    resolveByPassing(engine);
    expect(permanent(engine, 'dragon').state.counters.scorch ?? 0).toBe(leaves ? 2 : 0);
    if (!leaves) expect(permanent(engine, source.uuid).state.counters.scorch).toBe(2);
  },
}) satisfies CardCase);
