import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { GameEngine } from '../../src/engine/game-engine';
import { instantiateCard } from '../../src/library/card-factory';
import { ActionRegistry, registerAction } from '../../src/engine/action-registry';
import { playCardHandler } from '../../src/engine/handlers/play-card-handler';
import { declareAttackersHandler } from '../../src/engine/handlers/declare-attackers-handler';
import { createTestRoom, fillTestLibraries } from '../helpers/test-room-factory';
import { creature } from '../helpers/combat-fixture';
import type { CardInstance } from '../../src/types/card.types';
import { structuralTargetLegal } from '../../src/shared/target-legality';
const engines: GameEngine[] = [];
let registry: typeof ActionRegistry;
beforeEach(() => { registry = { ...ActionRegistry }; registerAction('cast_spell', playCardHandler); registerAction('declare_attackers', declareAttackersHandler); });
afterEach(() => { engines.splice(0).forEach(e => e.dispose()); Object.keys(ActionRegistry).forEach(k => delete ActionRegistry[k]); Object.assign(ActionRegistry, registry); });
function game(id: string, zone: 'hand' | 'battlefield' = 'hand') {
  const room = createTestRoom(); fillTestLibraries(room); room.players.player1.hand = [];
  const source = instantiateCard(id); source.state = { ...source.state, zone, controllerId: 'player1', ownerId: 'player1', summoningSickness: false };
  const enemy = creature('enemy', 'player2', 2, 8), other = creature('other', 'player2', 2, 6);
  room.battlefield = [enemy, other, ...(zone === 'battlefield' ? [source] : [])];
  if (zone === 'hand') room.players.player1.hand = [source];
  const engine = new GameEngine(room); engine.initRoom(); engines.push(engine); return { engine, source, enemy, other };
}
function choose(engine: GameEngine, target: CardInstance) {
  const c = engine.roomState.pendingChoice!; expect(c?.playerId).toBe('player1');
  if (c.kind === 'number') throw Error('Expected listed targets');
  const option = c.options.find(o => JSON.stringify(o).includes(target.uuid)); expect(option).toBeTruthy();
  expect(engine.executePlayerAction('player1', 'choose', { choiceId: c.id, choices: [option!.id] }).success).toBe(true);
}
function cast(engine: GameEngine, source: CardInstance) {
  expect(engine.executePlayerAction('player1', 'cast_spell', { cardUuid: source.uuid }).success).toBe(true); engine.resolveTopOfStack();
}
function attack(engine: GameEngine, source: CardInstance) {
  engine.roomState.phase = 'declareAttackersStep'; engine.roomState.priorityPlayerId = null;
  expect(engine.executePlayerAction('player1', 'declare_attackers', { attackers: [{ cardUuid: source.uuid }] }).success).toBe(true);
}
describe('Chiron destruction and blood temple', () => {
  it.each(['entry', 'attack', 'destroy', 'lethal damage'] as const)('Chiron places mandatory Scorch2 on %s', event => {
    const { engine, source, enemy } = game('chiron', event === 'entry' ? 'hand' : 'battlefield');
    if (event === 'entry') cast(engine, source);
    else if (event === 'attack') attack(engine, source);
    else if (event === 'lethal damage') engine.applyMutations([{ type: 'SET_DAMAGE', cardUuid: source.uuid, amount: 3 }]);
    else engine.applyMutations([{ type: 'DESTROY_CARD', cardUuid: source.uuid, zoneRevision: source.state.zoneRevision ?? 0 }]);
    choose(engine, enemy); expect(engine.roomState.stack).toHaveLength(1); engine.resolveTopOfStack();
    expect(engine.roomState.battlefield.find(c => c.uuid === enemy.uuid)?.state.counters.scorch).toBe(2);
    if (event === 'destroy' || event === 'lethal damage') {
      expect(engine.roomState.players.player1.graveyard.some(c => c.uuid === source.uuid)).toBe(true);
      expect(engine.drainEventBatches().flatMap(b => b.events).filter(e => e.eventId === 'PERMANENT_DESTROYED')).toHaveLength(1);
    }
  });
  it.each(['sacrifice', 'move', 'exile-replacement', 'cancel-replacement'] as const)('does not trigger destruction on %s', mode => {
    const { engine, source } = game('chiron', 'battlefield');
    if (mode === 'exile-replacement' || mode === 'cancel-replacement') engine.roomState.replacementEffects = [{ id: 'replace', label: 'Replace destruction', match: { kinds: ['destroy'] }, operation: mode === 'exile-replacement' ? { type: 'move_destination', to: 'exile' } : { type: 'cancel_event' } }];
    engine.applyMutations(mode === 'move' ? [{ type: 'MOVE_CARD', cardUuid: source.uuid, playerId: 'player1', from: 'battlefield', to: 'graveyard' }] : [{ type: mode === 'sacrifice' ? 'SACRIFICE_CARD' : 'DESTROY_CARD', cardUuid: source.uuid }]);
    expect(engine.roomState.stack).toHaveLength(0); expect(engine.roomState.pendingChoice).toBeFalsy();
    expect(engine.drainEventBatches().flatMap(b => b.events).filter(e => e.eventId === 'PERMANENT_DESTROYED')).toEqual([]);
  });
  it('discovers Chiron destruction from the before-state when Scorch destroys it', () => {
    const { engine, source, enemy } = game('chiron', 'battlefield');
    engine.roomState.setup = { ...engine.roomState.setup!, scorch: true };
    engine.applyMutations([{ type: 'ADD_COUNTER', cardUuid: source.uuid, counterType: 'scorch', amount: 7 }]);
    choose(engine, enemy);
    const trigger = engine.roomState.stack[0];
    expect(trigger.triggeringEvent?.eventId).toBe('PERMANENT_DESTROYED');
    expect(trigger.sourceInfo?.card.state.zone).toBe('battlefield');
    engine.resolveTopOfStack();
    expect(engine.roomState.battlefield.find(c => c.uuid === enemy.uuid)?.state.counters.scorch).toBe(2);
  });
  it('does not report or trigger a prevented indestructible destruction', () => {
    const { engine, source } = game('chiron', 'battlefield');
    source.blueprint = { ...source.blueprint, keywords: ['Indestructible'] };
    engine.applyMutations([{ type: 'DESTROY_CARD', cardUuid: source.uuid }]);
    expect(engine.roomState.battlefield.some(c => c.uuid === source.uuid)).toBe(true);
    expect(engine.roomState.pendingChoice).toBeFalsy();
    expect(engine.drainEventBatches().flatMap(b => b.events).filter(e => e.eventId === 'PERMANENT_DESTROYED')).toEqual([]);
  });
  it('Temple chooses the lowest current remaining health and permits its controller to choose a tie', () => {
    const { engine, source, enemy, other } = game('achilles-blood-temple');
    enemy.state.damageTaken = 5; other.state.damageTaken = 3; // 3 remaining each, different max health.
    const higher = creature('higher', 'player2', 1, 4), friendly = creature('friendly', 'player1', 1, 1);
    engine.roomState.battlefield.push(higher, friendly); cast(engine, source);
    const c = engine.roomState.pendingChoice!; if(c.kind === 'number') throw Error('Expected target choice');
    expect(c.options.some(o => JSON.stringify(o).includes(enemy.uuid))).toBe(true);
    expect(c.options.some(o => JSON.stringify(o).includes(other.uuid))).toBe(true);
    expect(c.options.some(o => JSON.stringify(o).includes(higher.uuid))).toBe(false);
    expect(c.options.some(o => JSON.stringify(o).includes(friendly.uuid))).toBe(false);
    choose(engine, other); engine.resolveTopOfStack();
    expect(engine.roomState.players.player2.graveyard.some(c => c.uuid === other.uuid)).toBe(true);
    expect(engine.roomState.battlefield.some(c => c.uuid === enemy.uuid)).toBe(true);
  });
  it('revalidates lowest remaining health against current resolved health at resolution', () => {
    const { engine, source, enemy, other } = game('achilles-blood-temple'); enemy.state.damageTaken = 5;
    cast(engine, source); choose(engine, enemy);
    engine.applyMutations([{ type: 'ADD_CONTINUOUS_EFFECT', entry: { source: 'global', layer: 7, duration: 'PERMANENT', requiredZone: null,
      effect: { type: 'STAT_DELTA', toughness: -5 }, scope: { cardUuid: other.uuid } } }]);
    engine.resolveTopOfStack();
    expect(engine.roomState.battlefield.some(c => c.uuid === enemy.uuid)).toBe(true);
    expect(engine.roomState.battlefield.some(c => c.uuid === other.uuid)).toBe(true);
  });
  it('Temple places mandatory Scorch3 when a friendly 炎獸 creature attacks', () => {
    const { engine, enemy } = game('achilles-blood-temple', 'battlefield');
    const wolf = instantiateCard('ignition-wolf'); wolf.state = { ...wolf.state, zone: 'battlefield', ownerId: 'player1', controllerId: 'player1', summoningSickness: false };
    engine.roomState.battlefield.push(wolf); attack(engine, wolf); choose(engine, enemy); engine.resolveTopOfStack();
    expect(engine.roomState.battlefield.find(c => c.uuid === enemy.uuid)?.state.counters.scorch).toBe(3);
  });
  it('allows an Artifact Scorch target without inventing an Artifact destruction threshold', () => {
    const { engine, source } = game('chiron', 'battlefield');
    const relic = instantiateCard('achilles-blood-temple'); relic.state = { ...relic.state, zone: 'battlefield', ownerId: 'player2', controllerId: 'player2' };
    engine.roomState.battlefield.push(relic); engine.roomState.setup = { ...engine.roomState.setup!, scorch: true };
    attack(engine, source); choose(engine, relic); engine.resolveTopOfStack();
    expect(engine.roomState.battlefield.find(c => c.uuid === relic.uuid)?.state.counters.scorch).toBe(2);
  });
  it('ignores attacks by a friendly creature without the 炎獸 subtype', () => {
    const { engine } = game('achilles-blood-temple', 'battlefield');
    const soldier = creature('soldier', 'player1', 2, 4); engine.roomState.battlefield.push(soldier);
    attack(engine, soldier); expect(engine.roomState.pendingChoice).toBeFalsy(); expect(engine.roomState.stack).toEqual([]);
  });
  it('shares the bounded remaining-health filter with structural target validation', () => {
    const { engine, enemy, other } = game('achilles-blood-temple', 'battlefield'); enemy.state.damageTaken = 5;
    const def = { type: 'permanent' as const, required: true, controller: 'opponent' as const, cardTypes: ['Creature'], extrema: { field: 'remainingHealth' as const, order: 'min' as const } };
    expect(structuralTargetLegal(engine.roomState, 'player1', { targetType: 'permanent', cardUuid: enemy.uuid }, def)).toBe(true);
    expect(structuralTargetLegal(engine.roomState, 'player1', { targetType: 'permanent', cardUuid: other.uuid }, def)).toBe(false);
  });
});
