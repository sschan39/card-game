import { describe, expect, it } from 'vitest';
import { GameEngine } from '@engine/game-engine';
import { UnpaidMaterialCost } from '@engine/proposed-events';
import { gameConfig } from '@config';
import { createTestRoom, fillTestLibraries } from '../helpers/test-room-factory';
import { creature } from '../helpers/combat-fixture';
import type { GameRoom } from '@shared/game.room.types';

function setup(): { room: GameRoom; engine: GameEngine } {
  const room = createTestRoom({ phase: 'stateMainPhase', priorityPlayerId: 'player1', activeTurnPlayerId: 'player1' });
  fillTestLibraries(room);
  const engine = new GameEngine(room);
  engine.initRoom();
  return { room, engine };
}

describe('game engine command guards and logging', () => {
  it('rejects empty action ids and concession without an opponent', () => {
    const { engine } = setup();
    try {
      expect(engine.executePlayerAction('player1', '', {})).toEqual({
        success: false, phase: 'validate', reason: 'actionId must be a nonempty string',
      });
      expect(engine.executePlayerAction('player1', 'concede', {})).toMatchObject({ success: true });
      const second = setup();
      second.room.player2Id = '';
      expect(second.engine.executePlayerAction('player1', 'concede', {})).toEqual({
        success: false, phase: 'validate', reason: 'No active opponent to concede to',
      });
      const third = setup();
      expect(third.engine.executePlayerAction('player2', 'concede', {}).success).toBe(true);
      third.engine.dispose();
      second.engine.dispose();
    } finally {
      engine.dispose();
    }
  });

  it('falls back to applied-event logging for accepted commands', () => {
    const { engine } = setup();
    const actions = gameConfig.logging.actions;
    const appliedEvents = gameConfig.logging.appliedEvents;
    gameConfig.logging.actions = false;
    gameConfig.logging.appliedEvents = true;
    try {
      expect(engine.executePlayerAction('player1', 'pass_priority', {}).success).toBe(true);
    } finally {
      gameConfig.logging.actions = actions;
      gameConfig.logging.appliedEvents = appliedEvents;
      engine.dispose();
    }
  });

  it('queues mutations instead of opening a nested rules checkpoint', () => {
    const { engine } = setup();
    const bus = (engine as unknown as { eventBus: { on(id: string, listener: () => void): void; off(id: string, listener: () => void): void } }).eventBus;
    let reentered = false;
    const listener = () => {
      if (reentered) return;
      reentered = true;
      expect(engine.applyMutations([{ type: 'SET_LAST_PASSED', playerId: 'player1' }])).toEqual([]);
    };
    bus.on('MUTATION_APPLIED', listener);
    try {
      engine.applyMutations([{ type: 'SET_LAST_PASSED', playerId: 'player1' }]);
      expect(reentered).toBe(true);
    } finally {
      bus.off('MUTATION_APPLIED', listener);
      engine.dispose();
    }
  });

  it('rechecks the command window when a choice is resumed', () => {
    const { room, engine } = setup();
    const card = room.players.player1.hand[0];
    card.blueprint = {
      ...card.blueprint,
      modes: [{ id: 'm', label: 'M', effects: [] }],
      modeCount: { min: 1, max: 1 },
      castRequirements: { ...card.blueprint.castRequirements, cost: { ...card.blueprint.castRequirements.cost, mana: {} } },
    };
    try {
      expect(engine.executePlayerAction('player1', 'cast_spell', { cardUuid: card.uuid }).success).toBe(true);
      const choice = engine.roomState.pendingChoice!;
      engine.roomState.status = 'RPS';
      expect(engine.executePlayerAction('player1', 'choose', { choiceId: choice.id, choices: ['m'] })).toEqual({
        success: false, phase: 'validate', reason: 'Action requires playing status',
      });
    } finally {
      engine.dispose();
    }
  });

  it('blocks handleAction during a combat declaration and maps unpaid materials', () => {
    const { room, engine } = setup();
    try {
      room.phase = 'declareAttackersStep';
      expect(engine.handleAction('player1', 'pass_priority', {})).toEqual({
        success: false, phase: 'validate', reason: 'Combat declaration is required',
      });

      room.phase = 'stateMainPhase';
      const land = creature('land', 'player1');
      land.blueprint = { ...land.blueprint, cardTypes: ['Land'] };
      land.state.zone = 'hand';
      room.players.player1.hand.push(land);
      const commits = (engine as unknown as { commits: { commit(...args: unknown[]): unknown } }).commits;
      const original = commits.commit;
      commits.commit = () => { throw new UnpaidMaterialCost(); };
      try {
        expect(engine.proposeAndStack('player1', 'play_land', { cardUuid: land.uuid, zoneRevision: 0 })).toEqual({
          success: false, phase: 'propose', reason: 'The selected material payment could not be completed',
        });
        commits.commit = () => { throw new Error('unexpected commit failure'); };
        expect(() => engine.proposeAndStack('player1', 'play_land', { cardUuid: land.uuid, zoneRevision: 0 })).toThrow('unexpected commit failure');
      } finally {
        commits.commit = original;
      }
    } finally {
      engine.dispose();
    }
  });
  it('resolves an activated mana ability immediately', () => {
    const { room, engine } = setup();
    try {
      const permanent = room.players.player1.hand[0];
      room.players.player1.hand = room.players.player1.hand.filter((entry) => entry.uuid !== permanent.uuid);
      permanent.state = { ...permanent.state, zone: 'battlefield', summoningSickness: false };
      room.battlefield.push(permanent);
      const before = engine.roomState.players.player1.mana.red;
      const result = engine.executePlayerAction('player1', 'tapForMana', { cardUuid: permanent.uuid });
      expect(result.success).toBe(true);
      expect(engine.roomState.players.player1.mana.red).toBe(before + 1);
    } finally {
      engine.dispose();
    }
  });

  it('resolves an immediate activated ability', () => {
    const { engine } = setup();
    try {
      const permanent = creature('immediate-source', 'player1');
      permanent.blueprint = {
        ...permanent.blueprint,
        abilities: [{
          id: 'jolt', type: 'activated', castSpeed: 'instant', immediate: true, cost: {},
          effect: { action: 'MODIFY_LIFE', params: { amount: 1 }, targeting: { type: 'self', required: false } },
        }],
      } as never;
      permanent.state = { ...permanent.state, zone: 'battlefield', summoningSickness: false };
      engine.roomState.battlefield.push(permanent);
      const before = engine.roomState.players.player1.life;
      expect(engine.executePlayerAction('player1', 'activate_ability', {
        cardUuid: permanent.uuid, abilityId: 'jolt',
      }).success).toBe(true);
      expect(engine.roomState.players.player1.life).toBe(before + 1);
    } finally {
      engine.dispose();
    }
  });

  it('routes a state-based lethal cleanup through the checkpoint', () => {
    const { engine } = setup();
    try {
      const victim = creature('victim', 'player1', 1, 1);
      engine.roomState.battlefield.push(victim);
      engine.applyMutations([{
        type: 'MARK_DAMAGE', cardUuid: victim.uuid, zoneRevision: victim.state.zoneRevision ?? 0, amount: 1,
      }]);
      expect(engine.roomState.battlefield.some((card) => card.uuid === victim.uuid)).toBe(false);
      expect(engine.roomState.players.player1.graveyard.some((card) => card.uuid === victim.uuid)).toBe(true);
    } finally {
      engine.dispose();
    }
  });

  it('resolves an immediate creature spell granted by a battlefield permanent', () => {
    const { engine } = setup();
    try {
      const enabler = creature('enabler', 'player1');
      enabler.blueprint = { ...enabler.blueprint, keywords: ['ImmediateFriendlyCreatures'] };
      enabler.state = { ...enabler.state, zone: 'battlefield' };
      engine.roomState.battlefield.push(enabler);
      const spell = creature('flash-creature', 'player1');
      spell.blueprint = {
        ...spell.blueprint,
        cardTypes: ['Creature'],
        castRequirements: { ...spell.blueprint.castRequirements, allowedZones: ['hand'], cost: { mana: {} } },
      };
      spell.state = { ...spell.state, zone: 'hand' };
      engine.roomState.players.player1.hand.push(spell);
      expect(engine.executePlayerAction('player1', 'cast_spell', { cardUuid: spell.uuid }).success).toBe(true);
      expect(engine.roomState.stack.some((object) => object.uuid === spell.uuid)).toBe(false);
      expect(engine.roomState.battlefield.some((card) => card.uuid === spell.uuid)).toBe(true);
    } finally {
      engine.dispose();
    }
  });

  it('commits an untriggered stack push without event UUIDs', () => {
    const { engine } = setup();
    try {
      const source = creature('pending-source', 'player1');
      engine.applyMutations([{
        type: 'PUSH_STACK',
        stackObject: { uuid: 'pending-spell', type: 'spell', controllerId: 'player1', source, effects: [], countered: false },
      } as never]);
      expect(engine.roomState.stack.some((object) => object.uuid === 'pending-spell')).toBe(true);
    } finally {
      engine.dispose();
    }
  });

  it('returns priority to the declaration while a trick resolves', () => {
    const { engine } = setup();
    try {
      const source = creature('trick-source', 'player1');
      engine.roomState.phase = 'declareBlockersStep';
      engine.roomState.priorityPlayerId = null;
      engine.roomState.stack.push({
        uuid: 'trick-stack', type: 'spell', controllerId: 'player1', source, effects: [], countered: false,
      } as never);
      const result = engine.resolveTopOfStack();
      expect(result.success).toBe(true);
      expect(engine.roomState.stack).toHaveLength(0);
      expect(engine.roomState.priorityPlayerId).toBeNull();
      expect(engine.roomState.engineState).toBe('waiting_for_player');
    } finally {
      engine.dispose();
    }
  });
});

