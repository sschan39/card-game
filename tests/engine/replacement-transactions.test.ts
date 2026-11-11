import { describe, expect, it } from 'vitest';
import { GameEngine } from '@engine/game-engine';
import { DamageRuleRegistry, planDamage } from '@engine/damage-service';
import { captureSourceInformation } from '@engine/source-information';
import { gameReducer } from '@engine/game-reducer';
import { parseCardDefinition } from '@library/card-parser';
import { SyncService } from '@server/rooms/sync-service';
import { applyDeltaChanges } from '@client/store/deltaReducer';
import { creature } from '../helpers/combat-fixture';
import { createTestRoom } from '../helpers/test-room-factory';
import type { GameRoom } from '@shared/game.room.types';
import type { StackObject } from '@shared/effect.types';
import type { GameMutation } from '@shared/game-mutation.types';

function setup() {
  const room = createTestRoom({ battlefield: [creature('source', 'player1', 2, 30), creature('victim', 'player2', 2, 30)], replacementEffects: [
    { id: 'double', label: 'Double damage', match: { kinds: ['damage'] }, operation: { type: 'damage_scale', factor: 2 } },
    { id: 'prevent', label: 'Prevent three', match: { kinds: ['damage'] }, operation: { type: 'prevent_damage', amount: 3 } },
  ] });
  return { room, engine: new GameEngine(room) };
}
function damage(room: GameRoom): GameMutation[] {
  return planDamage(room, [{ source: captureSourceInformation(room, room.battlefield[0]), recipient: { kind: 'player', playerId: 'player2' }, amount: 5, combat: false }]);
}
function answer(engine: GameEngine, id: string) {
  const choice = engine.roomState.pendingChoice!;
  return engine.executePlayerAction(choice.playerId, 'choose', { choiceId: choice.id, choices: [id] });
}

describe('replacement transaction engine integration', () => {
  it('retains legacy sourced life-change damage attribution', () => {
    const { room, engine } = setup();
    engine.applyMutations([{ type: 'SET_REPLACEMENT_EFFECTS', effects: [] }, { type: 'SET_LIFE', playerId: 'player2', amount: 17, damageSource: 'source', combat: true, damageSourceInfo: captureSourceInformation(room, room.battlefield[0]) }]);
    const damage = engine.drainEventBatches().flatMap(b => b.events).filter(e => e.eventId === 'DAMAGE_DEALT');
    expect(damage.map(e => [e.payload.source, e.payload.combat, e.payload.amount])).toEqual([['source', true, 3]]);
    engine.dispose();
  });
  it('pauses an entire payment/stack transaction and resumes it after engine reconstruction', () => {
    const { room, engine } = setup();
    const stackObject: StackObject = { type: 'activated', uuid: 'ability', source: room.battlefield[0], controllerId: 'player1', effects: [], countered: false };
    engine.applyMutations([{ type: 'SPEND_MANA', playerId: 'player1', cost: { red: 2 } }, ...damage(room), { type: 'PUSH_STACK', stackObject }]);
    expect(engine.roomState.pendingChoice?.continuation.type).toBe('replacement');
    expect(engine.roomState.players.player1.mana.red).toBe(5);
    expect(engine.roomState.stack).toEqual([]);
    expect(engine.roomState.priorityPlayerId).toBeNull();
    expect(engine.executePlayerAction('player1', 'pass_priority').success).toBe(false);
    const restored = new GameEngine(JSON.parse(JSON.stringify(engine.roomState)));
    expect(answer(restored, 'prevent').success).toBe(true);
    expect(restored.roomState.players.player1.mana.red).toBe(3);
    expect(restored.roomState.players.player2.life).toBe(16);
    expect(restored.roomState.stack.map(s => s.uuid)).toEqual(['ability']);
    expect(restored.roomState.pendingChoice).toBeNull();
    expect(restored.roomState.priorityPlayerId).toBe('player1');
    engine.dispose(); restored.dispose();
  });

  it('does not publish damage or completion while a replacement decision is pending', () => {
    const { room, engine } = setup();
    engine.applyMutations(damage(room));
    expect(engine.drainEventBatches().flatMap(b => b.events).filter(e => e.eventId === 'DAMAGE_DEALT')).toEqual([]);
    expect(answer(engine, 'double').success).toBe(true);
    const events = engine.drainEventBatches().flatMap(b => b.events).filter(e => e.eventId === 'DAMAGE_DEALT');
    expect(events.map(e => e.payload.amount)).toEqual([7]);
    engine.dispose();
  });

  it('runs consequences on actual final damage before planning the next resolving instruction', () => {
    const stop = DamageRuleRegistry.register({ consequences: (_room, assignments) => assignments.map(a => ({ type: 'ADD_COUNTER', cardUuid: 'source', counterType: '+1/+1', amount: a.amount })) });
    try {
      const { room, engine } = setup();
      const stackObject: StackObject = { type: 'activated', uuid: 'resolution', source: room.battlefield[0], controllerId: 'player1', countered: false, effects: [
        { action: 'MODIFY_LIFE', params: { amount: -5 }, tags: ['damage'], targets: [{ targetType: 'player', playerId: 'player2' }], targeting: { type: 'self' } },
        { action: 'MODIFY_LIFE', params: { amount: 'DYNAMIC:source.power' }, tags: [], targets: [{ targetType: 'player', playerId: 'player1' }], targeting: { type: 'self' } },
      ] };
      engine.applyMutations([{ type: 'PUSH_STACK', stackObject }]);
      expect(engine.resolveTopOfStack().success).toBe(true);
      expect(engine.roomState.stack).toHaveLength(1);
      expect(engine.roomState.players.player1.life).toBe(20);
      expect(answer(engine, 'prevent').success).toBe(true);
      expect(engine.roomState.players.player2.life).toBe(16);
      expect(engine.roomState.battlefield[0].state.counters['+1/+1']).toBe(4);
      expect(engine.roomState.players.player1.life).toBe(26);
      expect(engine.roomState.stack).toEqual([]);
      expect(engine.drainEventBatches().flatMap(b => b.events).filter(e => e.eventId === 'STACK_ITEM_RESOLVED')).toHaveLength(2);
      engine.dispose();
    } finally { stop(); }
  });

  it('retains combat completion until the final damage batch is decided', () => {
    const { room, engine } = setup();
    engine.applyMutations([...damage(room), { type: 'SET_COMBAT_DAMAGE', state: { completed: true, passIndex: 0, passes: ['normal'], requests: [], allocations: {} } }, { type: 'SET_PENDING_CHOICE', choice: null }]);
    expect(engine.roomState.combatDamage).toBeUndefined();
    expect(engine.roomState.pendingChoice?.continuation.type).toBe('replacement');
    expect(answer(engine, 'double').success).toBe(true);
    expect(engine.roomState.combatDamage?.completed).toBe(true);
    expect(engine.drainEventBatches().flatMap(b => b.events).filter(e => e.eventId === 'COMBAT_DAMAGE_RESOLVED')).toHaveLength(1);
    engine.dispose();
  });

  it('round-trips paused and completed transactions through the existing delta reducer', () => {
    const { room, engine } = setup();
    const sync = new SyncService({} as ConstructorParameters<typeof SyncService>[0]);
    const paused = engine.applyMutations(damage(room));
    const client = applyDeltaChanges(room, sync.buildDelta(room, paused, { action: 'damage', playerId: 'player1' }).changes);
    expect(client).toEqual(engine.roomState);
    const result = answer(engine, 'prevent');
    expect(result.success).toBe(true);
    if (!result.success) throw new Error(result.reason);
    const completed = applyDeltaChanges(client, sync.buildDelta(client, result.mutations ?? [], { action: 'choose', playerId: 'player2' }).changes);
    expect(completed).toEqual(engine.roomState);
    expect((result.mutations ?? []).reduce(gameReducer, client)).toEqual(engine.roomState);
    engine.dispose();
  });
});

