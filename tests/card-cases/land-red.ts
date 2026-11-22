import { expect } from 'vitest';
import { act, type CardCase } from '../helpers/card-test-cases';

export default [{
  name: 'uses the land play and taps for one red exactly once before untapping',
  covers: ['play', 'ability:produce-red'],
  run(engine, source) {
    act(engine, 'play_land', { cardUuid: source.uuid, zoneRevision: source.state.zoneRevision ?? 0 });
    expect(engine.roomState.battlefield.find(card => card.uuid === source.uuid)?.state.zone).toBe('battlefield');
    expect(engine.roomState.turnHistory?.landPlays.player1).toBe(1);
    act(engine, 'tapForMana', { cardUuid: source.uuid, abilityId: 'produce-red', manaColor: 'red' });
    expect(engine.roomState.players.player1.mana.red).toBe(6);
    expect(engine.roomState.battlefield.find(card => card.uuid === source.uuid)?.state.isTapped).toBe(true);
    expect(engine.executePlayerAction('player1', 'tapForMana', { cardUuid: source.uuid, abilityId: 'produce-red', manaColor: 'red' }).success).toBe(false);
    expect(engine.roomState.players.player1.mana.red).toBe(6);
  },
}] satisfies CardCase[];
