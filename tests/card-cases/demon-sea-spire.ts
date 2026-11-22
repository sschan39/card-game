import { expect } from 'vitest';
import type { CardBlueprint } from '@shared/card.types';
import { actionPermission } from '../../packages/engine/src/shared/action-permissions';
import { act, castWithPayment, choose, fixtureCard, passPriorityPair, permanent, resolveByPassing, type CardCase } from '../helpers/card-test-cases';

export default [{
  name: 'locks small enemy spells only during friendly combat and deploys one friendly graveyard land per game',
  covers: ['play', 'ability:attack-cast-lock', 'ability:recover-land'],
  prepare(room) {
    const spell = (blue: number): Partial<CardBlueprint> => ({
      cardTypes: ['Spell'], castRequirements: { allowedZones: ['hand'], speed: 'instant', cost: { mana: { blue } } },
    });
    room.players.player2.hand = [
      fixtureCard('small', 'player2', 'hand', spell(3)),
      fixtureCard('big', 'player2', 'hand', spell(4)),
      fixtureCard('nonspell', 'player2', 'hand'),
    ];
    const land: Partial<CardBlueprint> = { cardTypes: ['Land'] };
    room.players.player1.graveyard = [
      fixtureCard('land-1', 'player1', 'graveyard', land),
      fixtureCard('land-2', 'player1', 'graveyard', land),
      fixtureCard('creature', 'player1', 'graveyard'),
    ];
    room.players.player2.graveyard = [fixtureCard('enemy-land', 'player2', 'graveyard', land)];
  },
  run(engine, source) {
    castWithPayment(engine, source, { blue: 2 });
    resolveByPassing(engine);
    const permission = () => engine.roomState.players.player2.hand
      .map(card => actionPermission(engine.roomState, 'player2', card, 'cast').allowed);
    expect(permission()).toEqual([true, true, true]);
    engine.roomState.phase = 'declareAttackersStep';
    expect(permission()).toEqual([false, true, true]);
    engine.roomState.activeTurnPlayerId = 'player2';
    expect(permission()).toEqual([true, true, true]);
    engine.roomState.phase = 'stateMainPhase';
    engine.roomState.priorityPlayerId = 'player1';
    const recover = { cardUuid: source.uuid, abilityId: 'recover-land' };
    act(engine, 'activate_ability', recover);
    passPriorityPair(engine);
    const choice = engine.roomState.pendingChoice;
    if (choice?.kind !== 'search') throw new Error('Expected a graveyard land choice');
    expect(choice.options.map(option => option.id)).toEqual(['land-1', 'land-2']);
    choose(engine, ['land-2']);
    expect(permanent(engine, 'land-2').state.ownerId).toBe('player1');
    engine.roomState.priorityPlayerId = 'player1';
    expect(engine.executePlayerAction('player1', 'activate_ability', recover).success).toBe(false);
    expect(engine.roomState.players.player1.graveyard.map(card => card.uuid)).toEqual(['land-1', 'creature']);
  },
}] satisfies CardCase[];
