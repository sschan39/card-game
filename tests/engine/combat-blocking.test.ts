// tests/engine/combat-blocking.test.ts
// Combat blocking: the defender may assign an untapped creature to block an
// attack. A blocked attack deals combat damage to the blocker instead of the
// face player, and the blocker deals its power back to the attacker; lethal
// damage destroys creatures via the state-based action. Unblocked attacks still
// hit the face player.
import { describe, it, expect, beforeEach } from 'vitest';
import { GameEngine } from '../../src/engine/game-engine';
import { registerAction } from '../../src/engine/action-registry';
import { attackHandler } from '../../src/engine/handlers/attack-handler';
import { createTestRoom } from '../helpers/test-room-factory';
import { instantiateCard } from '../../src/library/card-factory';
import type { GameRoom } from '../../src/types/game.room.types';

function putCreature(room: GameRoom, playerId: string, damage = 0) {
  const card = instantiateCard('empire-servant'); // 1/1 creature
  card.state.zone = 'battlefield';
  card.state.ownerId = playerId;
  card.state.controllerId = playerId;
  card.state.summoningSickness = false;
  card.state.isTapped = false;
  card.state.damageTaken = damage;
  room.battlefield.push(card);
  return card;
}

describe('GameEngine.declareBlocker (validation)', () => {
  let room: GameRoom;
  let engine: GameEngine;

  beforeEach(() => {
    room = createTestRoom({ currentPhase: 'stateBattlePhase' });
    registerAction('attack', attackHandler);
    engine = new GameEngine(room);
  });

  it('rejects an attacker blocking their own attack', () => {
    const attacker = putCreature(room, 'player1');
    engine.proposeAndStack('player1', 'attack', { cardUuid: attacker.uuid });
    const stackUuid = engine.roomState.stack[0].uuid;
    const result = engine.declareBlocker('player1', stackUuid, attacker.uuid);
    expect(result.success).toBe(false);
  });

  it('rejects when the blocker is not a creature you control', () => {
    const attacker = putCreature(room, 'player1');
    engine.proposeAndStack('player1', 'attack', { cardUuid: attacker.uuid });
    const stackUuid = engine.roomState.stack[0].uuid;
    const enemyBlock = putCreature(room, 'player1'); // controlled by player1, not the blocker caller
    const result = engine.declareBlocker('player2', stackUuid, enemyBlock.uuid);
    expect(result.success).toBe(false);
  });

  it('rejects a tapped blocker', () => {
    const attacker = putCreature(room, 'player1');
    engine.proposeAndStack('player1', 'attack', { cardUuid: attacker.uuid });
    const stackUuid = engine.roomState.stack[0].uuid;
    const blocker = putCreature(room, 'player2');
    blocker.state.isTapped = true;
    const result = engine.declareBlocker('player2', stackUuid, blocker.uuid);
    expect(result.success).toBe(false);
  });

  it('rejects when the stack target is not an attack', () => {
    // A land is not a creature/attack; use a stack object that is not an attack.
    const land = instantiateCard('land-red');
    land.state.zone = 'battlefield';
    land.state.ownerId = 'player1';
    land.state.controllerId = 'player1';
    room.battlefield.push(land);
    // No real attack was proposed here; synthesize a fake stack target.
    const fakeStack = {
      uuid: 'fake-stack',
      type: 'activated' as const,
      controllerId: 'player1',
      source: land,
      effects: [{ action: 'NONE', params: {}, tags: [], targets: [] }],
      countered: false,
    };
    room.stack.push(fakeStack as any);
    const blocker = putCreature(room, 'player2');
    const result = engine.declareBlocker('player2', 'fake-stack', blocker.uuid);
    expect(result.success).toBe(false);
  });
});

describe('GameEngine.declareBlocker + combat resolution', () => {
  let room: GameRoom;
  let engine: GameEngine;

  beforeEach(() => {
    room = createTestRoom({ currentPhase: 'stateBattlePhase' });
    registerAction('attack', attackHandler);
    engine = new GameEngine(room);
  });

  it('records the blocker assignment on the room', () => {
    const attacker = putCreature(room, 'player1');
    const blocker = putCreature(room, 'player2');
    engine.proposeAndStack('player1', 'attack', { cardUuid: attacker.uuid });
    const stackUuid = engine.roomState.stack[0].uuid;
    const result = engine.declareBlocker('player2', stackUuid, blocker.uuid);
    expect(result.success).toBe(true);
    expect(engine.roomState.combat[stackUuid]).toBe(blocker.uuid);
  });

  it('blocked attack deals combat damage to the blocker, not the face player', () => {
    // Both creatures on the battlefield before the attack so the proposal's tap
    // mutation (which copies the board) keeps them in the live engine state.
    const attacker = putCreature(room, 'player1');
    const blocker = putCreature(room, 'player2');
    engine.proposeAndStack('player1', 'attack', { cardUuid: attacker.uuid });
    const stackUuid = engine.roomState.stack[0].uuid;
    engine.declareBlocker('player2', stackUuid, blocker.uuid);

    const lifeBefore = engine.roomState.players['player2'].life;
    engine.resolveTopOfStack();

    // Face player untouched.
    expect(engine.roomState.players['player2'].life).toBe(lifeBefore);

    // Attacker (1 power) damages the 1/1 blocker → lethal → destroyed.
    const livingBlocker = engine.roomState.battlefield.find(c => c.uuid === blocker.uuid);
    const blockerInGy = engine.roomState.players['player2'].graveyard.find(c => c.uuid === blocker.uuid);
    expect(livingBlocker).toBeUndefined();
    expect(blockerInGy).toBeDefined();

    // Blocker (1 power) damages the 1/1 attacker back → lethal → destroyed.
    const livingAttacker = engine.roomState.battlefield.find(c => c.uuid === attacker.uuid);
    const attackerInGy = engine.roomState.players['player1'].graveyard.find(c => c.uuid === attacker.uuid);
    expect(livingAttacker).toBeUndefined();
    expect(attackerInGy).toBeDefined();
  });

  it('unblocked attack deals damage to the face player', () => {
    const attacker = putCreature(room, 'player1');
    engine.proposeAndStack('player1', 'attack', { cardUuid: attacker.uuid });

    const lifeBefore = engine.roomState.players['player2'].life;
    engine.resolveTopOfStack();

    // No blocker assigned → face damage equal to attacker power.
    expect(engine.roomState.players['player2'].life).toBe(lifeBefore - (attacker.blueprint.power ?? 0));
  });
});