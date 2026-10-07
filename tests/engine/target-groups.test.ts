import { describe, expect, it } from 'vitest';
import { createTestRoom } from '../helpers/test-room-factory';
import { instantiateCard } from '../../src/library/card-factory';
import { GameEngine } from '../../src/engine/game-engine';
import { registerAction } from '../../src/engine/action-registry';
import { playCardHandler } from '../../src/engine/handlers/play-card-handler';
import { revalidateTargets } from '../../src/engine/effect-resolver';
import type { EffectDefinition } from '../../src/types/effect.types';
import { ModifierRegistry } from '../../src/engine/modifier-registry';
import { structuralTargetLegal } from '../../src/shared/target-legality';

function fixture() {
  const room = createTestRoom();
  const spell = room.players.player1.hand[0];
  spell.blueprint = { ...spell.blueprint, cardTypes: ['Spell'], castRequirements: { allowedZones: ['hand'], speed: 'instant', cost: {} }, onCastEffects: [
    { targetGroup: 'creature', action: 'SET_DAMAGE', params: { amount: 1 }, targeting: { type: 'permanent', cardTypes: ['Creature'], controller: 'opponent', required: true, maxTargets: 1 } },
    { targetGroup: 'player', action: 'MODIFY_LIFE', params: { amount: -2 }, targeting: { type: 'player', controller: 'opponent', required: true, maxTargets: 1 } },
  ] };
  const creature = instantiateCard('empire-servant');
  creature.blueprint = structuredClone(creature.blueprint);
  creature.state = { ...creature.state, zone: 'battlefield', ownerId: 'player2', controllerId: 'player2' };
  room.battlefield = [creature];
  registerAction('cast_spell', playCardHandler);
  const engine = new GameEngine(room); engine.initRoom();
  const groups = [{ id: 'creature', targets: [{ targetType: 'permanent', cardUuid: creature.uuid }] }, { id: 'player', targets: [{ targetType: 'player', playerId: 'player2' }] }];
  return { engine, spell, creature, groups };
}

