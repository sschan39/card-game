import { describe, expect, it } from 'vitest';
import { GameEngine } from '../../src/engine/game-engine';
import { creature } from '../helpers/combat-fixture';
import { createTestRoom } from '../helpers/test-room-factory';
import type { CardInstance } from '../../src/types/card.types';

describe('combat damage from ordinary declarations', () => {
  function setup(attacker: CardInstance, blockers: CardInstance[] = []) {
    const engine = new GameEngine(createTestRoom({ phase: 'declareAttackersStep', priorityPlayerId: null, battlefield: [attacker, ...blockers] }));
    engine.initRoom();
    expect(engine.executePlayerAction('player1', 'declare_attackers', { attackers: [{ cardUuid: attacker.uuid }] }).success).toBe(true);
    engine.passPriority('player1'); engine.passPriority('player2');
    expect(engine.executePlayerAction('player2', 'declare_blockers', { assignments: [{ attackerUuid: attacker.uuid, blockerUuids: blockers.map(card => card.uuid) }] }).success).toBe(true);
    engine.passPriority('player1'); engine.passPriority('player2');
    return engine;
  }
  function assign(engine: GameEngine, decisions: Record<string, Record<string, number>>) {
    while (engine.roomState.pendingChoice?.continuation.type === 'combat') {
      const choice = engine.roomState.pendingChoice;
      const distribution = decisions[choice.continuation.sourceUuid];
      if (!distribution) throw new Error('Missing explicit test allocation');
      const allocations = Object.fromEntries(Object.entries(distribution).map(([recipient, amount]) => {
        const option = choice.options.find(option => option.label === recipient);
        if (!option) throw new Error('Invalid test recipient');
        return [option.id, amount];
      }));
      expect(engine.executePlayerAction(choice.playerId, 'choose', { choiceId: choice.id, allocations }).success).toBe(true);
    }
  }

  it('unblocked damage waits for its controller and preserves source/controller data', () => {
    const engine = setup(creature('a', 'player1', 3, 4));
    expect(engine.roomState.players.player2.life).toBe(20);
    assign(engine, { a: { player2: 3 } });
    expect(engine.roomState.players.player2.life).toBe(17);
    const event = engine.drainEventBatches().flatMap(batch => batch.events).find(event => event.eventId === 'DAMAGE_DEALT')!;
    expect(event.payload).toMatchObject({ source: 'a', controllerId: 'player1', amount: 3, combat: true, recipient: { playerId: 'player2' } });
  });

  it('all blockers deal counter-damage even when the attacker assigns only to one', () => {
    const engine = setup(creature('a', 'player1', 1, 9), [creature('b', 'player2', 1, 1), creature('c', 'player2', 2, 4)]);
    assign(engine, { a: { b: 1 }, b: { a: 1 }, c: { a: 2 } });
    expect(engine.roomState.battlefield.find(card => card.uuid === 'a')!.state.damageTaken).toBe(3);
    expect(engine.roomState.battlefield.find(card => card.uuid === 'c')!.state.damageTaken).toBe(0);
    expect(engine.roomState.players.player2.graveyard.map(card => card.uuid)).toEqual(['b']);
  });

  it('applies mutual destruction before cleanup and discovers death triggers', () => {
    const blocker = creature('b', 'player2', 1, 1);
    blocker.blueprint = { ...blocker.blueprint, abilities: [{ type: 'triggered', id: 'test-death', triggerCondition: 'ON_DIE', castSpeed: 'instant',
      effect: { action: 'MODIFY_LIFE', params: { amount: 1 }, targeting: { type: 'self', required: false } } }] };
    const engine = setup(creature('a', 'player1', 1, 1), [blocker]);
    assign(engine, { a: { b: 1 }, b: { a: 1 } });
    expect(engine.phase).toBe('combatDamageStep');
    expect(engine.roomState.battlefield).toEqual([]);
    expect(engine.roomState.players.player1.graveyard.map(card => card.uuid)).toEqual(['a']);
    expect(engine.roomState.players.player2.graveyard.map(card => card.uuid)).toEqual(['b']);
    expect(engine.roomState.stack).toHaveLength(1);
    expect(engine.roomState.stack[0].source.uuid).toBe('b');
    expect(engine.roomState.stack[0].sourceInfo?.card.state.damageTaken).toBe(1);
  });

  it('uses marked damage for Trample lethal assignment', () => {
    const blocker = creature('b', 'player2', 0, 4); blocker.state.damageTaken = 3;
    const engine = setup(creature('a', 'player1', 5, 5, ['Trample']), [blocker]);
    assign(engine, { a: { b: 1, player2: 4 } });
    expect(engine.roomState.players.player2.life).toBe(16);
    expect(engine.roomState.players.player2.graveyard.map(card => card.uuid)).toEqual(['b']);
  });

  it('allows deliberate overassignment without discarding unused power', () => {
    const engine = setup(creature('a', 'player1', 5, 9), [creature('b', 'player2', 1, 1), creature('c', 'player2', 1, 1)]);
    assign(engine, { a: { b: 4, c: 1 }, b: { a: 1 }, c: { a: 1 } });
    expect(engine.roomState.players.player2.graveyard).toHaveLength(2);
    const batch = engine.drainEventBatches().flatMap(batch => batch.mutations).find(m => m.type === 'APPLY_DAMAGE_BATCH')!;
    if (batch.type !== 'APPLY_DAMAGE_BATCH') throw new Error('fixture');
    expect(batch.assignments.filter(assignment => assignment.source.card.uuid === 'a').map(assignment => assignment.amount)).toEqual([4, 1]);
  });

  it('permits different distributions independently of the defender pairing order', () => {
    const engine = setup(creature('a', 'player1', 5, 9), [creature('c', 'player2', 0, 4), creature('b', 'player2', 0, 6)]);
    assign(engine, { a: { b: 3, c: 2 } });
    expect(engine.roomState.battlefield.find(card => card.uuid === 'b')!.state.damageTaken).toBe(3);
    expect(engine.roomState.battlefield.find(card => card.uuid === 'c')!.state.damageTaken).toBe(2);
  });
});
