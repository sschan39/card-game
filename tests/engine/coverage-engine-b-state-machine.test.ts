import { describe, expect, it, vi } from 'vitest';
import { StateMachine } from '@engine/state-machine';
import { gameConfig } from '@config';
import type { GameRoom } from '@shared/game.room.types';
import { createTestRoom } from '../helpers/test-room-factory';
import { creature } from '../helpers/combat-fixture';

function machine(room: GameRoom) {
  return new StateMachine(room);
}

describe('StateMachine transition legality', () => {
  it('accepts the next phase in the turn sequence and the wrap back to turn start', () => {
    const room = createTestRoom();
    const sm = machine(room);
    expect(sm.roomId).toBe(room.roomId);
    expect(sm.canTransition({ ...room, phase: 'stateTurnStart' }, 'upkeepStep')).toBe(true);
    expect(sm.canTransition({ ...room, phase: 'cleanupStep' }, 'stateTurnStart')).toBe(true);
    expect(sm.canTransition({ ...room, phase: 'stateMainPhase' }, 'stateDrawPhase')).toBe(false);
    expect(sm.canTransition({ ...room, phase: 'bogus' as never }, 'upkeepStep')).toBe(false);
  });

  it('allows the empty-combat shortcut from declare attackers to end of combat', () => {
    const room = createTestRoom();
    const sm = machine(room);
    const declared: GameRoom = { ...room, phase: 'declareAttackersStep', combatDeclarations: { attackers: true }, combat: [] };
    expect(sm.canTransition(declared, 'endCombatStep')).toBe(true);
    expect(sm.canTransition({ ...declared, combat: [{} as never] }, 'endCombatStep')).toBe(false);
    expect(sm.canTransition({ ...declared, combatDeclarations: undefined }, 'endCombatStep')).toBe(false);
  });
});

describe('StateMachine transition mutations', () => {
  it('logs and applies nothing for an illegal transition', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const room = createTestRoom();
    expect(machine(room).transition(room, 'combatDamageStep')).toEqual([]);
    expect(error).toHaveBeenCalledWith(expect.stringContaining('Invalid transition from stateMainPhase to combatDamageStep'));
    error.mockRestore();
  });

  it('untaps the active player, clears summoning sickness and drains their mana when the turn starts', () => {
    const room = createTestRoom();
    const mine = creature('mine', 'player1');
    const theirs = creature('theirs', 'player2');
    room.battlefield = [mine, theirs];
    room.phase = 'cleanupStep';

    const mutations = machine(room).transition({ ...room, activeTurnPlayerId: 'player1' }, 'stateTurnStart');
    expect(mutations).toContainEqual({ type: 'UNTAP_CARD', cardUuid: 'mine', natural: true });
    expect(mutations).toContainEqual({ type: 'SET_SUMMONING_SICKNESS', cardUuid: 'mine', value: false });
    expect(mutations).toContainEqual({ type: 'SET_ATTACKED_THIS_TURN', cardUuid: 'mine', value: false });
    expect(mutations).not.toContainEqual({ type: 'UNTAP_CARD', cardUuid: 'theirs' });
    expect(mutations).toContainEqual({ type: 'SET_MANA', playerId: 'player1', color: 'red', amount: 0 });
    expect(mutations).toContainEqual({ type: 'SET_PHASE', phase: 'stateTurnStart' });
  });

  it('skips the mana drain when the active player is missing from the room', () => {
    const room = createTestRoom();
    room.battlefield = [creature('mine', 'player1')];
    room.phase = 'cleanupStep';
    const mutations = machine(room).transition({ ...room, activeTurnPlayerId: 'ghost' as never }, 'stateTurnStart');
    expect(mutations.some((mutation) => mutation.type === 'SET_MANA')).toBe(false);
    expect(mutations.some((mutation) => mutation.type === 'UNTAP_CARD')).toBe(false);
  });

  it('clears damage and end-of-turn effects in the cleanup step', () => {
    const room = createTestRoom();
    const mutations = machine(room).transition({ ...room, phase: 'stateEndPhase' }, 'cleanupStep');
    expect(mutations).toEqual([
      { type: 'CLEAR_DAMAGE' },
      { type: 'CLEAR_END_OF_TURN_EFFECTS' },
      { type: 'SET_PHASE', phase: 'cleanupStep' },
    ]);
  });

  it('drops combat participants when combat begins and when the postcombat main phase starts', () => {
    const room = createTestRoom();
    const sm = machine(room);
    expect(sm.transition({ ...room, phase: 'stateMainPhase' }, 'beginCombatStep')).toContainEqual({ type: 'CLEAR_COMBAT' });
    expect(sm.transition({ ...room, phase: 'endCombatStep' }, 'postcombatMainPhase')).toContainEqual({ type: 'CLEAR_COMBAT' });
  });

  it('proposes the draw step draw unless the first turn is exempt', () => {
    const room = createTestRoom();
    const sm = machine(room);
    const drawStep = sm.transition({ ...room, phase: 'upkeepStep', turnNumber: 2 }, 'stateDrawPhase');
    expect(drawStep).toContainEqual({ type: 'DRAW_CARDS', playerId: 'player1', amount: 1 });

    const firstTurnDraw: GameRoom = {
      ...room,
      phase: 'upkeepStep',
      turnNumber: 1,
      setup: { ...gameConfig.setup, firstPlayerDrawsOnFirstTurn: true },
    };
    expect(sm.transition(firstTurnDraw, 'stateDrawPhase')).toContainEqual({ type: 'DRAW_CARDS', playerId: 'player1', amount: 1 });

    const firstTurnSkip: GameRoom = {
      ...firstTurnDraw,
      setup: { ...gameConfig.setup, firstPlayerDrawsOnFirstTurn: false },
    };
    expect(sm.transition(firstTurnSkip, 'stateDrawPhase')).not.toContainEqual({ type: 'DRAW_CARDS', playerId: 'player1', amount: 1 });

    const missingPlayer: GameRoom = { ...room, phase: 'upkeepStep', turnNumber: 2, activeTurnPlayerId: 'ghost' as never };
    expect(sm.transition(missingPlayer, 'stateDrawPhase')).not.toContainEqual({ type: 'DRAW_CARDS' });

    // Absent bookkeeping falls back to the configured setup and the first turn.
    const bare: GameRoom = { ...room, phase: 'upkeepStep' };
    delete (bare as { setup?: unknown }).setup;
    delete (bare as { turnNumber?: number }).turnNumber;
    const bareDraw = sm.transition(bare, 'stateDrawPhase');
    expect(bareDraw).toContainEqual({ type: 'SET_PHASE', phase: 'stateDrawPhase' });
    expect(bareDraw.some((mutation) => mutation.type === 'DRAW_CARDS')).toBe(gameConfig.setup.firstPlayerDrawsOnFirstTurn);
  });
});

