import { describe, expect, it } from 'vitest';
import { creature } from '../helpers/combat-fixture';
import { createTestRoom } from '../helpers/test-room-factory';
import { GameEngine } from '@engine/game-engine';
import { captureSourceInformation } from '@engine/source-information';
import { planDamage, DamageRuleRegistry } from '@engine/damage-service';
import type { DamageAssignment } from '@shared/damage.types';

describe('shared damage pipeline', () => {
  function setup() {
    const room = createTestRoom({ battlefield: [creature('a', 'player1', 2, 2), creature('b', 'player2', 3, 3)] });
    const engine = new GameEngine(room); engine.initRoom();
    const from = (index: number, amount: number, recipient: DamageAssignment['recipient'], combat = true): DamageAssignment =>
      ({ source: captureSourceInformation(room, room.battlefield[index]), amount, recipient, combat });
    return { room, engine, from };
  }

  it('accumulates damage from distinct sources and retains attribution', () => {
    const { room, engine, from } = setup();
    engine.applyMutations(planDamage(room, [from(0, 2, { kind: 'player', playerId: 'player2' }), from(1, 3, { kind: 'player', playerId: 'player2' })]));
    expect(engine.roomState.players.player2.life).toBe(15);
    const events = engine.drainEventBatches().flatMap(batch => batch.events).filter(event => event.eventId === 'DAMAGE_DEALT');
    expect(events.map(event => [event.payload.source, event.payload.amount, event.payload.controllerId])).toEqual([['a', 2, 'player1'], ['b', 3, 'player2']]);
  });

  it('commits all recipients together and publishes events with the complete damage board', () => {
    const { room, engine, from } = setup();
    engine.applyMutations(planDamage(room, [from(0, 3, { kind: 'permanent', cardUuid: 'b', zoneRevision: 0 }), from(1, 2, { kind: 'permanent', cardUuid: 'a', zoneRevision: 0 })]));
    expect(engine.roomState.battlefield).toEqual([]);
    expect(engine.roomState.players.player1.graveyard.map(c => c.uuid)).toEqual(['a']);
    expect(engine.roomState.players.player2.graveyard.map(c => c.uuid)).toEqual(['b']);
    const batch = engine.drainEventBatches().find(batch => batch.events.some(event => event.eventId === 'DAMAGE_DEALT'))!;
    expect(batch.after.battlefield.map(c => c.state.damageTaken)).toEqual([2, 3]);
    expect(batch.mutations.filter(m => m.type === 'APPLY_DAMAGE_BATCH')).toHaveLength(1);
  });

  it('does not heal or emit damage for zero/negative amounts or stale recipients', () => {
    const { room, engine, from } = setup();
    engine.applyMutations(planDamage(room, [from(0, -3, { kind: 'player', playerId: 'player2' }), from(0, 0, { kind: 'permanent', cardUuid: 'b', zoneRevision: 0 }), from(0, 1, { kind: 'permanent', cardUuid: 'b', zoneRevision: 2 })]));
    expect(engine.roomState.players.player2.life).toBe(20);
    expect(engine.roomState.battlefield[1].state.damageTaken).toBe(0);
    expect(engine.drainEventBatches().flatMap(batch => batch.events).filter(event => event.eventId === 'DAMAGE_DEALT')).toEqual([]);
  });

  it('offers shared proposal/consequence hooks without implementing keyword consumers', () => {
    const stop = DamageRuleRegistry.register({ modify: (_room, assignment) => ({ ...assignment, amount: assignment.amount - 1 }),
      consequences: (_room, assignments) => assignments.length ? [{ type: 'ADD_COUNTER', cardUuid: 'a', counterType: 'test', amount: assignments.length }] : [] });
    try {
      const { room, engine, from } = setup();
      engine.applyMutations(planDamage(room, [from(0, 2, { kind: 'player', playerId: 'player2' })]));
      expect(engine.roomState.players.player2.life).toBe(19);
      expect(engine.roomState.battlefield[0].state.counters.test).toBe(1);
    } finally { stop(); }
  });

  it('passes the fully damaged board to consequences and keeps life loss distinct from damage', () => {
    const seen: number[][] = [];
    const stop = DamageRuleRegistry.register({ consequences: (room) => { seen.push(room.battlefield.map(card => card.state.damageTaken)); return []; } });
    try {
      const { room, engine, from } = setup();
      engine.applyMutations(planDamage(room, [from(0, 1, { kind: 'permanent', cardUuid: 'b', zoneRevision: 0 }), from(1, 1, { kind: 'permanent', cardUuid: 'a', zoneRevision: 0 })]));
      expect(seen).toEqual([[1, 1]]);
      engine.drainEventBatches();
      engine.applyMutations([{ type: 'SET_LIFE', playerId: 'player2', amount: 17 }]);
      const events = engine.drainEventBatches().flatMap(batch => batch.events);
      expect(events.filter(event => event.eventId === 'LIFE_LOST')).toHaveLength(1);
      expect(events.filter(event => event.eventId === 'DAMAGE_DEALT')).toEqual([]);
    } finally { stop(); }
  });
});