function setupPaidRescue() {
  const source = creature('rescue-relic', 'player1');
  const victim = creature('friendly-dragon', 'player1', 2, 4);
  const another = creature('second-dragon', 'player1', 2, 4);
  const enemy = creature('enemy', 'player2', 4, 4);
  for (const card of [victim, another]) card.blueprint.subTypes = ['冰龍'];
  source.blueprint = parseCardDefinition({
    schemaVersion: 1, id: 'rescue-relic', name: 'Rescue relic', cardTypes: ['Artifact'],
    abilities: [{
      id: 'last-chance', type: 'static', rules: [{
        id: 'rescue', family: 'event-replacements', events: ['destroy', 'zone_transfer'], optional: true,
        scope: { type: 'card', filter: { zones: ['battlefield'], controller: 'self', cardTypes: ['Creature'], subTypes: ['冰龍'] } },
        operation: { type: 'recover_marked_damage', amount: 3, destroySource: true },
      }],
    }],
  });
  const room = createTestRoom({ battlefield: [source, victim, another, enemy] });
  const engine = new GameEngine(room);
  const hit = (targets = [victim]) => engine.applyMutations(planDamage(engine.roomState, targets.map(card => ({
    source: captureSourceInformation(engine.roomState, enemy),
    recipient: { kind: 'permanent', cardUuid: card.uuid, zoneRevision: 0 },
    amount: 5, combat: false,
  }))));
  return { engine, source, victim, another, hit };
}

function rescueOption(engine: GameEngine, decline = false): string {
  const choice = engine.roomState.pendingChoice;
  if (choice?.kind !== 'options') throw new Error('Expected paid rescue choice');
  const option = choice.options.find(option => option.id.endsWith(':rescue') && option.id.startsWith('skip:') === decline);
  if (!option) throw new Error('Expected rescue option');
  return option.id;
}

