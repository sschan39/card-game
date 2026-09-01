// tests/engine/counter.test.ts
// Countering a spell on the stack: the priority holder may mark the top (or a
// specific) stack object `countered`, which skips all effects on resolution and
// sends the card to its owner's graveyard. Closes the structural "countering"
// gap — the `countered` flag existed but no action ever set it.
import { describe, it, expect, beforeEach } from 'vitest';
import { GameEngine } from '../../src/engine/game-engine';
import { createTestRoom } from '../helpers/test-room-factory';
import { instantiateCard } from '../../src/library/card-factory';
import type { GameRoom, PlayerId } from '../../src/types/game.room.types';
import type { StackObject, StackEffect } from '../../src/types/effect.types';
import { v4 as uuidv4 } from 'uuid';

function makeSpellStackObject(overrides: Partial<StackObject> = {}): StackObject {
  const source = instantiateCard('empire-servant');
  source.state.zone = 'stack';
  source.state.ownerId = 'player1';
  source.state.controllerId = 'player1';
  const effect: StackEffect = {
    action: 'MODIFY_LIFE',
    params: { amount: -5 },
    tags: ['damage'],
    targets: [{ targetType: 'player', playerId: 'player2' }],
  };
  return {
    uuid: uuidv4(),
    type: 'spell',
    controllerId: 'player1',
    source,
    effects: [effect],
    countered: false,
    ...overrides,
  };
}

describe('GameEngine.counterStackObject', () => {
  let room: GameRoom;
  let engine: GameEngine;

  beforeEach(() => {
    room = createTestRoom({ currentPhase: 'Stack', priorityPlayerId: 'player1' });
    engine = new GameEngine(room);
  });

  it('counters the top spell so resolution deals no effect and cards go to graveyard', () => {
    const spell = makeSpellStackObject();
    engine.roomState.stack.push(spell);
    const lifeBefore = engine.roomState.players['player2'].life;

    const counter = engine.counterStackObject('player1');
    expect(counter.success).toBe(true);
    expect(engine.roomState.stack[0].countered).toBe(true);

    const resolve = engine.resolveTopOfStack();
    expect(resolve.success).toBe(true);
    // Effect skipped → no face damage.
    expect(engine.roomState.players['player2'].life).toBe(lifeBefore);
    // Structural rule → the countered card moved to the caster's graveyard.
    expect(engine.roomState.players['player1'].graveyard.some(c => c.uuid === spell.source.uuid)).toBe(true);
    // Stack drained.
    expect(engine.roomState.stack.length).toBe(0);
  });

  it('rejects a counter when the caller does not have priority', () => {
    room = createTestRoom({ currentPhase: 'Stack', priorityPlayerId: 'player2' });
    engine = new GameEngine(room);
    engine.roomState.stack.push(makeSpellStackObject());

    const counter = engine.counterStackObject('player1');
    expect(counter.success).toBe(false);
    expect(engine.roomState.stack[0].countered).toBe(false);
  });

  it('rejects when the stack is empty', () => {
    const counter = engine.counterStackObject('player1');
    expect(counter.success).toBe(false);
  });

  it('rejects countering an already-countered spell', () => {
    const spell = makeSpellStackObject({ countered: true });
    engine.roomState.stack.push(spell);
    const counter = engine.counterStackObject('player1');
    expect(counter.success).toBe(false);
  });

  it('counters a specific non-top spell by uuid', () => {
    const top = makeSpellStackObject();
    const lower = makeSpellStackObject();
    engine.roomState.stack.push(lower); // in first (lower) position
    engine.roomState.stack.push(top);

    const counter = engine.counterStackObject('player1', lower.uuid);
    expect(counter.success).toBe(true);
    // Only the targeted (lower) spell is countered; the top is untouched.
    expect(engine.roomState.stack[0].countered).toBe(true);
    expect(engine.roomState.stack[1].countered).toBe(false);
  });
});