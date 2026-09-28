// tests/engine/game-engine.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { GameEngine } from '../../src/engine/game-engine';
import { ActionRegistry, registerAction } from '../../src/engine/action-registry';
import { playCardHandler } from '../../src/engine/handlers/play-card-handler';
import { tapForManaHandler } from '../../src/engine/handlers/tap-for-mana-handler';
import { declareAttackersHandler } from '../../src/engine/handlers/declare-attackers-handler';
import { createTestRoom } from '../helpers/test-room-factory';
import { instantiateCard } from '../../src/library/card-factory';
import type { GameRoom } from '../../src/types/game.room.types';

describe('GameEngine', () => {
  let room: GameRoom;
  let engine: GameEngine;

  beforeEach(() => {
    Object.keys(ActionRegistry).forEach(key => delete ActionRegistry[key]);
    registerAction('cast_spell', playCardHandler);

    room = createTestRoom();
    const card = room.players['player1'].hand[0];
    card.blueprint.castRequirements.cost = { mana: { red: 1 }, tap: false, life: 0, discard: 0, sacrifice: false };
    engine = new GameEngine(room);
  });

  describe('handleAction', () => {
    it('should validate and propose a valid action', () => {
      const card = room.players['player1'].hand[0];
      const result = engine.handleAction('player1', 'cast_spell', { cardUuid: card.uuid, stackUuid: engine.generateUuid() });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.stackObject).toBeDefined();
        // handleAction doesn't apply mutations — proposeAndStack does
        expect(result.mutations).toBeDefined();
      }
    });

    it('should reject an unregistered action type', () => {
      const card = room.players['player1'].hand[0];
      const result = engine.handleAction('player1', 'nonexistent_action', { cardUuid: card.uuid });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.reason).toContain('No handler registered');
      }
    });

    it('should reject when validation fails', () => {
      room.players['player1'].mana.red = 0;
      const card = room.players['player1'].hand[0];
      const result = engine.handleAction('player1', 'cast_spell', { cardUuid: card.uuid });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.phase).toBe('validate');
      }
    });
  });

  describe('proposeAndStack', () => {
    it('should propose action and push to stack', () => {
      const card = room.players['player1'].hand[0];
      const result = engine.proposeAndStack('player1', 'cast_spell', { cardUuid: card.uuid });

      expect(result.success).toBe(true);
      // proposeAndStack applies mutations internally, so engine.roomState.stack should be updated
      expect(engine.roomState.stack.length).toBe(1);
    });
  });

  describe('resolveTopOfStack', () => {
    it('should resolve the top stack object', () => {
      const card = room.players['player1'].hand[0];
      engine.proposeAndStack('player1', 'cast_spell', { cardUuid: card.uuid });

      const result = engine.resolveTopOfStack();
      expect(result.success).toBe(true);
      expect(engine.roomState.stack.length).toBe(0);
    });

    it('should fail when stack is empty', () => {
      const result = engine.resolveTopOfStack();
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.reason).toBe('Stack is empty');
      }
    });
  });

  describe('applyMutations — room reference contract', () => {
    // Regression (2026-09-15): applyMutations reassigns engine.room to a NEW
    // object (pure reducer). Server code that held a pre-mutation local
    // reference (e.g. `const room = getRoom(...)`) went stale and emitted a
    // snapshot missing the mutation — the client never saw status:'RPS'.
    // Contract: after any mutation, read engine.roomState, never the old ref.
    it('reassigns engine.room to a new object after mutations', () => {
      const before = engine.roomState;
      engine.applyMutations([{ type: 'SET_STATUS', status: 'RPS' }]);
      const after = engine.roomState;

      expect(after).not.toBe(before); // new object identity
      expect(after.status).toBe('RPS'); // mutation visible on the new ref
      expect(before.status).not.toBe('RPS'); // stale ref is unchanged
    });
  });
});

