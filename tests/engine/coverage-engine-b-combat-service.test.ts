import { describe, expect, it } from 'vitest';
import { answerCombatDamage, damageRecipientKey, startCombatDamage } from '@engine/combat-service';
import { gameReducer } from '@engine/game-reducer';
import type { PendingChoice } from '@shared/choice.types';
import type { GameMutation } from '@shared/game-mutation.types';
import type { GameRoom } from '@shared/game.room.types';
import { createTestRoom } from '../helpers/test-room-factory';
import { combatRoom, creature } from '../helpers/combat-fixture';

const playerRecipient = { kind: 'player', playerId: 'player2' } as const;

function promptPlan(room: GameRoom) {
  const plan = startCombatDamage(room);
  if (plan.kind !== 'prompt') throw new Error(`expected a prompt, received ${plan.kind}`);
  return plan;
}

/** Apply the plan's state mutation so a later answer sees the open damage step. */
function openStep(room: GameRoom, mutations: GameMutation[]): GameRoom {
  return mutations
    .filter((mutation) => mutation.type === 'SET_COMBAT_DAMAGE')
    .reduce((working, mutation) => gameReducer(working, mutation), room);
}

describe('damageRecipientKey', () => {
  it('keys players and permanents distinctly', () => {
    expect(damageRecipientKey(playerRecipient)).toBe('player:player2');
    expect(damageRecipientKey({ kind: 'permanent', cardUuid: 'a', zoneRevision: 3 })).toBe('permanent:a:3');
  });
});

describe('startCombatDamage', () => {
  it('asks an unblocked attacker to assign damage to the defending player', () => {
    const attacker = creature('a', 'player1', 3, 3);
    const plan = promptPlan(combatRoom(createTestRoom(), attacker));
    expect(plan.choice).toMatchObject({
      playerId: 'player1',
      kind: 'distribution',
      total: 3,
      prompt: 'Assign combat damage from a',
      continuation: { type: 'combat', sourceUuid: 'a', passIndex: 0 },
    });
    expect(plan.choice.options).toEqual([
      { id: 'player:player2', value: playerRecipient, label: 'player2' },
    ]);
    expect(plan.mutations).toContainEqual({ type: 'SET_ENGINE_STATE', state: 'waiting_for_player' });
  });

  it('routes a blocked attacker at its blockers and each blocker at the attacker', () => {
    const attacker = creature('a', 'player1', 4, 4);
    const blocker = creature('b', 'player2', 2, 3);
    const plan = promptPlan(combatRoom(createTestRoom(), attacker, [blocker]));
    // The active player assigns first.
    expect(plan.choice.playerId).toBe('player1');
    expect(plan.choice.options).toEqual([{ id: 'permanent:b:0', value: { kind: 'permanent', cardUuid: 'b', zoneRevision: 0 }, label: 'b' }]);

    const state = plan.mutations.find((mutation) => mutation.type === 'SET_COMBAT_DAMAGE');
    expect(state).toMatchObject({
      state: {
        requests: [
          { declarationUuid: 'a', role: 'attacker', total: 4 },
          { declarationUuid: 'a', role: 'blocker', total: 2 },
        ],
      },
    });
  });

  it('adds the defending player to a blocked trampler', () => {
    const attacker = creature('a', 'player1', 5, 5, ['Trample']);
    const blocker = creature('b', 'player2', 2, 2);
    const plan = promptPlan(combatRoom(createTestRoom(), attacker, [blocker]));
    expect(plan.choice.options.map((option) => option.id)).toEqual(['permanent:b:0', 'player:player2']);
  });

  it('ignores creatures that cannot deal damage and rooms without a defender', () => {
    const harmless = creature('a', 'player1', 0, 4);
    expect(startCombatDamage(combatRoom(createTestRoom(), harmless)).kind).toBe('complete');

    const room = createTestRoom();
    const attacker = creature('a', 'player1', 2, 2);
    const defenderless = combatRoom({ ...room, player2Id: undefined as never }, attacker);
    expect(startCombatDamage(defenderless).kind).toBe('complete');
  });

  it('treats a permanent without a recorded revision as the first incarnation', () => {
    const attacker = creature('a', 'player1', 4, 4);
    const blocker = creature('b', 'player2', 2, 3);
    delete (blocker.state as { zoneRevision?: number }).zoneRevision;
    const plan = promptPlan(combatRoom(createTestRoom(), attacker, [blocker]));
    expect(plan.choice.options[0].value).toEqual({ kind: 'permanent', cardUuid: 'b', zoneRevision: 0 });
  });

  it('defends the player whose turn is not active', () => {
    const attacker = creature('a', 'player2', 3, 3);
    const room = { ...createTestRoom(), activeTurnPlayerId: 'player2' };
    const plan = promptPlan(combatRoom(room, attacker));
    expect(plan.choice.options[0].value).toEqual({ kind: 'player', playerId: 'player1' });
  });

  it('completes immediately when there is no combat', () => {
    const plan = startCombatDamage(createTestRoom());
    expect(plan.kind).toBe('complete');
    expect(plan.mutations).toEqual([
      { type: 'SET_COMBAT_DAMAGE', state: { passes: ['normal'], passIndex: 0, completed: true, allocations: {}, requests: [] } },
      { type: 'SET_PENDING_CHOICE', choice: null },
      { type: 'SET_PENDING_TRIGGERS', mutations: [] },
      { type: 'SET_LAST_PASSED', playerId: null },
    ]);
  });

  it('advances to the next pass of an open damage step', () => {
    const attacker = creature('a', 'player1', 2, 2);
    const base = combatRoom(createTestRoom(), attacker);
    const room: GameRoom = {
      ...base,
      combatDamage: { passes: ['first', 'second'], passIndex: 0, completed: true, allocations: {}, requests: [] },
    };
    const plan = startCombatDamage(room, true);
    expect(plan.kind).toBe('prompt');
    expect(plan.kind === 'prompt' && plan.choice.continuation).toMatchObject({ type: 'combat', passIndex: 1 });
  });

  it('keeps the recorded pass list when advancing', () => {
    const attacker = creature('a', 'player1', 2, 2);
    const room = combatRoom(createTestRoom(), attacker);
    const plan = startCombatDamage({ ...room, combatDamage: { passes: ['only'], passIndex: 0, completed: true, allocations: {}, requests: [] } }, true);
    expect(plan.kind).toBe('prompt');
    expect(plan.kind === 'prompt' && plan.choice.continuation).toMatchObject({ type: 'combat', passIndex: 1 });
  });
});

