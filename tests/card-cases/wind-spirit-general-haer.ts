import { expect } from 'vitest';
import { act, castWithPayment, permanent, resolveByPassing, type CardCase } from '../helpers/card-test-cases';
import { freezeBoard, freezeOpponents, freezeThree } from '../helpers/wind-freeze-card-case';

export default [{
  name: 'freezes exactly three on entry and taps once per game to deal eight only to the opposing creatures',
  covers: ['play', 'ability:tap-three-on-entry', 'ability:deal-eight-to-enemies'],
  prepare(room) {
    room.battlefield = freezeBoard();
    room.battlefield.find(card => card.uuid === 'enemy-4')!.blueprint.toughness = 9;
  },
  run(engine, source) {
    castWithPayment(engine, source, { green: 5, red: 3 });
    resolveByPassing(engine);
    freezeThree(engine);
    const natural = { type: 'UNTAP_CARD', cardUuid: 'enemy-1', natural: true } as const;
    engine.applyMutations([natural]);
    expect(permanent(engine, 'enemy-1').state).toMatchObject({ isTapped: true, skipNextUntap: false });
    engine.applyMutations([natural]);
    expect(permanent(engine, 'enemy-1').state.isTapped).toBe(false);
    const sweep = { cardUuid: source.uuid, abilityId: 'deal-eight-to-enemies' };
    expect(engine.executePlayerAction('player1', 'activate_ability', sweep).success).toBe(false);
    engine.applyMutations([{ type: 'SET_SUMMONING_SICKNESS', cardUuid: source.uuid, value: false }]);
    act(engine, 'activate_ability', sweep);
    expect(permanent(engine, source.uuid).state.isTapped).toBe(true);
    resolveByPassing(engine);
    expect(engine.roomState.players.player2.graveyard.map(card => card.uuid).sort()).toEqual(freezeOpponents.slice(0, 3));
    expect(permanent(engine, 'enemy-4').state.damageTaken).toBe(8);
    expect(permanent(engine, 'ordinary').state.damageTaken).toBe(0);
    expect(engine.roomState.players.player2.life).toBe(20);
    engine.applyMutations([{ type: 'UNTAP_CARD', cardUuid: source.uuid }, { type: 'SET_TURN', playerId: 'player1', advance: true }]);
    expect(engine.executePlayerAction('player1', 'activate_ability', sweep).success).toBe(false);
  },
}] satisfies CardCase[];
