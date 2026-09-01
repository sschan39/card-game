// tests/engine/grant-stats.test.ts
// GRANT_STATS activated ability: a battlefield permanent whose activated ability
// declares `effectId: "GRANT_STATS"` (e.g. `card_09876_core_set` — Crimson
// Hellkite, "{R}: gets +1/+0 until end of turn") can now activate and resolve a
// real power/toughness buff. Previously GRANT_STATS resolved as a silent no-op
// (no registered handler in EffectRegistry), so the in-data card's ability did
// nothing. This test drives the real card through the activateAbility pipeline
// and asserts the buff is reflected in `currentPower()`.
import { describe, it, expect, beforeEach } from 'vitest';
import { GameEngine } from '../../src/engine/game-engine';
import { createTestRoom } from '../helpers/test-room-factory';
import { registerAction } from '../../src/engine/action-registry';
import { activateAbilityHandler } from '../../src/engine/handlers/activate-ability-handler';
import { instantiateCard } from '../../src/library/card-factory';
import { currentPower, currentToughness } from '../../src/engine/power-toughness';
import type { GameRoom } from '../../src/types/game.room.types';

describe('GRANT_STATS activated ability (Crimson Hellkite)', () => {
  let room: GameRoom;
  let engine: GameEngine;

  beforeEach(() => {
    room = createTestRoom({ currentPhase: 'stateMainPhase', priorityPlayerId: 'player1' });
    registerAction('activateAbility', activateAbilityHandler);
    engine = new GameEngine(room);
    engine.initRoom();

    // Crimson Hellkite (card_09876_core_set): 5/5 with an activated
    // "{R}: gets +1/+0 until end of turn" (effectId GRANT_STATS, params power:1).
    const hellkite = instantiateCard('card_09876_core_set');
    hellkite.state.zone = 'battlefield';
    hellkite.state.ownerId = 'player1';
    hellkite.state.controllerId = 'player1';
    room.battlefield.push(hellkite);

    // Give player1 enough red mana to pay the {R} activation cost.
    engine.roomState.players['player1'].mana = { ...engine.roomState.players['player1'].mana, red: 5 };
  });

  it('activates the {R} GRANT_STATS ability: pays cost and buffs the source +1/+0', () => {
    const hellkite = engine.roomState.battlefield.find(c => c.blueprint.id === 'card_09876_core_set')!;
    // Baseline: 5/5.
    expect(currentPower(hellkite)).toBe(5);
    expect(currentToughness(hellkite)).toBe(5);

    const act = engine.proposeAndStack('player1', 'activateAbility', { cardUuid: hellkite.uuid, abilityIndex: 0 });
    expect(act.success).toBe(true);

    // Cost paid: 1 red mana spent (5 → 4).
    expect(engine.roomState.players['player1'].mana['red']).toBe(4);

    // An activated stack object was created; the source stays on the battlefield.
    expect(engine.roomState.stack.length).toBe(1);
    expect(engine.roomState.stack[0].type).toBe('activated');
    expect(engine.roomState.battlefield.some(c => c.uuid === hellkite.uuid)).toBe(true);

    // Resolve → GRANT_STATS applies powerMod +1; current power 6.
    const resolve = engine.resolveTopOfStack();
    expect(resolve.success).toBe(true);
    const buffed = engine.roomState.battlefield.find(c => c.uuid === hellkite.uuid)!;
    expect(currentPower(buffed)).toBe(6);
    expect(currentToughness(buffed)).toBe(5);
    expect(engine.roomState.stack.length).toBe(0);
  });

  it('activations stack: two {R} uses make the Hellkite a 7/5', () => {
    const hellkite = engine.roomState.battlefield.find(c => c.blueprint.id === 'card_09876_core_set')!;

    engine.proposeAndStack('player1', 'activateAbility', { cardUuid: hellkite.uuid, abilityIndex: 0 });
    engine.resolveTopOfStack();
    engine.proposeAndStack('player1', 'activateAbility', { cardUuid: hellkite.uuid, abilityIndex: 0 });
    engine.resolveTopOfStack();

    const buffed = engine.roomState.battlefield.find(c => c.uuid === hellkite.uuid)!;
    expect(currentPower(buffed)).toBe(7);
  });

  it('rejects activation when the player cannot pay the {R} cost', () => {
    engine.roomState.players['player1'].mana = { ...engine.roomState.players['player1'].mana, red: 0 };
    const hellkite = engine.roomState.battlefield.find(c => c.blueprint.id === 'card_09876_core_set')!;

    const act = engine.proposeAndStack('player1', 'activateAbility', { cardUuid: hellkite.uuid, abilityIndex: 0 });
    expect(act.success).toBe(false);
    expect(engine.roomState.stack.length).toBe(0);
    // No buff applied.
    const unchanged = engine.roomState.battlefield.find(c => c.uuid === hellkite.uuid)!;
    expect(currentPower(unchanged)).toBe(5);
  });
});