describe('paid marked-damage recovery', () => {
  it.each([false, true])('settles the original death or pays and heals in one batch (decline: %s)', decline => {
    const { engine, source, victim, hit } = setupPaidRescue();
    try {
      hit();
      expect(engine.roomState.players.player1.graveyard).toEqual([]);
      expect(engine.roomState.battlefield.find(card => card.uuid === victim.uuid)?.state.damageTaken).toBe(5);
      engine.drainEventBatches();
      expect(answer(engine, rescueOption(engine, decline)).success).toBe(true);
      expect(engine.roomState.players.player1.graveyard.map(card => card.uuid)).toEqual([decline ? victim.uuid : source.uuid]);
      expect(engine.roomState.battlefield.find(card => card.uuid === victim.uuid)?.state.damageTaken).toBe(decline ? undefined : 1);
      const events = engine.drainEventBatches().flatMap(batch => batch.events);
      expect(events.filter(event => event.eventId === 'PERMANENT_DIED')).toHaveLength(decline ? 1 : 0);
      expect(engine.roomState.pendingChoice).toBeNull();
    } finally { engine.dispose(); }
  });

  it.each([false, true])('resumes a nested destruction decision after reconstruction (veto payment: %s)', veto => {
    const { engine, source, victim, hit } = setupPaidRescue();
    try {
      engine.applyMutations([{
        type: 'ADD_REPLACEMENT_EFFECT',
        effect: {
          id: 'preserve-source', label: 'Preserve the relic', optional: true,
          match: { kinds: ['destroy'], card: { cardUuid: source.uuid, zoneRevision: 0 } },
          operation: { type: 'cancel_event' },
        },
      }]);
      hit();
      expect(answer(engine, rescueOption(engine)).success).toBe(true);
      expect(engine.roomState.pendingChoice?.continuation.type).toBe('replacement');
      expect(engine.roomState.players.player1.graveyard).toEqual([]);
      expect(engine.roomState.battlefield.find(card => card.uuid === victim.uuid)?.state.damageTaken).toBe(5);
      const restored = new GameEngine(JSON.parse(JSON.stringify(engine.roomState)));
      try {
        expect(answer(restored, veto ? 'preserve-source' : 'skip:preserve-source').success).toBe(true);
        expect(restored.roomState.pendingChoice).toBeNull();
        expect(restored.roomState.players.player1.graveyard.map(card => card.uuid)).toEqual([veto ? victim.uuid : source.uuid]);
        expect(restored.roomState.battlefield.find(card => card.uuid === victim.uuid)?.state.damageTaken).toBe(veto ? undefined : 1);
      } finally { restored.dispose(); }
    } finally { engine.dispose(); }
  });

  it('continues the original departure when the required destruction is redirected', () => {
    const { engine, source, victim, hit } = setupPaidRescue();
    try {
      engine.applyMutations([{
        type: 'ADD_REPLACEMENT_EFFECT',
        effect: {
          id: 'redirect-payment', label: 'Move the relic to exile',
          match: { kinds: ['destroy'], card: { cardUuid: source.uuid, zoneRevision: 0 } },
          operation: { type: 'move_destination', to: 'exile' },
        },
      }]);
      hit();
      expect(answer(engine, rescueOption(engine)).success).toBe(true);
      expect(engine.roomState.pendingChoice).toBeNull();
      expect(engine.roomState.players.player1.graveyard.map(card => card.uuid)).toEqual([victim.uuid]);
      expect(engine.roomState.battlefield.map(card => card.uuid)).toContain(source.uuid);
      expect(engine.roomState.players.player1.exile ?? []).toEqual([]);
    } finally { engine.dispose(); }
  });

  it('cannot spend one relic twice during simultaneous lethal departures', () => {
    const { engine, source, victim, another, hit } = setupPaidRescue();
    try {
      hit([victim, another]);
      expect(answer(engine, rescueOption(engine)).success).toBe(true);
      expect(engine.roomState.pendingChoice).toBeNull();
      expect(engine.roomState.players.player1.graveyard.map(card => card.uuid)).toEqual([source.uuid, another.uuid]);
      expect(engine.roomState.battlefield.find(card => card.uuid === victim.uuid)?.state.damageTaken).toBe(1);
    } finally { engine.dispose(); }
  });

  it('does not offer marked-damage recovery for ordinary destruction or a max-life reduction to zero', () => {
    const { engine, source, victim, another } = setupPaidRescue();
    try {
      engine.applyMutations([
        { type: 'DESTROY_CARD', cardUuid: victim.uuid, zoneRevision: 0 },
        { type: 'ADD_CONTINUOUS_EFFECT', entry: {
          source: 'global', requiredZone: null, origin: 'resolved', layer: 7, duration: 'PERMANENT',
          effect: { type: 'SET_STATS', power: 2, toughness: 0 }, scope: { cardUuid: another.uuid },
        } },
      ]);
      expect(engine.roomState.pendingChoice).toBeFalsy();
      expect(engine.roomState.players.player1.graveyard.map(card => card.uuid)).toEqual([victim.uuid, another.uuid]);
      expect(engine.roomState.battlefield.map(card => card.uuid)).toContain(source.uuid);
    } finally { engine.dispose(); }
  });
});
