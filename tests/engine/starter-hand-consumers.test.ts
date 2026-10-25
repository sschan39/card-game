import { afterEach, describe, expect, it } from 'vitest';
import { GameEngine } from '@engine/game-engine';
import { instantiateCard } from '@library/card-factory';
import { creature } from '../helpers/combat-fixture';
import { createTestRoom, fillTestLibraries } from '../helpers/test-room-factory';
import type { CardInstance } from '@shared/card.types';

const engines: GameEngine[] = [];
afterEach(() => { engines.splice(0).forEach(engine => engine.dispose()); });
function fixture() {
  const room = createTestRoom(); fillTestLibraries(room); room.players.player1.hand = [];
  const engine = new GameEngine(room); engine.initRoom(); engines.push(engine); return engine;
}
function hand(engine: GameEngine, id: string, ownerId = 'player1') {
  const card = instantiateCard(id); card.state = { ...card.state, zone: 'hand', ownerId, controllerId: ownerId };
  engine.roomState.players[ownerId].hand.push(card); return card;
}
function chooseTarget(engine: GameEngine, card: CardInstance) {
  const choice = engine.roomState.pendingChoice!;
  if (!choice || choice.kind !== 'targets') throw new Error('Expected target choice');
  const option = choice.options.find(option => (option.value as { cardUuid?: string }).cardUuid === card.uuid)!;
  expect(option).toBeTruthy();
  expect(engine.executePlayerAction(choice.playerId, 'choose', { choiceId: choice.id, choices: [option.id] }).success).toBe(true);
}
function effectSummon(engine: GameEngine, id = 'empire-servant', ownerId = 'player2') {
  const card = hand(engine, id, ownerId);
  engine.applyMutations([{ type: 'MOVE_CARD', cardUuid: card.uuid, playerId: ownerId, from: 'hand', to: 'battlefield' }]);
  return engine.roomState.battlefield.find(entry => entry.uuid === card.uuid)!;
}
function cast(engine: GameEngine, card: CardInstance) {
  const room = engine.roomState; room.activeTurnPlayerId = card.state.controllerId; room.priorityPlayerId = card.state.controllerId;
  expect(engine.executePlayerAction(card.state.controllerId, 'cast_spell', { cardUuid: card.uuid }).success).toBe(true);
  if (engine.roomState.stack.length) expect(engine.resolveTopOfStack().success).toBe(true);
}

