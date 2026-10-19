import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { GameEngine } from '../../src/engine/game-engine';
import { gameConfig } from '../../src/config';
import { createTestRoom } from '../helpers/test-room-factory';
import { creature } from '../helpers/combat-fixture';
import { instantiateCard } from '../../src/library/card-factory';
import { matchesTargetFilter } from '../../src/shared/target-utils';

const engines: GameEngine[] = [];
afterEach(() => {
  engines.splice(0).forEach(engine => engine.dispose());
});
function fixture(enabled = true, power = 2, health = 3, keywords: string[] = []) {
  const target = creature('scorched-target', 'player2', power, health, keywords);
  const room = createTestRoom({ battlefield: [target], setup: { ...structuredClone(gameConfig.setup), scorch: enabled } });
  const engine = new GameEngine(room); engine.initRoom(); engines.push(engine); return { engine, target };
}
function add(engine: GameEngine, amount: number) {
  return engine.applyMutations([{ type: 'ADD_COUNTER', cardUuid: 'scorched-target', counterType: 'scorch', amount }]);
}
describe('continuous creature Scorch threshold', () => {
  it.each([4, 5, 7])('compares %s counters against current attack plus maximum health', amount => {
    const { engine, target } = fixture(); const before = structuredClone(engine.roomState);
    add(engine, amount);
    expect(engine.roomState.battlefield.some(card => card.uuid === target.uuid)).toBe(amount < 5);
    const dead = engine.roomState.players.player2.graveyard.find(card => card.uuid === target.uuid);
    if (amount >= 5) {
      expect(dead?.state.counters).toEqual({});
      expect(engine.drainEventBatches().flatMap(batch => batch.events).filter(event => event.eventId === 'PERMANENT_DIED')).toHaveLength(1);
    }
    expect(before.battlefield[0].state.counters).toEqual({});
  });

  it('does not substitute remaining health after marked damage', () => {
    const { engine } = fixture(true, 2, 5);
    engine.applyMutations([{ type: 'SET_DAMAGE', cardUuid: 'scorched-target', amount: 4 }]); add(engine, 3);
    expect(engine.roomState.battlefield).toHaveLength(1);
    expect(engine.roomState.battlefield[0].state.damageTaken).toBe(4);
  });

  it('destroys when a stat bonus expires without any new Scorch placement', () => {
    const { engine } = fixture();
    engine.applyMutations([{ type: 'ADD_CONTINUOUS_EFFECT', entry: { id: 'boost', source: 'rule-test', layer: 7,
      effect: { type: 'STAT_DELTA', power: 2 }, scope: { cardUuid: 'scorched-target', zoneRevision: 0 }, duration: 'PERMANENT', requiredZone: null } }]);
    add(engine, 5); expect(engine.roomState.battlefield).toHaveLength(1);
    engine.applyMutations([{ type: 'REMOVE_CONTINUOUS_EFFECT', id: 'boost' }]);
    expect(engine.roomState.players.player2.graveyard.map(card => card.uuid)).toContain('scorched-target');
  });

  it('uses current characteristic changes rather than printed stats or cost', () => {
    const { engine } = fixture(true, 3, 4); add(engine, 5);
    expect(engine.roomState.battlefield).toHaveLength(1);
    engine.applyMutations([{ type: 'ADD_CONTINUOUS_EFFECT', entry: { source: 'rule-test', layer: 7,
      effect: { type: 'STAT_DELTA', power: -2 }, scope: { cardUuid: 'scorched-target', zoneRevision: 0 }, duration: 'PERMANENT', requiredZone: null } }]);
    expect(engine.roomState.battlefield).toEqual([]);
  });

  it('does not enable custom Scorch destruction in a room without that rule', () => {
    const { engine } = fixture(false); add(engine, 9);
    expect(engine.roomState.battlefield).toHaveLength(1);
  });

  it('settles with indestructible instead of repeating a failed destruction forever', () => {
    const { engine } = fixture(true, 2, 3, ['Indestructible']); add(engine, 5);
    expect(engine.roomState.battlefield).toHaveLength(1);
    expect(engine.roomState.players.player2.graveyard).toEqual([]);
  });

  it('runs the normal destruction replacement pipeline', () => {
    const { engine } = fixture();
    engine.roomState.replacementEffects = [{ id: 'exile-instead', label: 'Exile instead', match: { kinds: ['destroy'] }, operation: { type: 'move_destination', to: 'exile' } }];
    add(engine, 5);
    expect(engine.roomState.battlefield).toEqual([]);
    expect(engine.roomState.players.player2.exile?.map(card => card.uuid)).toContain('scorched-target');
    expect(engine.drainEventBatches().flatMap(batch => batch.events).some(event => event.eventId === 'PERMANENT_DIED')).toBe(false);
  });

  it('resolves 阿基里斯爪牙 optional entry placement through the real card definition', () => {
    const { engine } = fixture(true, 1, 1);
    const minion = instantiateCard('achilles-minion');
    minion.state = { ...minion.state, zone: 'hand', ownerId: 'player1', controllerId: 'player1' };
    engine.roomState.players.player1.hand = [minion];
    expect(engine.executePlayerAction('player1', 'cast_spell', { cardUuid: minion.uuid }).success).toBe(true);
    expect(engine.resolveTopOfStack().success).toBe(true);
    let choice = engine.roomState.pendingChoice;
    if (choice && choice.kind !== 'number') {
      expect(engine.executePlayerAction(choice.playerId, 'choose', { choiceId: choice.id, choices: [choice.options.find(option => (option.value as { cardUuid?: string }).cardUuid === 'scorched-target')!.id] }).success).toBe(true);
    }
    expect(engine.resolveTopOfStack().success).toBe(true);
    choice = engine.roomState.pendingChoice;
    if (choice && choice.kind !== 'number') expect(engine.executePlayerAction(choice.playerId, 'choose', { choiceId: choice.id, choices: ['yes'] }).success).toBe(true);
    expect(engine.roomState.battlefield.find(card => card.uuid === 'scorched-target')?.state.counters.scorch).toBe(1);
    add(engine, 1);
    expect(engine.roomState.players.player2.graveyard.map(card => card.uuid)).toContain('scorched-target');
  });

  it('filters a target by its current named-counter total', () => {
    const { engine, target } = fixture(); target.state.counters.scorch = 1;
    expect(matchesTargetFilter(target, { type: 'permanent', required: true, counter: { type: 'scorch', max: 0 } }, 'player1', engine.roomState)).toBe(false);
  });

  it.each([false, true])('revalidates 點火狼 against Scorch placed after its target was selected (changed %s)', changed => {
    const { engine } = fixture(true, 2, 4);
    const wolf = instantiateCard('ignition-wolf');
    wolf.state = { ...wolf.state, zone: 'hand', ownerId: 'player1', controllerId: 'player1' };
    engine.roomState.players.player1.hand = [wolf];
    expect(engine.executePlayerAction('player1', 'cast_spell', { cardUuid: wolf.uuid }).success).toBe(true);
    expect(engine.resolveTopOfStack().success).toBe(true);
    const choice = engine.roomState.pendingChoice!;
    if (choice.kind === 'number') throw new Error('Expected target choice');
    expect(engine.executePlayerAction(choice.playerId, 'choose', { choiceId: choice.id, choices: [choice.options.find(option => (option.value as { cardUuid?: string }).cardUuid === 'scorched-target')!.id] }).success).toBe(true);
    if (changed) add(engine, 1);
    expect(engine.resolveTopOfStack().success).toBe(true);
    const optional = engine.roomState.pendingChoice;
    if (optional && optional.kind !== 'number') expect(engine.executePlayerAction(optional.playerId, 'choose', { choiceId: optional.id, choices: ['yes'] }).success).toBe(true);
    expect(engine.roomState.battlefield.find(card => card.uuid === 'scorched-target')?.state.counters.scorch).toBe(changed ? 1 : 3);
  });
});
