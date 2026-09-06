import { describe, it, expect, beforeEach } from 'vitest';
import { GameEngine } from '../../src/engine/game-engine';
import { createTestRoom } from '../helpers/test-room-factory';
import { registerAction } from '../../src/engine/action-registry';
import { attackHandler } from '../../src/engine/handlers/attack-handler';
import { instantiateCard } from '../../src/library/card-factory';
import type { GameRoom } from '../../src/types/game.room.types';

describe('Combat Integration — attack → SBA → death trigger', () => {
  let room: GameRoom;
  let engine: GameEngine;

  beforeEach(() => {
    room = createTestRoom();
    room.currentPhase = 'stateBattlePhase';
    registerAction('attack', attackHandler);

    // Attacker: Crimson Hellkite (5/5 Flying) on player1's battlefield
    const attacker = instantiateCard('card_09876_core_set');
    attacker.state.zone = 'battlefield';
    attacker.state.ownerId = 'player1';
    attacker.state.controllerId = 'player1';
    attacker.state.summoningSickness = false;
    room.battlefield.push(attacker);

    // Defender: empire-servant (1/1) on player2's battlefield with an ON_DIE trigger
    const defender = instantiateCard('empire-servant');
    defender.state.zone = 'battlefield';
    defender.state.ownerId = 'player2';
    defender.state.controllerId = 'player2';
    defender.state.summoningSickness = false;
    // Give defender an ON_DIE trigger that draws a card for its controller
    (defender.blueprint as any).abilities = [
      ...defender.blueprint.abilities,
      {
        type: 'triggered',
        triggerCondition: 'ON_DIE',
        effect: { effectId: 'DRAW', params: { amount: 1 } },
        castSpeed: 'instant',
      },
    ];
    room.battlefield.push(defender);

    engine = new GameEngine(room);
    engine.initRoom();
  });

  it('full combat flow: attack creature → both take damage → defender dies → death trigger fires', () => {
    const attacker = room.battlefield.find(c => c.state.controllerId === 'player1')!;
    const defender = room.battlefield.find(c => c.state.controllerId === 'player2')!;

    // Propose attack targeting the defender creature
    const result = engine.proposeAndStack('player1', 'attack', {
      cardUuid: attacker.uuid,
      targets: [{ targetType: 'permanent', cardUuid: defender.uuid }],
    });

    expect(result.success).toBe(true);

    // Attacker should be tapped and marked as attacked
    const roomAfterPropose = engine.roomState;
    const attackerAfter = roomAfterPropose.battlefield.find(c => c.uuid === attacker.uuid)!;
    expect(attackerAfter.state.isTapped).toBe(true);
    expect(attackerAfter.state.attackedThisTurn).toBe(true);

    // Stack should have the attack StackObject
    expect(roomAfterPropose.stack.length).toBe(1);

    // Resolve the stack (this applies damage effects, then SBA runs)
    const resolveResult = engine.resolveTopOfStack();
    expect(resolveResult.success).toBe(true);

    const roomAfterResolve = engine.roomState;

    // Defender should be in graveyard (destroyed by SBA: damageTaken 5 >= toughness 1)
    const defenderInGraveyard = roomAfterResolve.players['player2'].graveyard.find(
      c => c.uuid === defender.uuid
    );
    expect(defenderInGraveyard).toBeDefined();

    // Attacker should still be on battlefield with 1 damage (defender's counter-attack)
    const attackerOnBoard = roomAfterResolve.battlefield.find(c => c.uuid === attacker.uuid)!;
    expect(attackerOnBoard).toBeDefined();
    expect(attackerOnBoard.state.damageTaken).toBe(1); // defender's power

    // ON_DIE trigger should have fired — a triggered StackObject should be on the stack
    // (the death trigger pushes a new StackObject for the draw)
    expect(roomAfterResolve.stack.length).toBeGreaterThanOrEqual(1);
    const deathTrigger = roomAfterResolve.stack.find(
      s => s.type === 'triggered' && s.source.uuid === defender.uuid
    );
    expect(deathTrigger).toBeDefined();
  });

  it('attack the face: opponent player takes damage, no SBA destruction', () => {
    const attacker = room.battlefield.find(c => c.state.controllerId === 'player1')!;
    const initialLife = room.players['player2'].life;

    const result = engine.proposeAndStack('player1', 'attack', {
      cardUuid: attacker.uuid,
      // No targets = attack the face
    });

    expect(result.success).toBe(true);

    // Resolve
    const resolveResult = engine.resolveTopOfStack();
    expect(resolveResult.success).toBe(true);

    const roomAfter = engine.roomState;
    // Player2 should have taken 5 damage (attacker's power = 5 from Crimson Hellkite)
    expect(roomAfter.players['player2'].life).toBe(initialLife - 5);
  });

  it('mutual destruction: both creatures have lethal damage → both die', () => {
    // Use two empire-servants (both 1/1) for mutual destruction
    // Remove the existing creatures and add two 1/1s
    room.battlefield = [];
    engine = new GameEngine(room);
    engine.initRoom();

    const attacker = instantiateCard('empire-servant');
    attacker.state.zone = 'battlefield';
    attacker.state.ownerId = 'player1';
    attacker.state.controllerId = 'player1';
    attacker.state.summoningSickness = false;
    room.battlefield.push(attacker);

    const defender = instantiateCard('empire-servant');
    defender.state.zone = 'battlefield';
    defender.state.ownerId = 'player2';
    defender.state.controllerId = 'player2';
    defender.state.summoningSickness = false;
    room.battlefield.push(defender);

    engine = new GameEngine(room);
    engine.initRoom();

    const result = engine.proposeAndStack('player1', 'attack', {
      cardUuid: attacker.uuid,
      targets: [{ targetType: 'permanent', cardUuid: defender.uuid }],
    });
    expect(result.success).toBe(true);

    const resolveResult = engine.resolveTopOfStack();
    expect(resolveResult.success).toBe(true);

    const roomAfter = engine.roomState;

    // Both should be in graveyards
    const attackerInYard = roomAfter.players['player1'].graveyard.find(c => c.uuid === attacker.uuid);
    const defenderInYard = roomAfter.players['player2'].graveyard.find(c => c.uuid === defender.uuid);
    expect(attackerInYard).toBeDefined();
    expect(defenderInYard).toBeDefined();

    // Both should be off the battlefield
    expect(roomAfter.battlefield.find(c => c.uuid === attacker.uuid)).toBeUndefined();
    expect(roomAfter.battlefield.find(c => c.uuid === defender.uuid)).toBeUndefined();
  });
});