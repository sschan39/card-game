import { afterEach, describe, expect, it } from 'vitest';
import { GameEngine } from '@engine/game-engine';
import { instantiateCard } from '@library/card-factory';
import { creature } from '../helpers/combat-fixture';
import { createTestRoom, fillTestLibraries } from '../helpers/test-room-factory';
import { captureSourceInformation } from '@engine/source-information';

const engines: GameEngine[] = [];
afterEach(() => { engines.splice(0).forEach(engine => engine.dispose()); });
function fixture(protection = true) {
  const protector = creature('protector', 'player1', 3, 2, ['ImmediateFriendlyCreatures']);
  const room = createTestRoom({ battlefield: protection ? [protector] : [] });
  fillTestLibraries(room);
  const engine = new GameEngine(room); engine.initRoom(); engines.push(engine);
  return engine;
}
function inHand(engine: GameEngine, id: string) {
  const card = instantiateCard(id); card.state = { ...card.state, zone: 'hand', ownerId: 'player1', controllerId: 'player1' };
  engine.roomState.players.player1.hand = [card]; return card;
}
function answer(engine: GameEngine, select: (option: { id: string; value: unknown }) => boolean) {
  const choice = engine.roomState.pendingChoice!;
  expect(choice).toBeTruthy(); if (choice.kind === 'number') throw new Error('Expected listed choice');
  const option = choice.options.find(select)!; expect(option).toBeTruthy();
  expect(engine.executePlayerAction(choice.playerId, 'choose', { choiceId: choice.id, choices: [option.id] }).success).toBe(true);
}