describe('target groups', () => {
  it('validates every group, locks references and maps them to the correct effects', () => {
    const { engine, spell, creature, groups } = fixture();
    expect(engine.executePlayerAction('player1', 'cast_spell', { cardUuid: spell.uuid, targetGroups: groups }).success).toBe(true);
    expect(engine.roomState.stack[0].targetGroups).toHaveLength(2);
    expect(engine.roomState.stack[0].effects[0].targets[0]).toMatchObject({ cardUuid: creature.uuid, zoneRevision: 0 });
    expect(engine.roomState.stack[0].effects[1].targets).toEqual(groups[1].targets); engine.dispose();
  });
  it('rejects missing, extra, duplicate and wrong-type groups without costs', () => {
    for (const kind of ['missing', 'extra', 'duplicate', 'wrong']) {
      const { engine, spell, groups } = fixture();
      const selected = kind === 'missing' ? groups.slice(0, 1) : kind === 'extra' ? [...groups, { id: 'extra', targets: [] }]
        : kind === 'duplicate' ? [groups[0], groups[0]] : [groups[0], { id: 'player', targets: groups[0].targets }];
      const before = structuredClone(engine.roomState);
      expect(engine.executePlayerAction('player1', 'cast_spell', { cardUuid: spell.uuid, targetGroups: selected }).success).toBe(false);
      expect(engine.roomState).toEqual(before); engine.dispose();
    }
  });
  it('rechecks changed control, type, derived power and targeting permissions', () => {
    for (const kind of ['control', 'type', 'power', 'permission']) {
      const { engine, spell, creature, groups } = fixture();
      spell.blueprint = { ...spell.blueprint, onCastEffects: [{ ...spell.blueprint.onCastEffects![0], targeting: { ...spell.blueprint.onCastEffects![0].targeting, power: { max: 2 } } }, spell.blueprint.onCastEffects![1]] };
      expect(engine.executePlayerAction('player1', 'cast_spell', { cardUuid: spell.uuid, targetGroups: groups }).success).toBe(true);
      const target = engine.roomState.battlefield[0];
      if (kind === 'control') target.state.controllerId = 'player1';
      if (kind === 'type') target.blueprint = { ...target.blueprint, cardTypes: ['Land'] };
      if (kind === 'power') target.state.counters['+1/+1'] = 3;
      if (kind === 'permission') target.blueprint = { ...target.blueprint, keywords: ['Hexproof'] };
      const stack = engine.roomState.stack[0];
      expect(revalidateTargets(engine.roomState, stack.effects[0], 'player1', stack.source).targets).toEqual([]); engine.dispose();
    }
  });
  it('keeps UUIDs while invalidating a target that leaves and returns', () => {
    const { engine, spell, creature, groups } = fixture();
    expect(engine.executePlayerAction('player1', 'cast_spell', { cardUuid: spell.uuid, targetGroups: groups }).success).toBe(true);
    engine.applyMutations([{ type: 'MOVE_CARD', cardUuid: creature.uuid, playerId: 'player2', from: 'battlefield', to: 'hand' },
      { type: 'MOVE_CARD', cardUuid: creature.uuid, playerId: 'player2', from: 'hand', to: 'battlefield' }]);
    expect(engine.roomState.battlefield[0].uuid).toBe(creature.uuid);
    const stack = engine.roomState.stack[0];
    expect(revalidateTargets(engine.roomState, stack.effects[0], 'player1', stack.source).targets).toEqual([]); engine.dispose();
  });
  it('shares a named targeting clause across effects and rejects duplicate targets in one group', () => {
    const { engine, spell, creature } = fixture();
    const effect = spell.blueprint.onCastEffects![0];
    spell.blueprint = { ...spell.blueprint, onCastEffects: [effect, { ...effect, action: 'TAP' }] };
    expect(engine.executePlayerAction('player1', 'cast_spell', { cardUuid: spell.uuid, targetGroups: [{ id: 'creature', targets: [{ targetType: 'permanent', cardUuid: creature.uuid }] }] }).success).toBe(true);
    expect(engine.roomState.stack[0].targetGroups).toHaveLength(1);
    expect(engine.roomState.stack[0].effects[0].targets).toEqual(engine.roomState.stack[0].effects[1].targets); engine.dispose();
    const second = fixture();
    const def: EffectDefinition = { ...second.spell.blueprint.onCastEffects![0], targeting: { type: 'permanent', required: true, maxTargets: 2 } };
    second.spell.blueprint = { ...second.spell.blueprint, onCastEffects: [def] };
    const pointer = { targetType: 'permanent', cardUuid: second.creature.uuid };
    expect(second.engine.executePlayerAction('player1', 'cast_spell', { cardUuid: second.spell.uuid, targets: [pointer, pointer] }).success).toBe(false); second.engine.dispose();
  });
  it('applies extension permissions at both announcement and revalidation', () => {
    const { engine, spell, groups } = fixture();
    let allowed = true;
    const dispose = ModifierRegistry.registerTargetRule(() => allowed);
    try {
      expect(engine.executePlayerAction('player1', 'cast_spell', { cardUuid: spell.uuid, targetGroups: groups }).success).toBe(true);
      allowed = false;
      const stack = engine.roomState.stack[0];
      expect(revalidateTargets(engine.roomState, stack.effects[0], 'player1', stack.source).targets).toEqual([]);
      const another = fixture();
      expect(another.engine.executePlayerAction('player1', 'cast_spell', { cardUuid: another.spell.uuid, targetGroups: another.groups }).success).toBe(false);
      another.engine.dispose();
    } finally { dispose(); engine.dispose(); }
  });
  it('cannot disguise duplicate targets using unrelated pointer fields', () => {
    const { engine, spell, creature } = fixture();
    spell.blueprint = { ...spell.blueprint, onCastEffects: [{ ...spell.blueprint.onCastEffects![0], targeting: { type: 'permanent', required: true, maxTargets: 2 } }] };
    const before = structuredClone(engine.roomState);
    expect(engine.executePlayerAction('player1', 'cast_spell', { cardUuid: spell.uuid, targets: [
      { targetType: 'permanent', cardUuid: creature.uuid, playerId: 'first' },
      { targetType: 'permanent', cardUuid: creature.uuid, playerId: 'second' },
    ] }).success).toBe(false);
    expect(engine.roomState).toEqual(before); engine.dispose();
  });
  it('distinguishes creature spells from other spells and abilities', () => {
    const { engine, spell, creature } = fixture();
    engine.roomState.stack = [{ uuid: 'other-spell', type: 'spell', source: spell, controllerId: 'player1', effects: [], countered: false },
      { uuid: 'creature-spell', type: 'spell', source: creature, controllerId: 'player2', effects: [], countered: false },
      { uuid: 'ability', type: 'triggered', source: creature, controllerId: 'player2', effects: [], countered: false }];
    const def = { type: 'spell' as const, cardTypes: ['Creature'], required: true };
    expect(structuralTargetLegal(engine.roomState, 'player1', { targetType: 'spell', stackUuid: 'other-spell' }, def)).toBe(false);
    expect(structuralTargetLegal(engine.roomState, 'player1', { targetType: 'spell', stackUuid: 'creature-spell' }, def)).toBe(true);
    expect(structuralTargetLegal(engine.roomState, 'player1', { targetType: 'spell', stackUuid: 'ability' }, def)).toBe(false); engine.dispose();
  });
});
