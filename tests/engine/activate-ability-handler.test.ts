// tests/engine/activate-ability-handler.test.ts
// Generic non-mana activated-ability handler: a battlefield permanent with an
// `activated` ability (other than a pure mana ability) can be activated by
// paying its cost, pushing an `activated` StackObject, and resolving its effect.
// Closes the round-18/19 ARCHITECTURE gap "Activated abilities (non-mana)".
import { describe, it, expect, beforeEach } from 'vitest';
import { GameEngine } from '../../src/engine/game-engine';
import { createTestRoom } from '../helpers/test-room-factory';
import { registerAction } from '../../src/engine/action-registry';
import { activateAbilityHandler } from '../../src/engine/handlers/activate-ability-handler';
import { v4 as uuidv4 } from 'uuid';
import type { GameRoom } from '../../src/types/game.room.types';
import type { CardBlueprint, CardInstance, ActivatedAbility } from '../../src/types/card.types';

/** A 2/2 creature with two activated abilities. */
function makeActivatedCreature(controllerId: string): CardInstance {
  const manaAbility: ActivatedAbility = {
    type: 'activated',
    cost: { mana: { red: 2 } },
    effect: { effectId: 'MODIFY_LIFE', params: { amount: -2 } },
    castSpeed: 'instant',
  };
  const tapAbility: ActivatedAbility = {
    type: 'activated',
    cost: { tap: true },
    effect: { effectId: 'DRAW', params: { amount: 1 } },
    castSpeed: 'instant',
  };
  const blueprint: CardBlueprint = {
    id: 'pyromancer',
    name: 'Pyromancer Initiate',
    cardTypes: ['Creature'],
    castRequirements: { allowedZones: ['hand'], speed: 'sorcery' },
    rulesText: '{R}{R}: You lose 2 life. {T}: Draw a card.',
    power: 2,
    toughness: 2,
    abilities: [manaAbility, tapAbility],
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

describe('activateAbilityHandler', () => {
  let room: GameRoom;
  let engine: GameEngine;

  beforeEach(() => {
    room = createTestRoom({ currentPhase: 'stateMainPhase', priorityPlayerId: 'player1' });
    registerAction('activateAbility', activateAbilityHandler);
    engine = new GameEngine(room);
    engine.initRoom();
    // Give player1 a deck so any draw effect resolves to a card.
    room.players['player1'].deck.push({
      uuid: uuidv4(),
      blueprint: { id: 'plain', name: 'Plain', cardTypes: ['Land'], castRequirements: { allowedZones: ['hand'], speed: 'sorcery' }, rulesText: '', abilities: [] },
      state: { zone: 'library', ownerId: 'player1', controllerId: 'player1', isTapped: false, summoningSickness: false, damageTaken: 0, counters: {} },
    });
  });

  it('activates a mana-cost ability: pays cost, stacks, resolves its effect', () => {
    const card = makeActivatedCreature('player1');
    room.battlefield.push(card);
    const lifeBefore = engine.roomState.players['player1'].life;
    engine.roomState.players['player1'].mana = { ...engine.roomState.players['player1'].mana, red: 5 };

    const act = engine.proposeAndStack('player1', 'activateAbility', { cardUuid: card.uuid, abilityIndex: 0 });
    expect(act.success).toBe(true);

    // Cost was paid: 2 red mana spent.
    expect(engine.roomState.players['player1'].mana['red']).toBe(3);

    // An activated stack object was created (source stays on the battlefield).
    expect(engine.roomState.stack.length).toBe(1);
    expect(engine.roomState.stack[0].type).toBe('activated');
    expect(engine.roomState.battlefield.some(c => c.uuid === card.uuid)).toBe(true);

    // Resolve → the controller loses 2 life.
    const resolve = engine.resolveTopOfStack();
    expect(resolve.success).toBe(true);
    expect(engine.roomState.players['player1'].life).toBe(lifeBefore - 2);
    expect(engine.roomState.stack.length).toBe(0);
  });

  it('activates a tap-cost ability: taps the permanent and draws a card', () => {
    const card = makeActivatedCreature('player1');
    room.battlefield.push(card);
    const handBefore = engine.roomState.players['player1'].hand.length;

    const act = engine.proposeAndStack('player1', 'activateAbility', { cardUuid: card.uuid, abilityIndex: 1 });
    expect(act.success).toBe(true);

    // Tap cost paid on propose.
    const battlefieldCard = engine.roomState.battlefield.find(c => c.uuid === card.uuid)!;
    expect(battlefieldCard.state.isTapped).toBe(true);

    // Resolve → draw 1 card.
    engine.resolveTopOfStack();
    expect(engine.roomState.players['player1'].hand.length).toBe(handBefore + 1);
  });

  it('rejects activation when the cost is not payable', () => {
    const card = makeActivatedCreature('player1');
    room.battlefield.push(card);
    // Player currently has 5 red; reduce to 1 so the 2-red cost cannot be paid.
    engine.roomState.players['player1'].mana = { ...engine.roomState.players['player1'].mana, red: 1 };

    const act = engine.proposeAndStack('player1', 'activateAbility', { cardUuid: card.uuid, abilityIndex: 0 });
    expect(act.success).toBe(false);
    expect(engine.roomState.stack.length).toBe(0);
  });

  it('rejects activation without priority', () => {
    const card = makeActivatedCreature('player1');
    room.battlefield.push(card);
    // Remove priority from player1.
    engine.roomState.priorityPlayerId = null;

    const act = engine.proposeAndStack('player1', 'activateAbility', { cardUuid: card.uuid, abilityIndex: 0 });
    expect(act.success).toBe(false);
    expect(engine.roomState.stack.length).toBe(0);
  });
});