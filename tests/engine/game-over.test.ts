import { answerSingleRecipientCombat } from '../helpers/combat-fixture';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as sba from '../../src/engine/state-based-actions';
import { GameEngine } from '../../src/engine/game-engine';
import { gameReducer } from '../../src/engine/game-reducer';
import { OptionService } from '../../src/engine/option-service';
import { SyncService } from '../../src/server/sync-service';
import { applyDeltaChanges } from '../../src/client/store/deltaReducer';
import { instantiateCard } from '../../src/library/card-factory';
import { createTestRoom } from '../helpers/test-room-factory';
import type { GameRoom } from '../../src/types/game.room.types';

describe('terminal game processing', () => {
  let room: GameRoom;
  beforeEach(() => {
    room = createTestRoom();
    // A bounded watchdog keeps the known synchronous SBA loop from hanging
    // Vitest. All checks use the real implementation; only repetition throws.
    const realCheck = sba.checkStateBasedActions;
    let checks = 0;
    vi.spyOn(sba, 'checkStateBasedActions').mockImplementation((state) => {
      if (++checks > 30) throw new Error('SBA failed to converge');
      return realCheck(state);
    });
  });
  afterEach(() => vi.restoreAllMocks());

  it('does not repeat lethal SBA after reducing the first result', () => {
    room.players.player2.life = 0;
    const ended = sba.checkStateBasedActions(room).reduce(gameReducer, room);
    expect(ended.status).toBe('gameOver');
    expect(sba.checkStateBasedActions(ended)).toEqual([]);
  });

  it.each(['player1', 'player2'])('records the opponent as winner when %s loses', (loser) => {
    room.players[loser].life = -1;
    const engine = new GameEngine(room);
    const mutations = engine.applyMutations([]);
    expect(mutations.filter(m => m.type === 'END_GAME')).toHaveLength(1);
    expect(engine.roomState.outcome).toEqual({
      type: 'win', winnerId: loser === 'player1' ? 'player2' : 'player1',
      losses: [{ playerId: loser, reason: 'life_total' }],
    });
    expect(engine.roomState).toMatchObject({ priorityPlayerId: null, lastPassedPlayerId: null, engineState: 'game_over' });
  });

  it('finishes a simultaneous batch before declaring a draw', () => {
    const engine = new GameEngine(room);
    engine.applyMutations([
      { type: 'SET_LIFE', playerId: 'player2', amount: -3 },
      { type: 'SET_LIFE', playerId: 'player1', amount: 0 },
    ]);
    expect(engine.roomState.outcome).toEqual({ type: 'draw', losses: [
      { playerId: 'player1', reason: 'life_total' }, { playerId: 'player2', reason: 'life_total' },
    ] });
  });

  it('does not end on a transient zero life inside one ordinary batch', () => {
    const engine = new GameEngine(room);
    engine.applyMutations([
      { type: 'SET_LIFE', playerId: 'player1', amount: 0 },
      { type: 'SET_LIFE', playerId: 'player1', amount: 1 },
    ]);
    expect(engine.status).toBe('playing');
    expect(engine.roomState.outcome).toBeUndefined();
  });

  it('resolves lethal fireball on consecutive passes without restoring priority', () => {
    const spell = instantiateCard('broken-fireball');
    Object.assign(spell.state, { zone: 'hand', ownerId: 'player1', controllerId: 'player1' });
    room.players.player1.hand.push(spell);
    room.players.player2.life = 3;
    const engine = new GameEngine(room);
    expect(engine.proposeAndStack('player1', 'cast_spell', {
      cardUuid: spell.uuid, targets: [{ targetType: 'player', playerId: 'player2' }],
    }).success).toBe(true);
    engine.passPriority('player1');
    const result = engine.passPriority('player2');
    expect(result.success).toBe(true);
    expect(engine.roomState).toMatchObject({ status: 'gameOver', priorityPlayerId: null, engineState: 'game_over' });
    expect(engine.roomState.players.player1.graveyard.some(c => c.uuid === spell.uuid)).toBe(true);
    expect(engine.roomState.stack).toEqual([]);
    expect(result.mutations.at(-1)?.type).toBe('END_GAME');
  });

  it('stops lethal combat at its phase without cleanup, turn, or later phase events', () => {
    const attacker = instantiateCard('empire-servant');
    Object.assign(attacker.state, { zone: 'battlefield', ownerId: 'player1', controllerId: 'player1', isTapped: true });
    room.battlefield.push(attacker);
    room.phase = 'declareBlockersStep';
    room.combatDeclarations = { attackers: true, blockers: true };
    room.players.player2.life = 1;
    room.combat = [{ uuid: attacker.uuid, attacker, attackerPower: 1, blockers: [] }];
    const engine = new GameEngine(room);
    const emit = vi.spyOn((engine as any).eventBus, 'emit');
    const mutations = engine.advancePhase('complete');
    mutations.push(...answerSingleRecipientCombat(engine));
    expect(engine.roomState).toMatchObject({ status: 'gameOver', phase: 'combatDamageStep', activeTurnPlayerId: 'player1' });
    expect(engine.roomState.combat).toHaveLength(1);
    expect(engine.roomState.battlefield[0].state.isTapped).toBe(true);
    expect(mutations.some(m => m.type === 'CLEAR_DAMAGE' || m.type === 'SET_TURN')).toBe(false);
    expect(emit.mock.calls.some(([event]) => ['TURN_STARTED', 'COMBAT_ENDED', 'TURN_SWITCHED'].includes(event.eventId))).toBe(false);
  });

  it('keeps an ended room stable across public actions and raw mutations', () => {
    room.status = 'gameOver';
    const engine = new GameEngine(room);
    const before = structuredClone(room);
    engine.mutationCollector.push({ type: 'SET_LIFE', playerId: 'player2', amount: 12 });
    expect(engine.handleAction('player1', 'cast_spell', {})).toMatchObject({ success: false, reason: 'Game is over' });
    expect(engine.proposeAndStack('player1', 'cast_spell', {})).toMatchObject({ success: false, reason: 'Game is over' });
    expect(engine.resolveTopOfStack()).toMatchObject({ success: false, reason: 'Game is over' });
    expect(engine.passPriority('player1').success).toBe(false);
    for (const result of [engine.advancePhase('complete'), engine.advancePhase('skipToEnd'), engine.switchTurn(),
      engine.transition('beginCombatStep'), engine.givePriorityTo('player1'), engine.applyMutations([{ type: 'SET_STATUS', status: 'playing' }])]) {
      expect(result).toEqual([]);
    }
    expect(engine.isPlayerTurn('player1')).toBe(false);
    expect(engine.roomState).toEqual(before);
    expect(gameReducer(room, { type: 'SET_STATUS', status: 'playing' })).toBe(room);
    expect(new OptionService().getOptions(room, 'player1', room.players.player1.hand[0].uuid, 'hand')).toEqual([]);
  });

  it('drops queued trigger work when lethal ends the batch', () => {
    const engine = new GameEngine(room);
    engine.mutationCollector.push({ type: 'SET_LIFE', playerId: 'player2', amount: 20 });
    engine.applyMutations([{ type: 'SET_LIFE', playerId: 'player2', amount: 0 }]);
    expect(engine.status).toBe('gameOver');
    expect(engine.roomState.players.player2.life).toBe(0);
    expect(engine.mutationCollector).toEqual([]);
  });

  it.each([false, true])('replays terminal outcome and priority changes to both clients (draw=%s)', (draw) => {
    room.lastPassedPlayerId = 'player2';
    const engine = new GameEngine(room);
    const mutations = engine.applyMutations([
      { type: 'SET_LIFE', playerId: 'player2', amount: 0 },
      ...(draw ? [{ type: 'SET_LIFE' as const, playerId: 'player1', amount: 0 }] : []),
    ]);
    const service = new SyncService({} as any);
    const delta = service.buildDelta(room, mutations, { action: 'damage', playerId: 'player1' });
    for (const playerId of ['player1', 'player2']) {
      const next = applyDeltaChanges(room, service.filterForPlayer(delta, playerId, engine.roomState).changes);
      expect(next).toEqual(engine.roomState);
    }
    expect(engine.applyMutations([])).toEqual([]);
    const ending = mutations.find(m => m.type === 'END_GAME')!;
    expect(gameReducer(engine.roomState, ending)).toBe(engine.roomState);
    expect(service.buildDelta(engine.roomState, [ending], { action: 'repeat', playerId: 'player1' }).changes).toEqual([]);
  });
});