describe('StateMachine planning', () => {
  it('plans the next phase and hands priority to the active player', () => {
    const room = createTestRoom();
    const step = machine(room).planNextStep(room);
    expect(step).toMatchObject({ phase: 'beginCombatStep', needsInput: true, priorityPlayerId: 'player1' });
    expect(step!.mutations).toContainEqual({ type: 'SET_PHASE', phase: 'beginCombatStep' });
  });

  it('skips blockers and damage when attackers were declared empty', () => {
    const room = createTestRoom();
    const declared: GameRoom = { ...room, phase: 'declareAttackersStep', combatDeclarations: { attackers: true }, combat: [] };
    expect(machine(room).planNextStep(declared)?.phase).toBe('endCombatStep');
  });

  it('leaves priority unassigned while a turn-based declaration is pending', () => {
    const room = createTestRoom();
    const step = machine(room).planNextStep({ ...room, phase: 'declareAttackersStep' });
    expect(step).toMatchObject({ needsInput: true, priorityPlayerId: null });
  });

  it('advances into a new turn and pre-applies the turn switch when the sequence wraps', () => {
    const room = createTestRoom();
    const step = machine(room).planNextStep({ ...room, phase: 'cleanupStep' })!;
    expect(step.phase).toBe('stateTurnStart');
    expect(step.needsInput).toBe(false);
    expect(step.mutations).toContainEqual({ type: 'SET_TURN', playerId: 'player2', advance: true });
    // The untap mutations were planned against the switched room.
    expect(step.mutations.some((mutation) => mutation.type === 'SET_PHASE' && mutation.phase === 'stateTurnStart')).toBe(true);
  });

  it('returns null when the turn sequence has no successor', () => {
    const room = createTestRoom();
    expect(machine(room).planNextStep({ ...room, phase: 'bogus' as never })).toBeNull();
  });

  it('jumps straight to the end step and forces the phase when the sequence cannot reach it', () => {
    const room = createTestRoom();
    const step = machine(room).planNextStep(room, 'skipToEnd')!;
    expect(step.phase).toBe('stateEndPhase');
    expect(step.mutations).toEqual([
      { type: 'CLEAR_COMBAT' },
      { type: 'SET_PHASE', phase: 'stateEndPhase' },
    ]);
  });

  it('uses the normal transition when the end step is already next', () => {
    const room = createTestRoom();
    const step = machine(room).planNextStep({ ...room, phase: 'postcombatMainPhase' }, 'skipToEnd')!;
    expect(step.phase).toBe('stateEndPhase');
    expect(step.mutations).toEqual([{ type: 'SET_PHASE', phase: 'stateEndPhase' }]);
  });

  it('treats skip-to-end during the end step itself as a normal advance', () => {
    const room = createTestRoom();
    const step = machine(room).planNextStep({ ...room, phase: 'stateEndPhase' }, 'skipToEnd')!;
    expect(step.phase).toBe('cleanupStep');
  });
});

