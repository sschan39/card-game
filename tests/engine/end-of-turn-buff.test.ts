// tests/engine/end-of-turn-buff.test.ts
// "Until end of turn" buffs (power/toughness mods from GRANT_STATS etc.) must
// expire when the turn ends. switchTurn() now appends CLEAR_END_OF_TURN_BUFFS,
// which zeroes powerMod/toughnessMod on every battlefield permanent. Without
// this, the +1/+0 from Crimson Hellkite's ability would persist forever.
import { describe, it, expect, beforeEach } from 'vitest';
import { GameEngine } from '../../src/engine/game-engine';
import { createTestRoom } from '../helpers/test-room-factory';
import { registerAction } from '../../src/engine/action-registry';
import { activateAbilityHandler } from '../../src/engine/handlers/activate-ability-handler';
import { instantiateCard } from '../../src/library/card-factory';
import { currentPower } from '../../src/engine/power-toughness';
import type { GameRoom } from '../../src/types/game.room.types';

describe('end-of-turn buff expiry', () => {
  let room: GameRoom;
  let engine: GameEngine;

  beforeEach(() => {
    room = createTestRoom({ currentPhase: 'stateMainPhase', priorityPlayerId: 'player1' });
    registerAction('activateAbility', activateAbilityHandler);
    engine = new GameEngine(room);
    engine.initRoom();

    const hellkite = instantiateCard('card_09876_core_set');
    hellkite.state.zone = 'battlefield';
    hellkite.state.ownerId = 'player1';
    hellkite.state.controllerId = 'player1';
    room.battlefield.push(hellkite);
    engine.roomState.players['player1'].mana = { ...engine.roomState.players['player1'].mana, red: 5 };
  });

  it('clears a GRANT_STATS +1/+0 buff when the turn switches', () => {
    // Activate {R}: +1/+0 → buffed to 6/5.
    engine.proposeAndStack('player1', 'activateAbility', { cardUuid: room.battlefield[0].uuid, abilityIndex: 0 });
    engine.resolveTopOfStack();
    let h = engine.roomState.battlefield.find(c => c.blueprint.id === 'card_09876_core_set')!;
    expect(currentPower(h)).toBe(6);

    // End the turn (switch to player2) → the END_OF_TURN buff expires.
    engine.switchTurn();
    h = engine.roomState.battlefield.find(c => c.blueprint.id === 'card_09876_core_set')!;
    expect(engine.roomState.activeTurnPlayerId).toBe('player2');
    expect(currentPower(h)).toBe(5);
    expect(h.state.powerMod).toBe(0);
  });

  it('keeps untouched permanents unchanged when buffs are cleared', () => {
    // A second unbuffed creature on the battlefield must retain base power.
    const servant = instantiateCard('empire-servant');
    servant.state.zone = 'battlefield';
    servant.state.ownerId = 'player1';
    servant.state.controllerId = 'player1';
    room.battlefield.push(servant);

    // Buff the Hellkite, then end the turn.
    engine.proposeAndStack('player1', 'activateAbility', { cardUuid: room.battlefield.find(c => c.blueprint.id === 'card_09876_core_set')!.uuid, abilityIndex: 0 });
    engine.resolveTopOfStack();
    engine.switchTurn();

    const servantAfter = engine.roomState.battlefield.find(c => c.uuid === servant.uuid)!;
    expect(currentPower(servantAfter)).toBe(1); // base 1/1 untouched
    const h = engine.roomState.battlefield.find(c => c.blueprint.id === 'card_09876_core_set')!;
    expect(currentPower(h)).toBe(5);
  });
});