describe('GameEngine — event emission', () => {
  let room: GameRoom;
  let engine: GameEngine;

  beforeEach(() => {
    room = createTestRoom();
    engine = new GameEngine(room);
    engine.initRoom();
  });

  it('should emit PERMANENT_LEFT when a creature moves from battlefield to graveyard', () => {
    const bus = (engine as any).eventBus;
    const emitSpy = vi.spyOn(bus, 'emit');

    const creature = instantiateCard('empire-servant');
    creature.state.zone = 'battlefield';
    creature.state.ownerId = 'player1';
    creature.state.controllerId = 'player1';
    room.battlefield.push(creature);

    engine.applyMutations([{
      type: 'MOVE_CARD',
      cardUuid: creature.uuid,
      playerId: 'player1',
      from: 'battlefield',
      to: 'graveyard',
    }]);

    const leftCalls = emitSpy.mock.calls.filter(
      (args) => args[0]?.eventId === 'PERMANENT_LEFT'
    );
    expect(leftCalls.length).toBe(1);
    expect(leftCalls[0][0].payload.card.uuid).toBe(creature.uuid);
  });

  it('should NOT emit PERMANENT_LEFT for non-battlefield moves', () => {
    const bus = (engine as any).eventBus;
    const emitSpy = vi.spyOn(bus, 'emit');

    const card = instantiateCard('empire-servant');
    card.state.zone = 'hand';
    card.state.ownerId = 'player1';
    room.players['player1'].hand.push(card);

    engine.applyMutations([{
      type: 'MOVE_CARD',
      cardUuid: card.uuid,
      playerId: 'player1',
      from: 'hand',
      to: 'graveyard',
    }]);

    const leftCalls = emitSpy.mock.calls.filter(
      (args) => args[0]?.eventId === 'PERMANENT_LEFT'
    );
    expect(leftCalls.length).toBe(0);
  });

  it('should emit REMOVE_CONTINUOUS_EFFECT when a card with pool entries moves zones', () => {
    const creature = instantiateCard('empire-servant');
    creature.state.zone = 'battlefield';
    creature.state.ownerId = 'player1';
    creature.state.controllerId = 'player1';
    room.battlefield.push(creature);

    // Add a pool entry sourced from this creature
    room.continuousEffectPool.push({
      source: creature.uuid,
      layer: 7,
      effect: { type: 'STAT_DELTA', power: 1 },
      scope: { cardTypes: ['Creature'] },
      duration: 'WHILE_ON_BATTLEFIELD',
    });

    const mutations = engine.applyMutations([{
      type: 'MOVE_CARD',
      cardUuid: creature.uuid,
      playerId: 'player1',
      from: 'battlefield',
      to: 'graveyard',
    }]);

    // The REMOVE_CONTINUOUS_EFFECT mutation should be in the applied mutations
    const removeMutation = mutations.find(m => m.type === 'REMOVE_CONTINUOUS_EFFECT');
    expect(removeMutation).toBeDefined();
    if (removeMutation?.type === 'REMOVE_CONTINUOUS_EFFECT') {
      expect(removeMutation.source).toBe(creature.uuid);
    }

    // Pool should be empty after apply
    expect(engine.roomState.continuousEffectPool).toHaveLength(0);
  });

  it('should NOT emit REMOVE_CONTINUOUS_EFFECT when moved card has no pool entries', () => {
    const creature = instantiateCard('empire-servant');
    creature.state.zone = 'battlefield';
    creature.state.ownerId = 'player1';
    creature.state.controllerId = 'player1';
    room.battlefield.push(creature);
    // No pool entries for this creature

    const mutations = engine.applyMutations([{
      type: 'MOVE_CARD',
      cardUuid: creature.uuid,
      playerId: 'player1',
      from: 'battlefield',
      to: 'graveyard',
    }]);

    const removeMutation = mutations.find(m => m.type === 'REMOVE_CONTINUOUS_EFFECT');
    expect(removeMutation).toBeUndefined();
  });

  it('should emit LIFE_CHANGED when player life changes', () => {
    const bus = (engine as any).eventBus;
    const emitSpy = vi.spyOn(bus, 'emit');

    engine.applyMutations([{
      type: 'SET_LIFE',
      playerId: 'player1',
      amount: 15,
    }]);

    const lifeCalls = emitSpy.mock.calls.filter(
      (args) => args[0]?.eventId === 'LIFE_CHANGED'
    );
    expect(lifeCalls.length).toBe(1);
    expect(lifeCalls[0][0].payload.playerId).toBe('player1');
    expect(lifeCalls[0][0].payload.newLife).toBe(15);
  });

  it('should record a combat declaration when attackers are declared', () => {
    Object.keys(ActionRegistry).forEach(key => delete ActionRegistry[key]);
    registerAction('declare_attackers', declareAttackersHandler);

    const bus = (engine as any).eventBus;
    const emitSpy = vi.spyOn(bus, 'emit');

    // Put an untapped, non-sick creature on the battlefield for player1
    const creature = instantiateCard('empire-servant');
    creature.state.zone = 'battlefield';
    creature.state.ownerId = 'player1';
    creature.state.controllerId = 'player1';
    creature.state.summoningSickness = false;
    room.battlefield.push(creature);

    room.phase = 'declareAttackersStep';
    room.priorityPlayerId = 'player1';

    const result = engine.proposeAndStack('player1', 'declare_attackers', {
      attackers: [{ cardUuid: creature.uuid }],
    });
    expect(result.success).toBe(true);

    // Combat declaration recorded for UI.
    expect(engine.roomState.combat.length).toBe(1);
    expect(engine.roomState.combat[0].attacker.uuid).toBe(creature.uuid);
    expect(engine.roomState.combat[0].blockers).toEqual([]);
    // Attacker tapped + marked attacked.
    const tapped = engine.roomState.battlefield.find(c => c.uuid === creature.uuid)!;
    expect(tapped.state.isTapped).toBe(true);
    expect(tapped.state.attackedThisTurn).toBe(true);
  });
});