describe('StateMachine turn, priority and stack helpers', () => {
  it('switches to whichever player is not active', () => {
    const room = createTestRoom();
    const sm = machine(room);
    expect(sm.switchTurn(room)).toEqual([{ type: 'SET_TURN', playerId: 'player2', advance: true }]);
    expect(sm.switchTurn({ ...room, activeTurnPlayerId: 'player2' })).toEqual([
      { type: 'SET_TURN', playerId: 'player1', advance: true },
    ]);
  });

  it('reports turn ownership', () => {
    const room = createTestRoom();
    expect(machine(room).isPlayerTurn(room, 'player1')).toBe(true);
    expect(machine(room).isPlayerTurn(room, 'player2')).toBe(false);
  });

  it('grants priority together with a waiting engine state', () => {
    expect(machine(createTestRoom()).givePriorityTo('player2')).toEqual([
      { type: 'SET_PRIORITY', playerId: 'player2' },
      { type: 'SET_ENGINE_STATE', state: 'waiting_for_player' },
    ]);
  });

  it('refuses a priority pass from a player who does not hold priority', () => {
    const room = createTestRoom();
    expect(machine(room).passPriority(room, 'player2')).toEqual({ success: false, mutations: [] });
  });

  it('resolves the top of the stack once both players have passed', () => {
    const room = createTestRoom();
    const stacked: GameRoom = { ...room, stack: [{ uuid: 'obj' } as never], lastPassedPlayerId: 'player2' };
    expect(machine(room).passPriority(stacked, 'player1')).toEqual({
      success: true,
      continuation: 'resolve',
      mutations: [
        { type: 'SET_PRIORITY', playerId: null },
        { type: 'SET_LAST_PASSED', playerId: null },
        { type: 'SET_ENGINE_STATE', state: 'resolving_stack' },
      ],
    });
  });

  it('advances the phase once both players have passed an empty stack', () => {
    const room = createTestRoom();
    const idle: GameRoom = { ...room, lastPassedPlayerId: 'player2' };
    expect(machine(room).passPriority(idle, 'player1')).toEqual({
      success: true,
      continuation: 'advance',
      mutations: [
        { type: 'SET_PRIORITY', playerId: null },
        { type: 'SET_LAST_PASSED', playerId: null },
      ],
    });
  });

  it('passes priority to the opponent for the first pass', () => {
    const room = createTestRoom();
    expect(machine(room).passPriority(room, 'player1')).toEqual({
      success: true,
      continuation: 'none',
      mutations: [
        { type: 'SET_LAST_PASSED', playerId: 'player1' },
        { type: 'SET_PRIORITY', playerId: 'player2' },
        { type: 'SET_ENGINE_STATE', state: 'waiting_for_player' },
      ],
    });
  });

  it('treats the second player as the opponent of a player2 pass', () => {
    const room = createTestRoom();
    const asPlayer2: GameRoom = { ...room, activeTurnPlayerId: 'player2', priorityPlayerId: 'player2' };
    const pass = machine(room).passPriority(asPlayer2, 'player2');
    expect(pass).toMatchObject({ success: true, continuation: 'none' });
    expect(pass.mutations).toContainEqual({ type: 'SET_PRIORITY', playerId: 'player1' });
  });

  it('gives priority to the controller of a newly added stack object', () => {
    const room = createTestRoom();
    expect(machine(room).addToStack(room, { controllerId: 'player2' } as never)).toEqual([
      { type: 'SET_PRIORITY', playerId: 'player2' },
      { type: 'SET_ENGINE_STATE', state: 'waiting_for_player' },
    ]);
  });
});
