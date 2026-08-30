// tests/engine/game-engine.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { GameEngine } from '../../src/engine/game-engine';
import { ActionRegistry, registerAction } from '../../src/engine/action-registry';
import { playCardHandler } from '../../src/engine/handlers/play-card-handler';
import { attackHandler } from '../../src/engine/handlers/attack-handler';
import { tapForManaHandler } from '../../src/engine/handlers/tap-for-mana-handler';
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
});

describe('full turn play loop', () => {
  let room: GameRoom;
  let engine: GameEngine;

  beforeEach(() => {
    Object.keys(ActionRegistry).forEach(key => delete ActionRegistry[key]);
    registerAction('cast_spell', playCardHandler);
    registerAction('attack', attackHandler);
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
    room.currentPhase = 'stateMainPhase';
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
    engine.roomState.currentPhase = 'stateMainPhase';
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

    // 4. Cannot attack outside battle phase
    engine.roomState.currentPhase = 'stateMainPhase';
    engine.roomState.priorityPlayerId = 'player1';
    const attackResult = engine.handleAction('player1', 'attack', { cardUuid: creatureOnBoard!.uuid });
    expect(attackResult.success).toBe(false);

    // 5. Next turn: untap, clear sickness via proper phase transitions
    engine.transition('stateEndPhase');
    engine.transition('cleanupStep');
    engine.transition('stateTurnStart');
    const landAfterTurn = engine.roomState.battlefield.find(c => c.blueprint.id === 'land-red')!;
    const creatureAfterTurn = engine.roomState.battlefield.find(c => c.blueprint.id === 'empire-servant')!;
    expect(landAfterTurn.state.isTapped).toBe(false);
    expect(creatureAfterTurn.state.summoningSickness).toBe(false);

    // 6. Enter battle phase and attack
    engine.transition('stateDrawPhase');
    engine.transition('stateMainPhase');
    engine.transition('stateBattlePhase');
    engine.roomState.priorityPlayerId = 'player1';

    const attackResult2 = engine.proposeAndStack('player1', 'attack', { cardUuid: creatureAfterTurn.uuid });
    expect(attackResult2.success).toBe(true);
    const tappedCreature = engine.roomState.battlefield.find(c => c.blueprint.id === 'empire-servant')!;
    expect(tappedCreature.state.isTapped).toBe(true);

    // Damage hasn't been dealt yet — it's on the stack
    expect(engine.roomState.players['player2'].life).toBe(20);

    // Resolve the attack on the stack
    engine.resolveTopOfStack();
    expect(engine.roomState.players['player2'].life).toBe(19); // 20 - 1 power
  });
});