describe('starter hand and artifact consumers', () => {
  it('discards Wise wolf once before its ordinary hand ability and retains the original source', () => {
    const engine = fixture(), wolf = hand(engine, 'wise-ignition-wolf');
    const target = creature('enemy', 'player2', 4, 4); engine.roomState.battlefield.push(target);
    expect(engine.executePlayerAction('player1', 'activate_ability', { cardUuid: wolf.uuid, abilityId: 'discard-scorch' }).success).toBe(true);
    expect(engine.roomState.players.player1.hand).toHaveLength(1);
    chooseTarget(engine, target);
    expect(engine.roomState.players.player1.hand).toHaveLength(0);
    expect(engine.roomState.players.player1.graveyard.map(card => card.uuid)).toEqual([wolf.uuid]);
    expect(engine.roomState.stack[0].sourceInfo?.card.state.zone).toBe('hand');
    expect(engine.resolveTopOfStack().success).toBe(true);
    expect(engine.roomState.battlefield.find(card => card.uuid === target.uuid)?.state.counters.scorch).toBe(2);
    const events = engine.drainEventBatches().flatMap(batch => batch.events);
    expect(events.filter(event => event.eventId === 'CARD_DISCARDED_FROM_HAND')).toHaveLength(1);
    const counter = events.find(event => event.eventId === 'COUNTER_CHANGED');
    expect(counter?.eventId === 'COUNTER_CHANGED' && counter.payload.sourceInfo?.card.uuid).toBe(wolf.uuid);
  });

  it('uses another battlefield Wise wolf to protect the hand ability', () => {
    const engine = fixture(); effectSummon(engine, 'wise-ignition-wolf', 'player1');
    const wolf = hand(engine, 'wise-ignition-wolf'), target = effectSummon(engine, 'flame-ballista');
    expect(engine.executePlayerAction('player1', 'activate_ability', { cardUuid: wolf.uuid, abilityId: 'discard-scorch' }).success).toBe(true);
    chooseTarget(engine, target);
    expect(engine.roomState.stack).toEqual([]);
    expect(engine.roomState.players.player1.graveyard.map(card => card.uuid)).toEqual([wolf.uuid]);
    expect(engine.roomState.battlefield.find(card => card.uuid === target.uuid)?.state.counters.scorch).toBe(2);
  });

  it('pays Ballista red mana and tap once immediately after entry, and admits only opposing creature or artifact targets', () => {
    const engine = fixture(), ballista = hand(engine, 'flame-ballista'); cast(engine, ballista);
    const target = effectSummon(engine, 'flame-ballista'); effectSummon(engine, 'land-red'); effectSummon(engine, 'empire-servant', 'player1');
    expect(engine.roomState.battlefield.find(card => card.uuid === ballista.uuid)?.state.summoningSickness).toBe(true);
    engine.roomState.activeTurnPlayerId = 'player2'; engine.roomState.priorityPlayerId = 'player1';
    expect(engine.executePlayerAction('player1', 'activate_ability', { cardUuid: ballista.uuid, abilityId: 'tap-scorch' }).success).toBe(true);
    const choice = engine.roomState.pendingChoice!;
    if (choice.kind !== 'targets') throw new Error('Expected targets');
    expect(choice.options.map(option => (option.value as { cardUuid: string }).cardUuid)).toEqual([target.uuid]);
    chooseTarget(engine, target);
    expect(engine.roomState.players.player1.mana.red).toBe(3);
    expect(engine.roomState.battlefield.find(card => card.uuid === ballista.uuid)?.state.isTapped).toBe(true);
    expect(engine.roomState.stack).toHaveLength(1);
    expect(engine.resolveTopOfStack().success).toBe(true);
    expect(engine.roomState.battlefield.find(card => card.uuid === target.uuid)?.state.counters.scorch).toBe(1);
    expect(engine.roomState.players.player1.mana.red).toBe(3);
  });

  it('distinguishes ordinary casts, immediate casts, and effect summons, resetting provenance on departure', () => {
    const engine = fixture(), ordinary = hand(engine, 'empire-servant'); cast(engine, ordinary);
    expect(engine.roomState.battlefield.find(card => card.uuid === ordinary.uuid)?.state.summonKind).toBe('cast');
    const special = effectSummon(engine);
    expect(special.state.summonKind).toBe('effect');
    const protector = creature('protector', 'player1', 3, 3, ['ImmediateFriendlyCreatures']); engine.roomState.battlefield.push(protector);
    const immediate = hand(engine, 'empire-servant'); cast(engine, immediate);
    expect(engine.roomState.battlefield.find(card => card.uuid === immediate.uuid)?.state.summonKind).toBe('cast');
    engine.applyMutations([{ type: 'MOVE_CARD', cardUuid: special.uuid, playerId: 'player2', from: 'battlefield', to: 'hand' }]);
    const returned = engine.roomState.players.player2.hand.find(card => card.uuid === special.uuid)!;
    expect(returned.state.summonKind).toBeUndefined(); cast(engine, returned);
    expect(engine.roomState.battlefield.find(card => card.uuid === special.uuid)?.state.summonKind).toBe('cast');
  });

  it('offers Mercenary only opposing effect-summoned creatures and then destroys and draws', () => {
    const engine = fixture(), normal = hand(engine, 'empire-servant', 'player2'); cast(engine, normal);
    const target = effectSummon(engine); effectSummon(engine, 'flame-ballista'); effectSummon(engine, 'empire-servant', 'player1');
    const mercenary = hand(engine, 'flame-mercenary'); engine.roomState.priorityPlayerId = 'player1';
    expect(engine.executePlayerAction('player1', 'activate_ability', { cardUuid: mercenary.uuid, abilityId: 'discard-destroy' }).success).toBe(true);
    const choice = engine.roomState.pendingChoice!;
    if (choice.kind !== 'targets') throw new Error('Expected targets');
    expect(choice.options.map(option => (option.value as { cardUuid: string }).cardUuid)).toEqual([target.uuid]);
    chooseTarget(engine, target);
    expect(engine.resolveTopOfStack().success).toBe(true);
    expect(engine.roomState.players.player2.graveyard.map(card => card.uuid)).toContain(target.uuid);
    expect(engine.roomState.players.player1.graveyard.map(card => card.uuid)).toEqual([mercenary.uuid]);
    expect(engine.roomState.players.player1.hand).toHaveLength(1);
  });

  it('draws after a legal Mercenary target survives destruction', () => {
    const engine = fixture(), target = effectSummon(engine);
    target.blueprint = { ...target.blueprint, keywords: ['Indestructible'] };
    const mercenary = hand(engine, 'flame-mercenary');
    expect(engine.executePlayerAction('player1', 'activate_ability', { cardUuid: mercenary.uuid, abilityId: 'discard-destroy' }).success).toBe(true);
    chooseTarget(engine, target); expect(engine.resolveTopOfStack().success).toBe(true);
    expect(engine.roomState.battlefield.some(card => card.uuid === target.uuid)).toBe(true);
    expect(engine.roomState.players.player1.hand).toHaveLength(1);
  });

  it('fizzles the whole Mercenary ability when its target leaves and returns as a normal cast', () => {
    const engine = fixture(), target = effectSummon(engine), mercenary = hand(engine, 'flame-mercenary');
    expect(engine.executePlayerAction('player1', 'activate_ability', { cardUuid: mercenary.uuid, abilityId: 'discard-destroy' }).success).toBe(true);
    chooseTarget(engine, target);
    engine.applyMutations([{ type: 'MOVE_CARD', cardUuid: target.uuid, playerId: 'player2', from: 'battlefield', to: 'hand' }]);
    const returning = engine.roomState.players.player2.hand.find(card => card.uuid === target.uuid)!;
    // A spell resolving above the ability changes both the entry fact and zone identity.
    engine.applyMutations([{ type: 'MOVE_CARD', cardUuid: returning.uuid, playerId: 'player2', from: 'hand', to: 'stack', reason: 'cast',
      stackObject: { uuid: 'recast', type: 'spell', controllerId: 'player2', source: returning, effects: [], countered: false } }]);
    expect(engine.resolveTopOfStack().success).toBe(true);
    expect(engine.roomState.battlefield.find(card => card.uuid === target.uuid)?.state.summonKind).toBe('cast');
    expect(engine.resolveTopOfStack().success).toBe(true);
    expect(engine.roomState.players.player1.hand).toEqual([]);
    expect(engine.roomState.battlefield.some(card => card.uuid === target.uuid)).toBe(true);
  });
});