describe('full turn play loop', () => {
  let room: GameRoom;
  let engine: GameEngine;

  beforeEach(() => {
    Object.keys(ActionRegistry).forEach(key => delete ActionRegistry[key]);
    registerAction('cast_spell', playCardHandler);
    registerAction('declare_attackers', declareAttackersHandler);
    registerAction('tapForMana', tapForManaHandler);

    room = createTestRoom();
    engine = new GameEngine(room);
    engine.initRoom();
  });

  it('should play a land, tap for mana, cast a creature, and attack', () => {
    // Setup: give player1 a land and a creature in hand
    const land = instantiateCard('land-red');
    land.state.zone = 'hand';
    land.state.ownerId = 'player1';
    land.state.controllerId = 'player1';
    room.players['player1'].hand.push(land);

    const creature = instantiateCard('empire-servant');
    creature.state.zone = 'hand';
    creature.state.ownerId = 'player1';
    creature.state.controllerId = 'player1';
    room.players['player1'].hand.push(creature);

    // Reset mana to clean state for the test
    const player = room.players['player1'];
    player.mana = { red: 0, blue: 0, green: 0, black: 0, white: 0, colorless: 0 };

    // 1. Play land via engine (costs 0 mana)
    room.phase = 'stateMainPhase';
    room.priorityPlayerId = 'player1';
    const landResult = engine.proposeAndStack('player1', 'cast_spell', { cardUuid: land.uuid });
    expect(landResult.success).toBe(true);
    engine.resolveTopOfStack();
    expect(engine.roomState.battlefield.length).toBe(1);
    expect(engine.roomState.battlefield[0].blueprint.id).toBe('land-red');

    // Land enters untapped, no summoning sickness for non-creatures
    const landOnBoard = engine.roomState.battlefield[0];
    expect(landOnBoard.state.isTapped).toBe(false);

    // 2. Tap land for mana via engine (real handler)
    engine.roomState.priorityPlayerId = 'player1';
    const tapResult = engine.handleAction('player1', 'tapForMana', { cardUuid: landOnBoard.uuid });
    expect(tapResult.success).toBe(true);
    // tapForMana returns mutations; handleAction doesn't apply them.
    // Apply them manually to verify the mana was added.
    if (tapResult.success && tapResult.mutations) {
      engine.applyMutations(tapResult.mutations);
    }
    expect(engine.roomState.players['player1'].mana.red).toBe(1);

    // 3. Cast creature (costs 1 red mana)
    engine.roomState.phase = 'stateMainPhase';
    engine.roomState.priorityPlayerId = 'player1';
    const castResult = engine.proposeAndStack('player1', 'cast_spell', { cardUuid: creature.uuid });
    expect(castResult.success).toBe(true);
    expect(engine.roomState.players['player1'].mana.red).toBe(0);

    engine.resolveTopOfStack();
    expect(engine.roomState.battlefield.length).toBe(2);

    // Creature has summoning sickness
    const creatureOnBoard = engine.roomState.battlefield.find(c => c.blueprint.id === 'empire-servant');
    expect(creatureOnBoard).toBeDefined();
    expect(creatureOnBoard!.state.summoningSickness).toBe(true);

    // 4. Cannot declare attackers outside declareAttackersStep
    engine.roomState.phase = 'stateMainPhase';
    engine.roomState.priorityPlayerId = 'player1';
    const attackResult = engine.handleAction('player1', 'declare_attackers', {
      attackers: [{ cardUuid: creatureOnBoard!.uuid }],
    });
    expect(attackResult.success).toBe(false);

    // 5. Next turn: untap, clear sickness via proper phase transitions
    engine.transition('stateEndPhase');
    engine.transition('cleanupStep');
    engine.transition('stateTurnStart');
    const landAfterTurn = engine.roomState.battlefield.find(c => c.blueprint.id === 'land-red')!;
    const creatureAfterTurn = engine.roomState.battlefield.find(c => c.blueprint.id === 'empire-servant')!;
    expect(landAfterTurn.state.isTapped).toBe(false);
    expect(creatureAfterTurn.state.summoningSickness).toBe(false);

    // 6. Enter combat and declare attackers
    engine.transition('stateDrawPhase');
    engine.transition('stateMainPhase');
    engine.transition('beginCombatStep');
    engine.transition('declareAttackersStep');
    engine.roomState.priorityPlayerId = 'player1';

    const attackResult2 = engine.proposeAndStack('player1', 'declare_attackers', {
      attackers: [{ cardUuid: creatureAfterTurn.uuid }],
    });
    expect(attackResult2.success).toBe(true);
    const tappedCreature = engine.roomState.battlefield.find(c => c.blueprint.id === 'empire-servant')!;
    expect(tappedCreature.state.isTapped).toBe(true);

    // Combat declaration recorded; damage resolves in combatDamageStep.
    expect(engine.roomState.combat.length).toBe(1);
    expect(engine.roomState.combat[0].attacker.uuid).toBe(creatureAfterTurn.uuid);
    expect(engine.roomState.stack.length).toBe(0);
  });
});