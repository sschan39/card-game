import { answerSingleRecipientCombat } from '../helpers/combat-fixture';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GameEngine } from '../../src/engine/game-engine';
import { EventBus } from '../../src/engine/event-bus';
import { createDefaultActionRegistry } from '../../src/engine/default-action-registry';
import { OptionService } from '../../src/engine/option-service';
import { createRoom, joinRoom, setupRPS } from '../../src/engine/room-factory';
import { createTestRoom, fillTestLibraries } from '../helpers/test-room-factory';
import { instantiateCard } from '../../src/library/card-factory';
import type { GameRoom } from '../../src/types/game.room.types';

describe('player command boundary', () => {
  let room: GameRoom;
  let engine: GameEngine;

  beforeEach(() => {
    room = createTestRoom({ debugMode: 'flow' });
    fillTestLibraries(room);
    engine = new GameEngine(room);
    engine.initRoom();
  });
  afterEach(() => { engine.dispose(); vi.restoreAllMocks(); });

  function rejected(player: string, action: string, data: unknown = {}) {
    const before = structuredClone(engine.roomState);
    const collector = engine.mutationCollector.slice();
    const result = engine.executePlayerAction(player, action, data);
    expect(result.success).toBe(false);
    expect(engine.roomState).toEqual(before);
    expect(engine.mutationCollector).toEqual(collector);
    return result;
  }

  function cast() {
    const card = engine.roomState.players.player1.hand[0];
    expect(engine.executePlayerAction('player1', 'cast_spell', { cardUuid: card.uuid }).success).toBe(true);
    return card;
  }

  it.each(['off', 'stack', 'flow'] as const)('%s applies the debug resolution capability', mode => {
    room.debugMode = mode;
    const card = cast();
    if (mode === 'off') rejected('player2', 'resolve_stack');
    else {
      expect(engine.executePlayerAction('player2', 'resolve_stack').success).toBe(true);
      expect(engine.roomState.battlefield.some(c => c.uuid === card.uuid)).toBe(true);
      expect(engine.roomState.stack).toHaveLength(0);
      expect(engine.roomState.priorityPlayerId).toBe('player1');
    }
  });

  it.each(['off', 'stack', 'flow'] as const)('%s applies the debug end-turn capability', mode => {
    room.debugMode = mode;
    if (mode !== 'flow') rejected('player2', 'end_turn');
    else {
      expect(engine.executePlayerAction('player2', 'end_turn').success).toBe(true);
      expect(engine.roomState.activeTurnPlayerId).toBe('player2');
      expect(engine.roomState.phase).toBe('stateMainPhase');
    }
  });

  it('keeps the default in newly created rooms and legacy rooms', () => {
    expect(createRoom('new', 'a').debugMode).toBe('flow');
    delete room.debugMode;
    expect(engine.executePlayerAction('player2', 'end_turn').success).toBe(true);
  });

  it('does not discard stack objects on debug end turn', () => {
    cast();
    rejected('player2', 'end_turn');
  });

  it('rejects resolving an empty stack', () => { rejected('player1', 'resolve_stack'); });

  it.each([null, [], 'bad', 42])('rejects malformed action data %j before allocating a UUID', data => {
    const uuid = vi.spyOn(engine, 'generateUuid');
    rejected('player1', 'cast_spell', data);
    expect(uuid).not.toHaveBeenCalled();
  });

  it.each([
    ['declare_attackers', { attackers: 'bad' }],
    ['declare_attackers', { attackers: [null] }],
    ['declare_attackers', { attackers: [{ cardUuid: 5 }] }],
    ['declare_blockers', { assignments: [{ attackerUuid: 'a', blockerUuids: null }] }],
    ['declare_blockers', { assignments: [{ attackerUuid: 'a', blockerUuids: [5] }] }],
    ['cast_spell', { targets: 'bad' }],
    ['cast_spell', { targets: [null] }],
    ['cast_spell', { targets: [{ targetType: 'player' }] }],
    ['cast_spell', { targets: [{ targetType: 'unknown', playerId: 'player2' }] }],
    ['cast_spell', { targets: [{ targetType: 'player', playerId: 'player2', all: true, cardTypes: 'Creature' }] }],
    ['cast_spell', { targets: [{ targetType: 'player', playerId: 'player2', all: true }] }],
    ['cast_spell', { targets: [{ targetType: 'player', playerId: 'player2', all: 'yes' }] }],
    ['cast_spell', { cardUuid: {} }],
  ])('rejects unsafe %s payload %j', (action, data) => { rejected('player1', action, data); });

  it.each(['missing', 'toString', '__proto__'])('rejects unknown action %s safely', action => {
    rejected('player1', action);
  });

  it('requires a player record and a room slot', () => {
    rejected('missing', 'pass_priority');
    room.players.visitor = { ...room.players.player1, id: 'visitor' };
    rejected('visitor', 'resolve_stack');
    delete room.players.player1;
    rejected('player1', 'cast_spell', { cardUuid: 'missing' });
  });

  it.each(['waiting', 'RPS'] as const)('rejects ordinary actions while %s', status => {
    room.status = status;
    rejected('player1', 'pass_priority');
  });

  it.each(['resolving_stack', 'state_based_actions'] as const)('rejects commands while %s', state => {
    room.engineState = state;
    rejected('player1', 'end_turn');
    rejected('player1', 'cast_spell', { cardUuid: room.players.player1.hand[0].uuid });
  });

  it('keeps priority, mana and turn legality on ordinary actions', () => {
    room.priorityPlayerId = 'player2';
    rejected('player1', 'enter_battle');
    rejected('player1', 'pass_priority');
    rejected('player1', 'cast_spell', { cardUuid: room.players.player1.hand[0].uuid });
    room.priorityPlayerId = 'player1';
    room.players.player1.mana.red = 0;
    rejected('player1', 'cast_spell', { cardUuid: room.players.player1.hand[0].uuid });
  });

  it('routes combat declarations and mana through their existing handlers', () => {
    const attacker = instantiateCard('empire-servant');
    attacker.state = { ...attacker.state, zone: 'battlefield', ownerId: 'player1', controllerId: 'player1', summoningSickness: false };
    room.battlefield = [attacker];
    expect(engine.executePlayerAction('player1', 'tapForMana', { cardUuid: attacker.uuid }).success).toBe(true);
    engine.roomState.battlefield[0].state.isTapped = false;
    expect(engine.executePlayerAction('player1', 'enter_battle').success).toBe(true);
    engine.roomState.phase = 'declareAttackersStep';
    expect(engine.executePlayerAction('player1', 'declare_attackers', { attackers: [{ cardUuid: attacker.uuid }] }).success).toBe(true);
    expect(engine.roomState.phase).toBe('declareAttackersStep');
    engine.passPriority('player1'); engine.passPriority('player2');
    expect(engine.roomState.phase).toBe('declareBlockersStep');
    expect(engine.executePlayerAction('player2', 'declare_blockers', { assignments: [] }).success).toBe(true);
    expect(engine.roomState.phase).toBe('declareBlockersStep');
    engine.passPriority('player1'); engine.passPriority('player2');
    answerSingleRecipientCombat(engine);
    expect(engine.roomState.players.player2.life).toBe(19);
  });

  it('applies RPS choices without the normal stack and rejects duplicate choices', () => {
    engine.dispose();
    room = createRoom('rps', 'player1');
    joinRoom(room, 'player2');
    setupRPS(room);
    engine = new GameEngine(room);
    engine.initRoom();
    const card = room.players.player1.hand[0];
    expect(engine.executePlayerAction('player1', 'rpsPlay', { cardUuid: card.uuid }).success).toBe(true);
    expect(engine.roomState.rpsState.playedCards.player1).toBe('rock');
    expect(engine.roomState.stack).toEqual([]);
    rejected('player1', 'rpsPlay', { cardUuid: engine.roomState.players.player1.hand[0].uuid });
  });

  it('retains extension data when routing a registered card action', () => {
    const addonHandler = {
      validate: (_room, _player, data) => data.amount === 7 ? { success: true } : { success: false, phase: 'validate', reason: 'amount required' },
      propose: () => ({ success: true, mutations: [{ type: 'SET_LIFE', playerId: 'player1', amount: 7 }] }),
    };
    const addonEngine = new GameEngine(createTestRoom({ debugMode: 'flow' }), {}, createDefaultActionRegistry().with('addon', addonHandler));
    try {
      addonEngine.initRoom();
      expect(addonEngine.executePlayerAction('player1', 'addon', { amount: 7 }).success).toBe(true);
      expect(addonEngine.roomState.players.player1.life).toBe(7);
    } finally {
      addonEngine.dispose();
    }
  });

  it('rejects an expansion pointer before paying costs or publishing action events', () => {
    const fireball = instantiateCard('broken-fireball');
    fireball.state = { ...fireball.state, ownerId: 'player1', controllerId: 'player1', zone: 'hand' };
    room.players.player1.hand = [fireball];
    const uuid = vi.spyOn(engine, 'generateUuid');
    const events = vi.spyOn((engine as unknown as { eventBus: EventBus }).eventBus, 'emit');
    rejected('player1', 'cast_spell', { cardUuid: fireball.uuid,
      targets: [{ targetType: 'player', playerId: 'player2', all: true, cardTypes: 'Creature' }] });
    expect(uuid).not.toHaveBeenCalled();
    expect(events).not.toHaveBeenCalled();
  });

  it('owns stack identity at the player boundary', () => {
    vi.spyOn(engine, 'generateUuid').mockReturnValue('engine-stack');
    const card = room.players.player1.hand[0];
    expect(engine.executePlayerAction('player1', 'cast_spell', { cardUuid: card.uuid, stackUuid: 'client-stack' }).success).toBe(true);
    expect(engine.roomState.stack[0].uuid).toBe('engine-stack');
  });

  it('keeps lethal debug resolution terminal and refuses later commands', () => {
    const fireball = instantiateCard('broken-fireball');
    fireball.state = { ...fireball.state, ownerId: 'player1', controllerId: 'player1', zone: 'hand' };
    room.players.player1.hand = [fireball];
    room.players.player2.life = 1;
    expect(engine.executePlayerAction('player1', 'cast_spell', { cardUuid: fireball.uuid, targets: [{ targetType: 'player', playerId: 'player2' }] }).success).toBe(true);
    expect(engine.executePlayerAction('player2', 'resolve_stack').success).toBe(true);
    expect(engine.roomState.status).toBe('gameOver');
    expect(engine.roomState.priorityPlayerId).toBeNull();
    rejected('player2', 'end_turn');
    rejected('player1', 'rpsPlay');
  });

  it('returns no options for missing players, invalid fields or terminal rooms', () => {
    const service = new OptionService();
    expect(service.getOptions(room, 'missing', 'missing', 'hand')).toEqual([]);
    expect(service.getOptions(room, 'player1', null as unknown as string, 'hand')).toEqual([]);
    expect(service.getOptions(room, 'player1', 'missing', 'invalid' as 'hand')).toEqual([]);
    room.status = 'gameOver';
    expect(service.getOptions(room, 'player1', room.players.player1.hand[0].uuid, 'hand')).toEqual([]);
  });
});
