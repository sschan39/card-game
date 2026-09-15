// tests/engine/combat-pipeline-smoke.test.ts
// Smoke test for the MTG combat phase pipeline: entering combat from
// stateMainPhase auto-advances through all five steps, emitting a dedicated
// event per step, then completes the turn.
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

  it('should auto-advance through all five combat steps and complete the turn', () => {
    const bus = (engine as any).eventBus;
    const emitSpy = vi.spyOn(bus, 'emit');

    // Replicate the server flow from stateMainPhase using the phase director.
    // Each advancePhase stops at the next phase that needs input.
    engine.advancePhase('complete'); // → beginCombatStep
    engine.advancePhase('complete'); // → declareAttackersStep
    engine.advancePhase('complete'); // → declareBlockersStep
    engine.advancePhase('complete'); // → combatDamageStep → ... → stateMainPhase (player2)

    // The turn completed and switched to player2.
    expect(engine.roomState.activeTurnPlayerId).toBe('player2');
    expect(engine.roomState.phase).toBe('stateMainPhase');

    // The five dedicated combat events fired in order.
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

  it('should emit empty payloads for the three stub events', () => {
    const bus = (engine as any).eventBus;
    const emitSpy = vi.spyOn(bus, 'emit');

    engine.advancePhase('complete'); // → beginCombatStep
    engine.advancePhase('complete'); // → declareAttackersStep
    engine.advancePhase('complete'); // → declareBlockersStep
    engine.advancePhase('complete'); // → combatDamageStep

    const attackers = emitSpy.mock.calls.find((args) => args[0]?.eventId === 'ATTACKERS_DECLARED');
    const blockers = emitSpy.mock.calls.find((args) => args[0]?.eventId === 'BLOCKERS_DECLARED');
    const damage = emitSpy.mock.calls.find((args) => args[0]?.eventId === 'COMBAT_DAMAGE_RESOLVED');
    expect(attackers![0].payload.attackerIds).toEqual([]);
    expect(blockers![0].payload.blockerAssignments).toEqual([]);
    expect(damage![0].payload.damageAssignments).toEqual([]);
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
    engine.advancePhase('complete'); // → declareBlockersStep
    engine.advancePhase('complete'); // → combatDamageStep → endCombatStep

    // CLEAR_COMBAT is a mutation applied by the reducer, not an event.
    expect(engine.roomState.combat.length).toBe(0);
  });
});