describe('immediate creature actions', () => {
  it('casts a protected creature directly and records the actual cast without any stack event', () => {
    const engine = fixture(); const card = inHand(engine, 'empire-servant');
    expect(engine.executePlayerAction('player1', 'cast_spell', { cardUuid: card.uuid }).success).toBe(true);
    expect(engine.roomState.stack).toEqual([]);
    expect(engine.roomState.battlefield.some(entry => entry.uuid === card.uuid)).toBe(true);
    const batches = engine.drainEventBatches(), events = batches.flatMap(batch => batch.events);
    expect(events.filter(event => event.eventId === 'SPELL_CAST')).toHaveLength(1);
    expect(engine.roomState.turnHistory?.playerCounts.player1.SPELL_CAST).toBe(1);
    expect(events.some(event => event.eventId === 'STACK_UPDATED')).toBe(false);
    expect(batches.every(batch => batch.before.stack.length === 0 && batch.after.stack.length === 0)).toBe(true);
  });

  it('chooses targets and optional instructions on a protected entry trigger without a response window', () => {
    const engine = fixture(); const target = creature('enemy', 'player2', 5, 5); engine.roomState.battlefield.push(target);
    const card = inHand(engine, 'achilles-minion');
    expect(engine.executePlayerAction('player1', 'cast_spell', { cardUuid: card.uuid }).success).toBe(true);
    expect(engine.roomState.stack).toEqual([]);
    answer(engine, option => (option.value as { cardUuid?: string }).cardUuid === target.uuid);
    expect(engine.roomState.priorityPlayerId).toBeNull();
    expect(engine.roomState.stack).toEqual([]);
    answer(engine, option => option.id === 'yes');
    expect(engine.roomState.battlefield.find(entry => entry.uuid === target.uuid)?.state.counters.scorch).toBe(1);
    const events = engine.drainEventBatches().flatMap(batch => batch.events);
    expect(events.some(event => event.eventId === 'STACK_UPDATED')).toBe(false);
    expect(events.some(event => event.eventId === 'ACTION_RESOLVED')).toBe(true);
  });

  it('does not protect a wolf summoning itself from hand', () => {
    const engine = fixture(false); const wolf = inHand(engine, 'strong-ignition-wolf');
    expect(engine.executePlayerAction('player1', 'cast_spell', { cardUuid: wolf.uuid }).success).toBe(true);
    expect(engine.roomState.stack).toHaveLength(1);
    expect(engine.roomState.battlefield).toHaveLength(0);
  });

  it('resolves the real rebel attack target immediately', () => {
    const engine = fixture(false), rebel = inHand(engine, 'worlds-rebel');
    rebel.state.zone = 'battlefield'; engine.roomState.players.player1.hand = [];
    const land = instantiateCard('land-red'); land.state = { ...land.state, ownerId: 'player2', controllerId: 'player2', zone: 'battlefield' };
    engine.roomState.battlefield = [rebel, land];
    engine.applyMutations([{ type: 'DECLARE_ATTACKERS', declarations: [{ uuid: 'attack', attacker: rebel, attackerPower: 3, blockers: [] }] }]);
    answer(engine, option => (option.value as { cardUuid?: string }).cardUuid === land.uuid);
    expect(engine.roomState.stack).toEqual([]);
    expect(engine.roomState.players.player2.graveyard.some(card => card.uuid === land.uuid)).toBe(true);
  });

  it('keeps priority with the non-active player after a protected hand-discard ability and retains its source', () => {
    const engine = fixture(); engine.roomState.activeTurnPlayerId = 'player2';
    const source = creature('hand-source', 'player1', 2, 2);
    source.state.zone = 'hand';
    source.blueprint = { ...source.blueprint, abilities: [{ id: 'discard-draw', type: 'activated', allowedZones: ['hand'],
      castSpeed: 'instant', cost: { discardSelf: true }, effect: { action: 'DRAW', params: { amount: 1 }, targeting: { type: 'self', required: false } } }] };
    engine.roomState.players.player1.hand = [source];
    expect(engine.executePlayerAction('player1', 'activate_ability', { cardUuid: source.uuid, abilityId: 'discard-draw' }).success).toBe(true);
    expect(engine.roomState.stack).toEqual([]);
    expect(engine.roomState.players.player1.graveyard.map(card => card.uuid)).toContain(source.uuid);
    expect(engine.roomState.players.player1.hand).toHaveLength(1);
    expect(engine.roomState.priorityPlayerId).toBe('player1');
    const events = engine.drainEventBatches().flatMap(batch => batch.events);
    const resolved = events.find(event => event.eventId === 'ACTION_RESOLVED');
    expect(resolved?.eventId === 'ACTION_RESOLVED' && resolved.payload.stackObj.sourceInfo?.card.state.zone).toBe('hand');
    expect(events.some(event => event.eventId === 'STACK_UPDATED')).toBe(false);
  });

  it('draws once across real Strong wolves per friendly placement, regardless of counter amount or recipient', () => {
    const engine = fixture(false), room = engine.roomState;
    const wolves = [instantiateCard('strong-ignition-wolf'), instantiateCard('strong-ignition-wolf')];
    wolves.forEach(card => { card.state = { ...card.state, zone: 'battlefield', ownerId: 'player1', controllerId: 'player1' }; });
    const enemy = creature('enemy', 'player2', 5, 5);
    room.battlefield = [...wolves, enemy]; room.players.player1.hand = [];
    engine.applyMutations([{ type: 'ADD_COUNTER', cardUuid: enemy.uuid, counterType: 'scorch', amount: 3,
      sourceControllerId: 'player1', sourceInfo: captureSourceInformation(room, wolves[0]) }]);
    expect(engine.roomState.players.player1.hand).toHaveLength(1);
    expect(engine.roomState.stack).toEqual([]);
    expect(engine.roomState.pendingChoice).toBeFalsy();
    engine.applyMutations([{ type: 'ADD_COUNTER', cardUuid: wolves[0].uuid, counterType: 'scorch', amount: 1,
      sourceControllerId: 'player2', sourceInfo: captureSourceInformation(engine.roomState, enemy) }]);
    expect(engine.roomState.players.player1.hand).toHaveLength(1);
    engine.applyMutations([{ type: 'ADD_COUNTER', cardUuid: enemy.uuid, counterType: 'scorch', amount: 1,
      sourceControllerId: 'player1', sourceInfo: captureSourceInformation(engine.roomState, wolves[1]) }]);
    expect(engine.roomState.players.player1.hand).toHaveLength(2);
  });

  it('retains ordinary queued triggers while a protected trigger pauses and resumes after serialization', () => {
    let engine = fixture(); const room = engine.roomState;
    room.activeTurnPlayerId = 'player2';
    const observer = creature('observer', 'player1', 2, 2);
    observer.blueprint = { ...observer.blueprint, abilities: [{ id: 'draw', type: 'triggered', triggerCondition: 'ON_COUNTER_CHANGED', castSpeed: 'instant',
      trigger: { subject: 'any' }, effect: { action: 'DRAW', params: { amount: 1 }, choice: { kind: 'optional' }, targeting: { type: 'self', required: false } } }] };
    const ordinary = creature('ordinary', 'player1', 2, 2);
    ordinary.blueprint = { ...ordinary.blueprint, cardTypes: ['Artifact'], abilities: [{ id: 'gain', type: 'triggered', triggerCondition: 'ON_COUNTER_CHANGED', castSpeed: 'instant',
      trigger: { subject: 'any' }, effect: { action: 'MODIFY_LIFE', params: { amount: 1 }, targeting: { type: 'self', required: false } } }] };
    room.battlefield.push(observer, ordinary);
    engine.applyMutations([{ type: 'ADD_COUNTER', cardUuid: observer.uuid, counterType: 'scorch', amount: 1 }]);
    const order = engine.roomState.pendingChoice!;
    if (order.kind !== 'ordering') throw new Error('Expected trigger ordering');
    const immediateId = engine.roomState.triggerQueue!.entries.find(entry => entry.object.source.uuid === observer.uuid)!.object.uuid;
    expect(engine.executePlayerAction('player1', 'choose', { choiceId: order.id, choices: [immediateId, ...order.options.map(option => option.id).filter(id => id !== immediateId)] }).success).toBe(true);
    expect(engine.roomState.pendingChoice?.kind).toBe('optional');
    expect(engine.roomState.stack).toEqual([]);
    const restored = new GameEngine(JSON.parse(JSON.stringify(engine.roomState))); restored.initRoom(); engines.push(restored); engine = restored;
    answer(engine, option => option.id === 'yes');
    expect(engine.roomState.stack.map(object => object.source.uuid)).toEqual([ordinary.uuid]);
    expect(engine.roomState.players.player1.hand).toHaveLength(2);
    expect(engine.roomState.priorityPlayerId).toBe('player1');
    expect(engine.roomState.triggerQueue).toBeNull();
  });

  it('allows the ordinary blocker declaration against a protected creature', () => {
    const engine = fixture(); const room = engine.roomState;
    const attacker = room.battlefield[0], blocker = creature('blocker', 'player2', 4, 4);
    room.battlefield.push(blocker); room.phase = 'declareBlockersStep'; room.priorityPlayerId = null;
    room.combatDeclarations = { attackers: true, blockers: false };
    room.combat = [{ uuid: attacker.uuid, attacker, attackerPower: 3, blockers: [] }];
    expect(engine.executePlayerAction('player2', 'declare_blockers', { assignments: [{ attackerUuid: attacker.uuid, blockerUuids: [blocker.uuid] }] }).success).toBe(true);
    expect(engine.roomState.combat[0].blockers.map(card => card.uuid)).toEqual([blocker.uuid]);
    expect(engine.roomState.combat[0].blocked).toBe(true);
    expect(engine.roomState.phase).toBe('declareBlockersStep');
  });

  it('resumes a protected damage replacement and its following instruction without repeating payment', () => {
    const engine = fixture(), room = engine.roomState, source = room.battlefield[0];
    room.activeTurnPlayerId = 'player2';
    source.blueprint = { ...source.blueprint, abilities: [{ id: 'damage', type: 'activated', castSpeed: 'instant', cost: { mana: { red: 1 } }, effects: [
      { action: 'MODIFY_LIFE', params: { amount: -5 }, tags: ['damage'], targeting: { type: 'player', controller: 'opponent', required: true } },
      { action: 'MODIFY_LIFE', params: { amount: 1 }, targeting: { type: 'self', required: false } },
    ] }] };
    room.replacementEffects = [
      { id: 'double', label: 'Double damage', match: { kinds: ['damage'] }, operation: { type: 'damage_scale', factor: 2 } },
      { id: 'prevent', label: 'Prevent three', match: { kinds: ['damage'] }, operation: { type: 'prevent_damage', amount: 3 } },
    ];
    expect(engine.executePlayerAction('player1', 'activate_ability', { cardUuid: source.uuid, abilityId: 'damage' }).success).toBe(true);
    answer(engine, option => (option.value as { playerId?: string }).playerId === 'player2');
    expect(engine.roomState.pendingChoice?.continuation.type).toBe('replacement');
    expect(engine.roomState.players.player1.mana.red).toBe(4);
    expect(engine.roomState.stack).toEqual([]);
    expect(engine.roomState.players.player1.life).toBe(20);
    expect(engine.roomState.players.player2.life).toBe(20);
    answer(engine, option => option.id === 'prevent');
    expect(engine.roomState.players.player1.mana.red).toBe(4);
    expect(engine.roomState.players.player1.life).toBe(21);
    expect(engine.roomState.players.player2.life).toBe(16);
    expect(engine.roomState.priorityPlayerId).toBe('player1');
    const events = engine.drainEventBatches().flatMap(batch => batch.events);
    expect(events.filter(event => event.eventId === 'ACTION_RESOLVED')).toHaveLength(1);
    expect(events.some(event => event.eventId === 'STACK_UPDATED')).toBe(false);
  });
});
