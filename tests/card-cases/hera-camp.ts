import { expect } from 'vitest';
import { planDamage } from '@engine/damage-service';
import { captureSourceInformation } from '@engine/source-information';
import { act, castWithPayment, fixtureCard, permanent, resolveByPassing, type CardCase } from '../helpers/card-test-cases';

const triggerIds = ['opposing-life-loss', 'opposing-creature-damage', 'opposing-creature-life-decrease'] as const;

export default triggerIds.map(first => ({
  name: `shares one automatic draw per turn across three trigger conditions, with a separate tap draw (first: ${first})`,
  covers: ['play', `ability:${first}`, 'ability:tap-to-draw'],
  prepare(room) {
    room.battlefield = [fixtureCard('target', 'player2', 'battlefield', { toughness: 8 })];
    room.players.player1.deck = ['third', 'second', 'first'].map(id => fixtureCard(id, 'player1', 'library'));
  },
  run(engine, source) {
    castWithPayment(engine, source, { black: 1 });
    resolveByPassing(engine);
    const lifeLoss = (amount: number) => engine.applyMutations([{ type: 'SET_LIFE', playerId: 'player2', amount }]);
    const changes = {
      'opposing-life-loss': () => lifeLoss(19),
      'opposing-creature-damage': () => engine.applyMutations(planDamage(engine.roomState, [{
        source: captureSourceInformation(engine.roomState, permanent(engine, source.uuid)),
        recipient: { kind: 'permanent', cardUuid: 'target', zoneRevision: 0 },
        amount: 1, combat: false,
      }])),
      'opposing-creature-life-decrease': () => engine.applyMutations([{
        type: 'ADD_CONTINUOUS_EFFECT', entry: {
          source: 'fixture', layer: 7, scope: { cardUuid: 'target' }, requiredZone: null, duration: 'PERMANENT',
          effect: { type: 'STAT_DELTA', toughness: -1 },
        },
      }]),
    };
    changes[first]();
    expect(engine.roomState.stack.at(-1)?.ability?.id).toBe(first);
    for (const other of triggerIds.filter(id => id !== first)) changes[other]();
    expect(engine.roomState.stack).toHaveLength(1);
    resolveByPassing(engine);
    const hand = () => engine.roomState.players.player1.hand.map(card => card.uuid);
    expect(hand()).toEqual(['first']);
    const tap = { cardUuid: source.uuid, abilityId: 'tap-to-draw' };
    act(engine, 'activate_ability', tap);
    expect(permanent(engine, source.uuid).state.isTapped).toBe(true);
    resolveByPassing(engine);
    expect(hand()).toEqual(['first', 'second']);
    expect(engine.executePlayerAction('player1', 'activate_ability', tap).success).toBe(false);
    engine.applyMutations([{ type: 'SET_TURN', playerId: 'player1', advance: true }]);
    lifeLoss(18);
    resolveByPassing(engine);
    expect(hand()).toEqual(['first', 'second', 'third']);
  },
}) satisfies CardCase);