describe('game engine transitions and accessors', () => {
  it('returns no mutations for a same-phase transition and guards a finished switch', () => {
    const { room, engine } = setup();
    const machine = (engine as unknown as { stateMachine: { transition(room: GameRoom, to: string): unknown[] } }).stateMachine;
    const original = machine.transition;
    machine.transition = () => [];
    try {
      expect(engine.transition('beginCombatStep')).toEqual([]);
    } finally {
      machine.transition = original;
    }
    room.status = 'gameOver';
    try {
      expect(engine.switchTurn()).toEqual([]);
      expect(engine.isPlayerTurn('player1')).toBe(false);
    } finally {
      engine.dispose();
    }
  });

  it('switches turns, reports turn ownership and exposes accessors', () => {
    const { engine } = setup();
    try {
      expect(engine.isPlayerTurn('player1')).toBe(true);
      expect(engine.isPlayerTurn('player2')).toBe(false);
      expect(engine.engineState).toBe(engine.roomState.engineState);
      expect(engine.activeTurnPlayerId).toBe(engine.roomState.activeTurnPlayerId);
      expect(engine.switchTurn().length).toBeGreaterThan(0);
      expect(engine.phase).toBe(engine.roomState.phase);
      expect(engine.status).toBe(engine.roomState.status);
    } finally {
      engine.dispose();
    }
  });

  it('returns an empty priority grant for an unchanged seat and blocks passing during combat', () => {
    const { room, engine } = setup();
    try {
      const priority = engine.priorityPlayerId!;
      expect(engine.givePriorityTo(priority)).toEqual([]);
      room.phase = 'declareAttackersStep';
      expect(engine.passPriority('player1')).toEqual({ success: false, mutations: [] });
    } finally {
      engine.dispose();
    }
  });

  it('advances a completed multi-pass damage step and re-grants priority', () => {
    const { room, engine } = setup();
    try {
      room.phase = 'combatDamageStep';
      room.combatDamage = {
        completed: true, passIndex: 0, passes: ['normal', 'second'], requests: [], allocations: {},
      } as never;
      const mutations = engine.advancePhase('complete');
      expect(mutations.length).toBeGreaterThan(0);
      expect(engine.priorityPlayerId).toBe('player1');

      room.combatDamage = {
        completed: true, passIndex: 1, passes: ['normal', 'second'], requests: [], allocations: {},
      } as never;
      expect(Array.isArray(engine.advancePhase('complete'))).toBe(true);
    } finally {
      engine.dispose();
    }
  });

  it('resolves an immediate land play and delegates an empty seat transition', () => {
    const { room, engine } = setup();
    try {
      const land = creature('played-land', 'player1');
      land.blueprint = { ...land.blueprint, cardTypes: ['Land'] };
      land.state.zone = 'hand';
      room.players.player1.hand.push(land);
      expect(engine.executePlayerAction('player1', 'play_land', { cardUuid: land.uuid, zoneRevision: 0 }).success).toBe(true);

      const machine = (engine as unknown as { stateMachine: { switchTurn(room: GameRoom): unknown[]; givePriorityTo(playerId: string): unknown[]; planNextStep(room: GameRoom, intent: string): undefined } }).stateMachine;
      const origSwitch = machine.switchTurn;
      const origPriority = machine.givePriorityTo;
      const origNext = machine.planNextStep;
      machine.switchTurn = () => [];
      machine.givePriorityTo = () => [];
      machine.planNextStep = () => undefined;
      try {
        expect(engine.switchTurn()).toEqual([]);
        expect(engine.givePriorityTo('player1')).toEqual([]);
        expect(engine.advancePhase('complete')).toEqual([]);
      } finally {
        machine.switchTurn = origSwitch;
        machine.givePriorityTo = origPriority;
        machine.planNextStep = origNext;
      }
    } finally {
      engine.dispose();
    }
  });

  it('skips command logging when every channel is disabled', () => {
    const { engine } = setup();
    const actions = gameConfig.logging.actions;
    const appliedEvents = gameConfig.logging.appliedEvents;
    gameConfig.logging.actions = false;
    gameConfig.logging.appliedEvents = false;
    try {
      expect(engine.executePlayerAction('player1', 'pass_priority', {}).success).toBe(true);
    } finally {
      gameConfig.logging.actions = actions;
      gameConfig.logging.appliedEvents = appliedEvents;
      engine.dispose();
    }
  });

  it('appends a successful stack resolution from the priority pass', () => {
    const { engine } = setup();
    const machine = (engine as unknown as {
      stateMachine: { passPriority(room: GameRoom, playerId: string): { success: boolean; mutations: unknown[]; continuation?: string } };
    }).stateMachine;
    const original = machine.passPriority;
    machine.passPriority = () => ({ success: true, mutations: [], continuation: 'resolve' });
    const resolve = (engine as unknown as { resolveTopOfStack(): { success: boolean; mutations: unknown[] } }).resolveTopOfStack;
    (engine as unknown as { resolveTopOfStack(): unknown }).resolveTopOfStack = () => ({ success: true });
    try {
      expect(engine.passPriority('player1').success).toBe(true);
      (engine as unknown as { resolveTopOfStack(): unknown }).resolveTopOfStack = () => ({ success: false, mutations: [] });
      expect(engine.passPriority('player1').success).toBe(true);
    } finally {
      machine.passPriority = original;
      (engine as unknown as { resolveTopOfStack(): unknown }).resolveTopOfStack = resolve;
      engine.dispose();
    }
  });
});
