import { expect } from 'vitest';
import { act, resolveByPassing, type CardCase } from '../helpers/card-test-cases';

export default [{
  name: 'plays as a land, taps for yellow and creates one Angel per game after friendly healing',
  covers: ['play', 'ability:produce-yellow', 'ability:angel-on-heal'],
  requires: ['token-angel-1-1'],
  run(engine, source) {
    act(engine, 'play_land', { cardUuid: source.uuid, zoneRevision: source.state.zoneRevision ?? 0 });
    expect(engine.roomState.turnHistory?.landPlays.player1).toBe(1);
    act(engine, 'tapForMana', { cardUuid: source.uuid, abilityId: 'produce-yellow' });
    expect(engine.roomState.players.player1.mana.yellow).toBe(6);
    expect(engine.roomState.battlefield.find(card => card.uuid === source.uuid)?.state.isTapped).toBe(true);
    engine.applyMutations([{ type: 'SET_LIFE', playerId: 'player2', amount: 21 }]);
    expect(engine.roomState.stack).toHaveLength(0);
    engine.applyMutations([{ type: 'SET_LIFE', playerId: 'player1', amount: 21 }]);
    resolveByPassing(engine);
    const tokens = () => engine.roomState.battlefield.filter(card => card.isToken);
    expect(tokens()).toHaveLength(1);
    expect(tokens()[0].blueprint).toMatchObject({ id: 'token-angel-1-1', power: 1, toughness: 1, abilities: [] });
    engine.applyMutations([
      { type: 'MOVE_CARD', cardUuid: source.uuid, playerId: 'player1', from: 'battlefield', to: 'hand' },
      { type: 'MOVE_CARD', cardUuid: source.uuid, playerId: 'player1', from: 'hand', to: 'battlefield' },
      { type: 'SET_LIFE', playerId: 'player1', amount: 22 },
    ]);
    expect(engine.roomState.stack).toHaveLength(0);
    expect(tokens()).toHaveLength(1);
  },
}] satisfies CardCase[];
