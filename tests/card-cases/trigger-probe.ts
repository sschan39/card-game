import { expect } from 'vitest';
import type { GameEngine } from '@engine/game-engine';
import type { CardInstance } from '@shared/card.types';
import { act, castWithPayment, choose, declareAttack, fixtureCard, permanent, resolveByPassing, type CardCase } from '../helpers/card-test-cases';

function resolveTrigger(engine: GameEngine, id: string) {
  expect(engine.roomState.stack.at(-1)?.ability?.id).toBe(id);
  resolveByPassing(engine);
}

function summonProbe(engine: GameEngine, source: CardInstance) {
  castWithPayment(engine, source, { red: 1 });
  expect(engine.roomState.stack.map(item => item.type)).toEqual(['spell']);
  resolveByPassing(engine);
  expect(engine.roomState.players.player1.hand.map(card => card.uuid)).toContain('spell-draw');
  expect(engine.roomState.players.player1.life).toBe(21);
  resolveTrigger(engine, 'probe-entry');
  expect(engine.roomState.players.player1.life).toBe(22);
  expect(engine.roomState.stack).toEqual([]);
}

export default [{
  name: 'its spell draws and heals, entry heals again, and attacking targets the opponent for one life loss',
  covers: ['play', 'cast effects', 'ability:probe-entry', 'ability:probe-attack'],
  prepare(room) { room.players.player1.deck = [fixtureCard('spell-draw', 'player1', 'library')]; },
  run(engine, source) {
    summonProbe(engine, source);
    declareAttack(engine, source.uuid);
    const choice = engine.roomState.pendingChoice;
    if (choice?.kind !== 'targets') throw new Error('Expected the attack’s player target');
    expect(choice.options.map(option => (option.value as { playerId: string }).playerId)).toEqual(['player2']);
    choose(engine, [choice.options[0].id]);
    resolveTrigger(engine, 'probe-attack');
    expect(engine.roomState.players.player1.life).toBe(22);
    expect(engine.roomState.players.player2.life).toBe(19);
  },
}, {
  name: 'blocking with the Probe heals and its own death draws one without triggering its departed watcher',
  covers: ['ability:probe-block', 'ability:probe-death'],
  prepare(room) {
    room.battlefield = [fixtureCard('attacker', 'player2', 'battlefield')];
    room.players.player1.deck = ['death-draw', 'spell-draw'].map(id => fixtureCard(id, 'player1', 'library'));
  },
  run(engine, source) {
    summonProbe(engine, source);
    engine.roomState.activeTurnPlayerId = 'player2';
    declareAttack(engine, 'attacker', 'player2');
    engine.roomState.phase = 'declareBlockersStep';
    engine.roomState.priorityPlayerId = null;
    act(engine, 'declare_blockers', { assignments: [{ attackerUuid: 'attacker', blockerUuids: [source.uuid] }] });
    resolveTrigger(engine, 'probe-block');
    expect(engine.roomState.players.player1.life).toBe(23);
    engine.applyMutations([{ type: 'DESTROY_CARD', cardUuid: source.uuid, zoneRevision: permanent(engine, source.uuid).state.zoneRevision ?? 0 }]);
    resolveTrigger(engine, 'probe-death');
    expect(engine.roomState.players.player1.hand.map(card => card.uuid)).toEqual(['spell-draw', 'death-draw']);
    expect(engine.roomState.players.player1.graveyard.map(card => card.uuid)).toEqual([source.uuid]);
    expect(engine.roomState.stack).toEqual([]);
  },
}, {
  name: 'watches another friendly creature being cast, entering and dying, and can pay red to destroy that creature',
  covers: ['ability:probe-other-cast', 'ability:probe-other-entry', 'ability:probe-other-death', 'ability:probe-draw', 'ability:probe-destroy'],
  prepare(room) {
    room.players.player1.hand.push(fixtureCard('ally', 'player1', 'hand'));
    room.battlefield = [fixtureCard('relic', 'player2', 'battlefield', { cardTypes: ['Artifact'] })];
    room.players.player1.deck = ['death-draw', 'spell-draw'].map(id => fixtureCard(id, 'player1', 'library'));
  },
  run(engine, source) {
    summonProbe(engine, source);
    act(engine, 'cast_spell', { cardUuid: 'ally' });
    resolveTrigger(engine, 'probe-other-cast');
    expect(engine.roomState.players.player1.life).toBe(23);
    resolveByPassing(engine);
    resolveTrigger(engine, 'probe-other-entry');
    expect(engine.roomState.players.player1.life).toBe(24);
    const destroy = (cardUuid: string) => ({
      cardUuid: source.uuid, abilityId: 'probe-destroy', targets: [{ targetType: 'permanent', cardUuid }],
    });
    expect(engine.executePlayerAction('player1', 'activate_ability', destroy('relic')).success).toBe(false);
    expect(engine.roomState.players.player1.mana.red).toBe(4);
    act(engine, 'activate_ability', destroy('ally'));
    expect(engine.roomState.players.player1.mana.red).toBe(3);
    resolveByPassing(engine);
    expect(engine.roomState.players.player1.graveyard.map(card => card.uuid)).toEqual(['ally']);
    resolveTrigger(engine, 'probe-other-death');
    expect(engine.roomState.players.player1.hand.map(card => card.uuid)).toEqual(['spell-draw', 'death-draw']);
    resolveTrigger(engine, 'probe-draw');
    expect(engine.roomState.players.player1.life).toBe(25);
    expect(engine.roomState.stack).toEqual([]);
  },
}] satisfies CardCase[];
