import { expect } from 'vitest';
import type { CardBlueprint } from '@shared/card.types';
import { act, fixtureCard, permanent, resolveByPassing, type CardCase } from '../helpers/card-test-cases';

export default [{
  name: 'makes blue, charges only from friendly Giants and enables blue payment on the exact borrowed card',
  covers: ['play', 'ability:produce-blue', 'ability:charge-giant-entry', 'ability:draw-opposing-card'],
  prepare(room) {
    const giant = { subTypes: ['蒼巨人'] };
    const borrowed: Partial<CardBlueprint> = { colors: ['red', 'green'], castRequirements: {
      allowedZones: ['hand'], cost: { mana: { red: 2, green: 1, generic: 1 } },
    } };
    room.players.player1.mana = { red: 0, green: 0, white: 0, black: 0, yellow: 0, blue: 3 };
    room.players.player1.hand.push(
      fixtureCard('ordinary', 'player1', 'hand'),
      fixtureCard('same-cost', 'player1', 'hand', borrowed),
      ...Array.from({ length: 4 }, (_, i) => fixtureCard(`giant-${i}`, 'player1', 'hand', giant)),
    );
    room.players.player2.hand = [fixtureCard('enemy-giant', 'player2', 'hand', giant)];
    room.players.player2.deck.push(fixtureCard('borrowed', 'player2', 'library', borrowed));
  },
  run(engine, source) {
    const loki = () => permanent(engine, source.uuid);
    const charges = () => loki().state.counters.charge ?? 0;
    act(engine, 'play_land', { cardUuid: source.uuid, zoneRevision: source.state.zoneRevision ?? 0 });
    act(engine, 'tapForMana', { cardUuid: source.uuid, abilityId: 'produce-blue' });
    expect(engine.roomState.players.player1.mana.blue).toBe(4);
    expect(loki().state.isTapped).toBe(true);
    expect(engine.roomState.stack).toEqual([]);
    engine.applyMutations([{ type: 'MOVE_CARD', playerId: 'player2', cardUuid: 'enemy-giant', from: 'hand', to: 'battlefield' }]);
    act(engine, 'cast_spell', { cardUuid: 'ordinary' });
    resolveByPassing(engine);
    expect(charges()).toBe(0);
    expect(engine.roomState.stack).toEqual([]);
    const draw = { cardUuid: source.uuid, abilityId: 'draw-opposing-card' };
    expect(engine.executePlayerAction('player1', 'activate_ability', draw).success).toBe(false);
    for (let i = 0; i < 4; i++) {
      act(engine, 'cast_spell', { cardUuid: `giant-${i}` });
      resolveByPassing(engine);
      resolveByPassing(engine);
      expect(charges()).toBe(i + 1);
    }
    act(engine, 'activate_ability', draw);
    expect(charges()).toBe(0);
    resolveByPassing(engine);
    expect(engine.roomState.players.player1.hand.map(card => card.uuid)).toEqual(['same-cost', 'borrowed']);
    expect(engine.executePlayerAction('player1', 'cast_spell', { cardUuid: 'same-cost', payment: { blue: 4 } }).success).toBe(false);
    act(engine, 'cast_spell', { cardUuid: 'borrowed', payment: { blue: 4 } });
    resolveByPassing(engine);
    expect(permanent(engine, 'borrowed').state).toMatchObject({ ownerId: 'player2', controllerId: 'player1' });
    expect(engine.roomState.players.player1.mana.blue).toBe(0);
  },
}] satisfies CardCase[];
