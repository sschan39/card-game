import { describe, expect, it } from 'vitest';
import { GameEngine } from '@engine/game-engine';
import { DamageRuleRegistry, planDamage } from '@engine/damage-service';
import { captureSourceInformation } from '@engine/source-information';
import { gameReducer } from '@engine/game-reducer';
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
