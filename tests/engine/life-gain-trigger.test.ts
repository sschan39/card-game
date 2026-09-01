// tests/engine/life-gain-trigger.test.ts
// Life-gain triggers: when a mutation batch raises a player's life total, the
// engine emits LIFE_CHANGED with the gained amount the player's battlefield.
// TriggerManager fires ON_LIFE_GAIN for every permanent that player controls
// with such an ability. Closes the round-17 structural gap (soul-warden-style
// "whenever you gain life" mechanic).
import { describe, it, expect, beforeEach } from 'vitest';
import { GameEngine } from '../../src/engine/game-engine';
import { createTestRoom } from '../helpers/test-room-factory';
import { v4 as uuidv4 } from 'uuid';
import type { GameRoom } from '../../src/types/game.room.types';
import type { CardBlueprint, CardInstance, TriggeredAbility } from '../../src/types/card.types';

/** A creature that lets its controller draw a card whenever they gain life. */
function makeLifeGainDrawer(controllerId: string): CardInstance {
  const trigger: TriggeredAbility = {
    type: 'triggered',
    triggerCondition: 'ON_LIFE_GAIN',
    effect: { effectId: 'DRAW', params: { amount: 1 } },
    castSpeed: 'instant',
  };
  const blueprint: CardBlueprint = {
    id: 'soul-adept',
    name: 'Soul Adept',
    cardTypes: ['Creature'],
    castRequirements: { allowedZones: ['hand'], speed: 'sorcery' },
    rulesText: 'Whenever you gain life, draw a card.',
    power: 1,
    toughness: 1,
    abilities: [trigger],
  };
  return {
    uuid: uuidv4(),
    blueprint,
    state: {
      zone: 'battlefield',
      ownerId: controllerId,
      controllerId,
      isTapped: false,
      summoningSickness: false,
      damageTaken: 0,
      counters: {},
    },
  };
}

describe('GameEngine life-gain triggers', () => {
  let room: GameRoom;
  let engine: GameEngine;

  beforeEach(() => {
    room = createTestRoom({ currentPhase: 'stateMainPhase', priorityPlayerId: 'player1' });
    engine = new GameEngine(room);
    engine.initRoom(); // wire TriggerManager LIFE_CHANGED listener
    // Give player1 a deck so the trigger's draw actually adds a card.
    room.players['player1'].deck.push({
      uuid: uuidv4(),
      blueprint: { id: 'plain', name: 'Plain', cardTypes: ['Land'], castRequirements: { allowedZones: ['hand'], speed: 'sorcery' }, rulesText: '', abilities: [] },
      state: { zone: 'library', ownerId: 'player1', controllerId: 'player1', isTapped: false, summoningSickness: false, damageTaken: 0, counters: {} },
    });
  });

  it('fires an ON_LIFE_GAIN trigger when its controller gains life', () => {
    // Player1 controls a creature that draws a card whenever they gain life.
    room.battlefield.push(makeLifeGainDrawer('player1'));
    const handBefore = engine.roomState.players['player1'].hand.length;
    const p1LifeBefore = engine.roomState.players['player1'].life;

    // Player1 gains 3 life (a life-gain effect applied through the engine).
    engine.applyMutations([{ type: 'SET_LIFE', playerId: 'player1', amount: p1LifeBefore + 3 }]);
    expect(engine.roomState.players['player1'].life).toBe(p1LifeBefore + 3);

    // The ON_LIFE_GAIN trigger was queued and resolves → draw 1 card.
    expect(engine.roomState.stack.length).toBe(1);
    expect(engine.roomState.stack[0].type).toBe('triggered');
    engine.resolveTopOfStack();
    expect(engine.roomState.players['player1'].hand.length).toBe(handBefore + 1);
  });

  it('only fires ON_LIFE_GAIN triggers for the player who actually gained life', () => {
    // Both players control a drawer; only player1 gains life → only player1 draws.
    room.battlefield.push(makeLifeGainDrawer('player1'));
    room.battlefield.push(makeLifeGainDrawer('player2'));
    const p1HandBefore = engine.roomState.players['player1'].hand.length;
    const p2HandBefore = engine.roomState.players['player2'].hand.length;

    engine.applyMutations([{ type: 'SET_LIFE', playerId: 'player1', amount: 23 }]);
    expect(engine.roomState.stack.length).toBe(1);

    engine.resolveTopOfStack();
    expect(engine.roomState.players['player1'].hand.length).toBe(p1HandBefore + 1);
    expect(engine.roomState.players['player2'].hand.length).toBe(p2HandBefore);
  });

  it('produces no trigger when no life is gained (or the deck cannot draw)', () => {
    // Player1 has the drawer but no life gain happens this batch.
    room.battlefield.push(makeLifeGainDrawer('player1'));
    const p1HandBefore = engine.roomState.players['player1'].hand.length;

    // A mutation that does not change life.
    engine.applyMutations([{ type: 'SET_MANA', playerId: 'player1', color: 'red', amount: 5 }]);
    expect(engine.roomState.stack.length).toBe(0);
    expect(engine.roomState.players['player1'].hand.length).toBe(p1HandBefore);
  });
});