describe('answerCombatDamage', () => {
  function open(attackerKeywords: string[] = [], blocker?: ReturnType<typeof creature>) {
    const attacker = creature('a', 'player1', 5, 5, attackerKeywords);
    const room = combatRoom(createTestRoom(), attacker, blocker ? [blocker] : []);
    const plan = promptPlan(room);
    return { room: openStep(room, plan.mutations), choice: plan.choice };
  }

  it('rejects an answer that belongs to a different step', () => {
    const { room, choice } = open();
    const allocations = { 'player:player2': 5 };
    expect(answerCombatDamage(room, { ...choice, continuation: { type: 'action' } } as unknown as PendingChoice, { values: [], allocations })).toEqual({
      kind: 'reject',
      error: 'Combat damage choice is stale',
    });
    expect(answerCombatDamage({ ...room, combatDamage: null }, choice, { values: [], allocations })).toEqual({ kind: 'reject', error: 'Combat damage choice is stale' });
    expect(answerCombatDamage({ ...room, combatDamage: { ...room.combatDamage!, completed: true } }, choice, { values: [], allocations })).toEqual({
      kind: 'reject',
      error: 'Combat damage choice is stale',
    });
    expect(answerCombatDamage({ ...room, combatDamage: { ...room.combatDamage!, passIndex: 4 } }, choice, { values: [], allocations })).toEqual({
      kind: 'reject',
      error: 'Combat damage choice is stale',
    });
    expect(answerCombatDamage(room, choice, { values: [] })).toEqual({ kind: 'reject', error: 'Combat damage choice is stale' });
  });

  it('rejects an answer whose plan no longer matches the room', () => {
    const { room, choice } = open();
    const stronger: GameRoom = { ...room, battlefield: room.battlefield.map((card) => ({ ...card, blueprint: { ...card.blueprint, power: 9 } })) };
    expect(answerCombatDamage(stronger, choice, { values: [], allocations: { 'player:player2': 5 } })).toEqual({
      kind: 'reject',
      error: 'Combat damage plan is stale',
    });
  });

  it('rejects an answer for an already assigned or unknown source', () => {
    const { room, choice } = open();
    const assigned: GameRoom = { ...room, combatDamage: { ...room.combatDamage!, allocations: { a: { 'player:player2': 5 } } } };
    expect(answerCombatDamage(assigned, choice, { values: [], allocations: { 'player:player2': 5 } })).toEqual({
      kind: 'reject',
      error: 'Combat damage source is stale',
    });
    const unknown = { ...choice, continuation: { ...choice.continuation, sourceUuid: 'other' } } as PendingChoice;
    expect(answerCombatDamage(room, unknown, { values: [], allocations: { 'player:player2': 5 } })).toEqual({
      kind: 'reject',
      error: 'Combat damage source is stale',
    });
  });

  it('rejects a trample allocation that skips lethal blocker damage', () => {
    const { room, choice } = open(['Trample'], creature('b', 'player2', 2, 4));
    expect(answerCombatDamage(room, choice, { values: [], allocations: { 'permanent:b:0': 1, 'player:player2': 4 } })).toEqual({
      kind: 'reject',
      error: 'Trample requires lethal damage assigned to each blocker before player damage',
    });
  });

  it('records the allocation and completes or continues the step', () => {
    const { room, choice } = open();
    const completed = answerCombatDamage(room, choice, { values: [], allocations: { 'player:player2': 5 } });
    expect(completed.kind).toBe('complete');
    expect(completed.mutations).toContainEqual({
      type: 'SET_COMBAT_DAMAGE',
      state: { ...room.combatDamage!, completed: true, allocations: { a: { 'player:player2': 5 } } },
    });

    // With two pending sources the answer opens the next prompt.
    const blocked = open(['Trample'], creature('b', 'player2', 2, 4));
    const next = answerCombatDamage(blocked.room, blocked.choice, { values: [], allocations: { 'permanent:b:0': 4, 'player:player2': 1 } });
    expect(next.kind).toBe('prompt');
    expect(next.kind === 'prompt' && next.choice.playerId).toBe('player2');

    // Allocating nothing to any recipient records no damage but still closes the source.
    const empty = answerCombatDamage(room, choice, { values: [], allocations: {} });
    expect(empty.kind).toBe('complete');
    expect(empty.mutations).toEqual([
      { type: 'SET_COMBAT_DAMAGE', state: { ...room.combatDamage!, completed: true, allocations: { a: {} } } },
      { type: 'SET_PENDING_CHOICE', choice: null },
      { type: 'SET_PENDING_TRIGGERS', mutations: [] },
      { type: 'SET_LAST_PASSED', playerId: null },
    ]);
  });
});
