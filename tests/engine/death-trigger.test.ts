// tests/engine/death-trigger.test.ts
// Death / leave triggers: when a creature on the battlefield dies (lethal
// damage, destroy, toughness <= 0), the engine emits PERMANENT_LEFT and the
// TriggerManager fires its ON_DIE / ON_LEAVE_BATTLEFIELD triggered abilities,
// pushing a triggered StackObject that resolves in the normal stack pipeline.
// Closes the round-13 structural gap (ARCHITECTURE: "Death/destroy triggers").
import { describe, it, expect, beforeEach } from 'vitest';
import { GameEngine } from '../../src/engine/game-engine';
import { createTestRoom } from '../helpers/test-room-factory';
import { v4 as uuidv4 } from 'uuid';
import type { GameRoom } from '../../src/types/game.room.types';
import type { CardBlueprint, CardInstance, TriggeredAbility } from '../../src/types/card.types';

/** Build a synthetic 1/1 creature whose ON_DIE lets its controller pay life. */
function makeDieGainer(): CardInstance {
  const trigger: TriggeredAbility = {
    type: 'triggered',
    triggerCondition: 'ON_DIE',
    effect: { effectId: 'MODIFY_LIFE', params: { amount: -4 } },
    castSpeed: 'instant',
  };
  const blueprint: CardBlueprint = {
    id: 'die-gainer',
    name: 'Unyielding Vestige',
    cardTypes: ['Creature'],
    subTypes: ['Spirit'],
    castRequirements: { allowedZones: ['hand'], speed: 'sorcery' },
    rulesText: 'When this dies, its controller loses 4 life.',
    power: 1,
    toughness: 1,
    abilities: [trigger],
  };
  const card: CardInstance = {
    uuid: uuidv4(),
    blueprint,
    state: {
      zone: 'battlefield',
      ownerId: 'player1',
      controllerId: 'player1',
      isTapped: false,
      summoningSickness: true,
      damageTaken: 0,
      counters: {},
    },
  };
  return card;
}

describe('GameEngine death/leave triggers', () => {
  let room: GameRoom;
  let engine: GameEngine;

  beforeEach(() => {
    room = createTestRoom();
    engine = new GameEngine(room);
    engine.initRoom(); // wire TriggerManager PERMANENT_LEFT listener
  });

  it('fires ON_DIE trigger and resolves its effect when a creature dies to lethal damage', () => {
    const dieGainer = makeDieGainer();
    room.battlefield.push(dieGainer);
    const lifeBefore = engine.roomState.players['player1'].life;

    // 1 damage to a 1/1 is lethal → state-based action moves it to the graveyard
    // and the death trigger is queued onto the stack.
    engine.applyMutations([{ type: 'SET_DAMAGE', cardUuid: dieGainer.uuid, amount: 1 }]);

    // Creature is gone from the battlefield; trigger is on the stack.
    expect(engine.roomState.battlefield.find(c => c.uuid === dieGainer.uuid)).toBeUndefined();
    expect(engine.roomState.players['player1'].graveyard.find(c => c.uuid === dieGainer.uuid)).toBeDefined();
    expect(engine.roomState.stack.length).toBe(1);

    // Resolve the death trigger → effect fires (controller lost 4 life).
    engine.resolveTopOfStack();

    expect(engine.roomState.players['player1'].life).toBe(lifeBefore - 4);
    expect(engine.roomState.stack.length).toBe(0);
  });

  it('firing uses the permanent-left detection and pushes a triggered stack object', () => {
    const dieGainer = makeDieGainer();
    room.battlefield.push(dieGainer);

    engine.applyMutations([{ type: 'SET_DAMAGE', cardUuid: dieGainer.uuid, amount: 1 }]);

    // Exactly one triggered death stack object was produced.
    expect(engine.roomState.stack.length).toBe(1);
    expect(engine.roomState.stack[0].type).toBe('triggered');
  });

  it('a creature without a death trigger produces no triggered stack/effect on death', () => {
    // Plain 1/1 with no ON_DIE ability (use a real blueprint).
    const card = (() => {
      const c = makeDieGainer();
      c.blueprint.abilities = [];
      return c;
    })();
    room.battlefield.push(card);
    const lifeBefore = engine.roomState.players['player1'].life;

    engine.applyMutations([{ type: 'SET_DAMAGE', cardUuid: card.uuid, amount: 1 }]);

    expect(engine.roomState.players['player1'].life).toBe(lifeBefore); // no effect fired
    expect(engine.roomState.stack.length).toBe(0);
  });

  it('toughness reduced to 0 (no damage needed) still fires the ON_DIE trigger', () => {
    const dieGainer = makeDieGainer();
    room.battlefield.push(dieGainer);
    const lifeBefore = engine.roomState.players['player1'].life;

    // Debuff toughness to 0 → dies via state-based action regardless of damage.
    engine.applyMutations([{ type: 'SET_POWER_TOUGHNESS', cardUuid: dieGainer.uuid, toughnessMod: -1 }]);

    expect(engine.roomState.players['player1'].graveyard.find(c => c.uuid === dieGainer.uuid)).toBeDefined();
    expect(engine.roomState.stack.length).toBe(1);

    engine.resolveTopOfStack();
    expect(engine.roomState.players['player1'].life).toBe(lifeBefore - 4);
  });

  it('respects ON_LEAVE_BATTLEFIELD as well as ON_DIE', () => {
    const card = makeDieGainer();
    // Re-point the trigger to ON_LEAVE_BATTLEFIELD (still 1/1).
    card.blueprint.abilities = [{
      type: 'triggered',
      triggerCondition: 'ON_LEAVE_BATTLEFIELD',
      effect: { effectId: 'MODIFY_LIFE', params: { amount: -5 } },
      castSpeed: 'instant',
    }];
    room.battlefield.push(card);
    const lifeBefore = engine.roomState.players['player1'].life;

    engine.applyMutations([{ type: 'SET_DAMAGE', cardUuid: card.uuid, amount: 1 }]);

    // Fired on leave (death also implies leave) → 5 life lost once resolved.
    expect(engine.roomState.stack.length).toBe(1);
    engine.resolveTopOfStack();
    expect(engine.roomState.players['player1'].life).toBe(lifeBefore - 5);
  });

  it('does not fire a trigger when a creature survives the damage batch', () => {
    // Toughness 5 survives 1 damage → never leaves → no PERMANENT_LEFT → no trigger.
    const card = (() => {
      const c = makeDieGainer();
      c.blueprint.toughness = 5; // 5 toughness survives 1 damage
      return c;
    })();
    room.battlefield.push(card);
    const lifeBefore = engine.roomState.players['player1'].life;

    engine.applyMutations([{ type: 'SET_DAMAGE', cardUuid: card.uuid, amount: 1 }]);

    // Survives → stays in play → no trigger on the stack → no life loss.
    expect(engine.roomState.battlefield.find(c => c.uuid === card.uuid)).toBeDefined();
    expect(engine.roomState.stack.length).toBe(0);
    expect(engine.roomState.players['player1'].life).toBe(lifeBefore);
  });
});