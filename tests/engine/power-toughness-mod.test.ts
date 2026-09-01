// tests/engine/power-toughness-mod.test.ts
// Power/toughness modification: MODIFY_STATS P/T deltas (and the
// SET_POWER_TOUGHNESS mutation) must actually change a creature's effective
// power and toughness. All combat/lethality resolution reads the *current*
// stat (blueprint + mod), so buffs deal more damage and survive more damage,
// and debuffs can push a creature to lethal toughness.
import { describe, it, expect, beforeEach } from 'vitest';
import { GameEngine } from '../../src/engine/game-engine';
import { registerAction } from '../../src/engine/action-registry';
import { attackHandler } from '../../src/engine/handlers/attack-handler';
import { gameReducer, lethalDamageMutations } from '../../src/engine/game-reducer';
import { createTestRoom } from '../helpers/test-room-factory';
import { instantiateCard } from '../../src/library/card-factory';
import type { GameRoom } from '../../src/types/game.room.types';
import type { CardInstance } from '../../src/types/card.types';
import { currentPower, currentToughness } from '../../src/engine/power-toughness';

function putCreature(room: GameRoom, playerId: string): CardInstance {
  const card = instantiateCard('empire-servant'); // 1/1 creature
  card.state.zone = 'battlefield';
  card.state.ownerId = playerId;
  card.state.controllerId = playerId;
  card.state.summoningSickness = false;
  card.state.isTapped = false;
  card.state.damageTaken = 0;
  room.battlefield.push(card);
  return card;
}

describe('SET_POWER_TOUGHNESS mutation (pure reducer)', () => {
  it('applies power and toughness mods to a creature', () => {
    const room = createTestRoom({ currentPhase: 'stateBattlePhase' });
    const c = putCreature(room, 'player1');
    const next = gameReducer(room, { type: 'SET_POWER_TOUGHNESS', cardUuid: c.uuid, powerMod: 2, toughnessMod: 3 });
    const updated = next.battlefield.find(x => x.uuid === c.uuid)!;
    expect(updated.state.powerMod).toBe(2);
    expect(updated.state.toughnessMod).toBe(3);
    expect(currentPower(updated)).toBe(3); // 1 (blueprint) + 2
    expect(currentToughness(updated)).toBe(4); // 1 (blueprint) + 3
  });

  it('defaults effective stats to blueprint when no mod is present', () => {
    const room = createTestRoom({ currentPhase: 'stateBattlePhase' });
    const c = putCreature(room, 'player1');
    expect(currentPower(c)).toBe(1);
    expect(currentToughness(c)).toBe(1);
  });
});

describe('GameEngine P/T resolution in combat', () => {
  let room: GameRoom;
  let engine: GameEngine;

  beforeEach(() => {
    room = createTestRoom({ currentPhase: 'stateBattlePhase' });
    registerAction('attack', attackHandler);
    engine = new GameEngine(room);
  });

  it('a buffed attacker deals buffed power as face damage when unblocked', () => {
    const attacker = putCreature(room, 'player1');
    // +2 power → 1/1 becomes effectively 3 power.
    engine.applyMutations([{ type: 'SET_POWER_TOUGHNESS', cardUuid: attacker.uuid, powerMod: 2 }]);
    const lifeBefore = engine.roomState.players['player2'].life;

    engine.proposeAndStack('player1', 'attack', { cardUuid: attacker.uuid });
    engine.resolveTopOfStack();

    // Unblocked: face takes the buffed power (3), not the base 1.
    expect(engine.roomState.players['player2'].life).toBe(lifeBefore - 3);
  });

  it('a buffed blocker deals buffed power back to the attacker', () => {
    const attacker = putCreature(room, 'player1');
    const blocker = putCreature(room, 'player2');
    // Buff the blocker to 4 power.
    engine.applyMutations([{ type: 'SET_POWER_TOUGHNESS', cardUuid: blocker.uuid, powerMod: 3 }]);
    engine.proposeAndStack('player1', 'attack', { cardUuid: attacker.uuid });
    const stackUuid = engine.roomState.stack[0].uuid;
    engine.declareBlocker('player2', stackUuid, blocker.uuid);
    engine.resolveTopOfStack();

    // Blocker's buffed 4 power is lethal (>= toughness 1) → attacker dies.
    const attackerInGy = engine.roomState.players['player1'].graveyard.find(c => c.uuid === attacker.uuid);
    expect(attackerInGy).toBeDefined();
  });

  it('a buffed toughness survives damage that would be lethal otherwise', () => {
    const tough = putCreature(room, 'player1');
    // +2 toughness → effective toughness 3.
    engine.applyMutations([{ type: 'SET_POWER_TOUGHNESS', cardUuid: tough.uuid, toughnessMod: 2 }]);
    // Deal 1 damage, below the buffed threshold of 3.
    engine.applyMutations([{ type: 'SET_DAMAGE', cardUuid: tough.uuid, amount: 1 }]);

    const living = engine.roomState.battlefield.find(c => c.uuid === tough.uuid);
    expect(living).toBeDefined();
    expect(engine.roomState.players['player1'].graveyard.find(c => c.uuid === tough.uuid)).toBeUndefined();
  });

  it('a toughness debuffed to 0 or below is destroyed by the state-based action', () => {
    const squashed = putCreature(room, 'player1');
    // -1 toughness → effective toughness 0 → dies via SBA.
    engine.applyMutations([{ type: 'SET_POWER_TOUGHNESS', cardUuid: squashed.uuid, toughnessMod: -1 }]);

    const inGy = engine.roomState.players['player1'].graveyard.find(c => c.uuid === squashed.uuid);
    expect(inGy).toBeDefined();
  });

  it('lethalDamageMutations uses current (buffed) toughness', () => {
    const room2 = createTestRoom({ currentPhase: 'stateBattlePhase' });
    const c = putCreature(room2, 'player1');
    // Buff toughness to 3, then deal 2 damage (not lethal at 3, lethal at 1).
    room2.battlefield[0].state.toughnessMod = 2; // current toughness 3
    room2.battlefield[0].state.damageTaken = 2;
    const kills = lethalDamageMutations(room2);
    expect(kills.length).toBe(0);

    // Lower the buff so current toughness drops to 1; now 2 damage is lethal.
    room2.battlefield[0].state.toughnessMod = 0;
    const kills2 = lethalDamageMutations(room2);
    expect(kills2.length).toBe(1);
    expect(kills2[0].type).toBe('MOVE_CARD');
  });
});