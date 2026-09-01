// tests/engine/counterspell.test.ts
// Counter-spell card: a player may cast an Instant that COUNTERs a specific
// spell on the stack via cast-time target selection. The targeted spell's
// resolution is skipped (countered flag) and its card goes to the owner's
// graveyard instead of resolving onto the battlefield.
//
// This closes the "counter-spell card" gap: previously the counter mechanism
// (`SET_COUNTERED`) was only reachable through the engine-level
// `counterStackObject` action. This test drives the real `cast_spell` path with
// a stack-targeting spell (the `counterspell` card) end to end.
import { describe, it, expect, beforeEach } from 'vitest';
import { GameEngine } from '../../src/engine/game-engine';
import { registerAction } from '../../src/engine/action-registry';
import { playCardHandler } from '../../src/engine/handlers/play-card-handler';
import { createTestRoom } from '../helpers/test-room-factory';
import { instantiateCard } from '../../src/library/card-factory';
import type { GameRoom } from '../../src/types/game.room.types';
import type { TargetPointer } from '../../src/types/effect.types';

describe('counterspell card (stack-targeting COUNTER)', () => {
  let room: GameRoom;
  let engine: GameEngine;
  let empireServant: ReturnType<typeof instantiateCard>;
  let counterspell: ReturnType<typeof instantiateCard>;

  const stackTarget = (stackUuid: string): TargetPointer => ({ targetType: 'stack', stackUuid });

  beforeEach(() => {
    room = createTestRoom(); // currentPhase stateMainPhase, priority player1, activeTurn player1
    // Make player2 the active player so their sorcery-speed creature cast is legal
    // during their own main phase (priority starts at player1 for the priority-reject test).
    room.activeTurnPlayerId = 'player2';
    engine = new GameEngine(room);
    registerAction('cast_spell', playCardHandler);

    // Give player1 a counterspell and player2 a creature to cast into it.
    counterspell = instantiateCard('counterspell');
    counterspell.state.zone = 'hand';
    counterspell.state.ownerId = 'player1';
    counterspell.state.controllerId = 'player1';
    room.players['player1'].hand.push(counterspell);

    empireServant = instantiateCard('empire-servant');
    empireServant.state.zone = 'hand';
    empireServant.state.ownerId = 'player2';
    empireServant.state.controllerId = 'player2';
    room.players['player2'].hand.push(empireServant);
  });

  it('counters a specific opponent spell on the stack, skipping its resolution and sending it to graveyard', () => {
    // player2 casts empire-servant. Grant priority to player2.
    engine.roomState.priorityPlayerId = 'player2';
    const castCreature = engine.proposeAndStack('player2', 'cast_spell', { cardUuid: empireServant.uuid });
    expect(castCreature.success).toBe(true);
    // Step 1: creature spell sits on the stack, priority passed to the opponent (player1).
    expect(engine.roomState.stack.length).toBe(1);
    const creatureSpellUuid = engine.roomState.stack[0].uuid;
    expect(engine.roomState.stack[0].countered).toBe(false);
    expect(engine.priorityPlayerId).toBe('player1');

    // player1 casts counterspell targeting the creature spell.
    const castCounter = engine.proposeAndStack('player1', 'cast_spell', {
      cardUuid: counterspell.uuid,
      targets: [stackTarget(creatureSpellUuid)],
    });
    expect(castCounter.success).toBe(true);
    // Both spells now on the stack. Stack top = last index; counterspell was
    // cast last, so it sits on top (LIFO) over the creature spell.
    expect(engine.roomState.stack.length).toBe(2);
    expect(engine.roomState.stack[0].uuid).toBe(creatureSpellUuid);
    expect(engine.roomState.stack[1].controllerId).toBe('player1');

    // Resolve the counterspell (top): its COUNTER effect marks the target countered.
    const resolveCounter = engine.resolveTopOfStack();
    expect(resolveCounter.success).toBe(true);
    const creatureSpell = engine.roomState.stack.find(s => s.uuid === creatureSpellUuid);
    expect(creatureSpell).toBeDefined();
    expect(creatureSpell!.countered).toBe(true);

    // Resolve the now-countered creature spell: no battlefield entry, owner graveyard.
    const resolveCreature = engine.resolveTopOfStack();
    expect(resolveCreature.success).toBe(true);
    expect(engine.roomState.stack.length).toBe(0);
    expect(engine.roomState.battlefield.find(c => c.uuid === empireServant.uuid)).toBeUndefined();
    expect(engine.roomState.players['player2'].graveyard.some(c => c.uuid === empireServant.uuid)).toBe(true);
    // The counter-spell itself (an Instant) resolves to its owner's graveyard.
    expect(engine.roomState.players['player1'].graveyard.some(c => c.uuid === counterspell.uuid)).toBe(true);
  });

  it('leaves the target spell unresolved-countered (resolves normally) when cast without a stack target', () => {
    engine.roomState.priorityPlayerId = 'player2';
    const castCreature = engine.proposeAndStack('player2', 'cast_spell', { cardUuid: empireServant.uuid });
    expect(castCreature.success).toBe(true);
    const creatureSpellUuid = engine.roomState.stack[0].uuid;

    // player1 casts counterspell but supplies NO stack target. The COUNTER effect
    // has an empty targets array, so it marks nothing countered.
    const castCounter = engine.proposeAndStack('player1', 'cast_spell', { cardUuid: counterspell.uuid });
    expect(castCounter.success).toBe(true);

    engine.resolveTopOfStack(); // counterspell resolves → does nothing
    const creature = engine.roomState.stack.find(s => s.uuid === creatureSpellUuid);
    expect(creature!.countered).toBe(false);

    engine.resolveTopOfStack(); // creature resolves normally
    const onBattlefield = engine.roomState.battlefield.find(c => c.uuid === empireServant.uuid);
    expect(onBattlefield).toBeDefined();
    expect(onBattlefield!.state.zone).toBe('battlefield');
  });

  it('rejects casting the counterspell without priority', () => {
    // priority is player1 from init; player2 tries to act → rejected by validator.
    const illegalCast = engine.handleAction('player2', 'cast_spell', { cardUuid: empireServant.uuid });
    expect(illegalCast.success).toBe(false);
    expect(engine.roomState.stack.length).toBe(0);
  });
});