import { answerSingleRecipientCombat } from '../helpers/combat-fixture';
// tests/engine/combat-pipeline-smoke.test.ts
// Phase events and declaration events follow distinct committed operations.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { GameEngine } from '../../src/engine/game-engine';
import { createTestRoom } from '../helpers/test-room-factory';
import type { GameRoom } from '../../src/types/game.room.types';

describe('combat pipeline smoke test', () => {
  let room: GameRoom;
  let engine: GameEngine;

  beforeEach(() => {
    room = createTestRoom();
    engine = new GameEngine(room);
    engine.initRoom();
  });

  it('publishes combat events for actual declarations and damage', () => {
    const bus = (engine as any).eventBus;
    const emitSpy = vi.spyOn(bus, 'emit');

    const attacker = room.players.player1.hand[0];
    attacker.state = { ...attacker.state, zone: 'battlefield', summoningSickness: false };
    room.battlefield = [attacker];
    engine.advancePhase('complete'); engine.advancePhase('complete');
    expect(engine.executePlayerAction('player1', 'declare_attackers', { attackers: [{ cardUuid: attacker.uuid }] }).success).toBe(true);
    engine.passPriority('player1'); engine.passPriority('player2');
    expect(engine.executePlayerAction('player2', 'declare_blockers', { assignments: [] }).success).toBe(true);
    engine.passPriority('player1'); engine.passPriority('player2');
    expect(engine.phase).toBe('combatDamageStep');
    answerSingleRecipientCombat(engine);
    engine.passPriority('player1'); engine.passPriority('player2');
    expect(engine.phase).toBe('endCombatStep');
    // Dedicated events correspond to committed actions.

    const combatEvents = emitSpy.mock.calls
      .map((args) => args[0]?.eventId)
      .filter((id) => ['COMBAT_BEGIN', 'ATTACKERS_DECLARED', 'BLOCKERS_DECLARED', 'COMBAT_DAMAGE_RESOLVED', 'COMBAT_ENDED'].includes(id));
    expect(combatEvents).toEqual([
      'COMBAT_BEGIN',
      'ATTACKERS_DECLARED',
      'BLOCKERS_DECLARED',
      'COMBAT_DAMAGE_RESOLVED',
      'COMBAT_ENDED',
    ]);
  });

  it('stops for declarations and emits no declaration or damage events before confirmation', () => {
    const bus = (engine as any).eventBus;
    const emitSpy = vi.spyOn(bus, 'emit');

    engine.advancePhase('complete'); // → beginCombatStep
    engine.advancePhase('complete'); // → declareAttackersStep
    engine.advancePhase('complete'); // remains awaiting declaration
    engine.advancePhase('complete'); // remains awaiting declaration

    const attackers = emitSpy.mock.calls.find((args) => args[0]?.eventId === 'ATTACKERS_DECLARED');
    const blockers = emitSpy.mock.calls.find((args) => args[0]?.eventId === 'BLOCKERS_DECLARED');
    const damage = emitSpy.mock.calls.find((args) => args[0]?.eventId === 'COMBAT_DAMAGE_RESOLVED');
    expect(attackers).toBeUndefined();
    expect(blockers).toBeUndefined();
    expect(damage).toBeUndefined();
    expect(engine.phase).toBe('declareAttackersStep');
  });

  it('should clear combat declarations on entering endCombatStep', () => {
    // Seed a combat declaration so we can observe it being cleared.
    room.combat.push({
      uuid: 'combat-1',
      attacker: engine.roomState.battlefield[0] ?? engine.roomState.players['player1'].hand[0],
      attackerPower: 1,
      blockers: [],
    });
    expect(engine.roomState.combat.length).toBe(1);

    engine.advancePhase('complete'); // → beginCombatStep
    engine.advancePhase('complete'); // → declareAttackersStep
    engine.advancePhase('complete'); // remains awaiting declaration
    engine.advancePhase('complete'); // remains awaiting declaration

    // CLEAR_COMBAT is a mutation applied by the reducer, not an event.
    expect(engine.roomState.combat.length).toBe(0);
  });
});
