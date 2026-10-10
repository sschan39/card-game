import { describe, it, expect } from 'vitest';
import { createTestRoom } from '../helpers/test-room-factory';
import { creature } from '../helpers/combat-fixture';
import { GameEngine } from '../../src/engine/game-engine';
import { gameReducer } from '../../src/engine/game-reducer';
import { StateMachine } from '../../src/engine/state-machine';
import { planDamage } from '../../src/engine/damage-service';
import { captureSourceInformation } from '../../src/engine/source-information';
import { planStateBasedActions, answerStateBasedChoice } from '../../src/engine/state-based-planner';
import { SyncService } from '../../src/server/sync-service';
import { applyDeltaChanges } from '../../src/client/store/deltaReducer';
import type { GameMutation } from '../../src/types/game-mutation.types';
import { registerReplacementOperation } from '../../src/engine/replacement-rules';
import { planProposedMutations } from '../../src/engine/proposed-events';
import { startCombatDamage } from '../../src/engine/combat-service';

declare module '../../src/types/proposed-event.types' {
  interface ReplacementOperationMap { test_last_draw: { type: 'test_last_draw' }; test_result_move: { type: 'test_result_move' } }
}

describe('Milestone 7 integration boundaries', () => {
  it('re-evaluates successive draws against the result of earlier draws', () => {
    const room = createTestRoom();
    room.players.player1.hand = [];
    room.players.player1.deck = ['a', 'b'].map(id => { const card = creature(id, 'player1'); card.state.zone = 'library'; return card; });
    const unregister = registerReplacementOperation('test_last_draw', {
      applies: (room, event) => event.kind === 'draw' && room.players[event.playerId].deck.length === 1,
      replace: (_room, event) => ({ events: event.kind === 'draw' ? [{ kind: 'life_change', playerId: event.playerId, amount: 5 }] : [event] }),
    });
    try {
      room.replacementEffects = [{ id: 'last', label: 'Replace last draw', operation: { type: 'test_last_draw' } }];
      const plan = planProposedMutations(room, [{ type: 'DRAW_CARDS', playerId: 'player1', amount: 2 }]);
      const next = plan.mutations.reduce(gameReducer, room);
      expect(next.players.player1.deck.map(c => c.uuid)).toEqual(['a']);
      expect(next.players.player1.hand.map(c => c.uuid)).toEqual(['b']);
      expect(next.players.player1.life).toBe(25);
    } finally { unregister(); }
  });

  it('publishes damage when a replaced damage result moves the recipient away', () => {
    const source = creature('source', 'player1'), victim = creature('victim', 'player2', 3, 8, ['Planeswalker']);
    victim.blueprint = { ...victim.blueprint, cardTypes: ['Creature', 'Planeswalker'] }; victim.state.counters.loyalty = 5;
    const room = createTestRoom({ battlefield: [source, victim] });
    const unregister = registerReplacementOperation('test_result_move', {
      applies: (_room, event) => event.kind === 'counter_change',
      replace: (_room, event) => ({ events: [{ kind: 'zone_transfer', move: { type: 'MOVE_CARD', cardUuid: 'victim', playerId: 'player2', from: 'battlefield', to: 'hand' } }] }),
    });
    const engine = new GameEngine({ ...room, replacementEffects: [{ id: 'move', label: 'Move instead', operation: { type: 'test_result_move' } }] });
    try {
      expect(() => engine.applyMutations(planDamage(room, [{ source: captureSourceInformation(room, source), recipient: { kind: 'permanent', cardUuid: 'victim', zoneRevision: 0 }, amount: 2, combat: false }]))).not.toThrow();
      expect(engine.roomState.players.player2.hand.map(c => c.uuid)).toContain('victim');
      expect(engine.drainEventBatches().flatMap(b => b.events).filter(e => e.eventId === 'DAMAGE_DEALT').map(e => e.payload.amount)).toEqual([2]);
    } finally { unregister(); engine.dispose(); }
  });

  it('returns combat priority after answering a replacement inside manual allocation', () => {
    const source = creature('source', 'player1', 5, 8);
    const room = createTestRoom({ phase: 'combatDamageStep', battlefield: [source], priorityPlayerId: null,
      combat: [{ attacker: source, blockers: [], targetPlayerId: 'player2', blocked: false }],
      replacementEffects: [{ id: 'shield', label: 'Shield', operation: { type: 'prevent_damage', amount: 1 }, optional: true }] });
    const engine = new GameEngine(room);
    const plan = startCombatDamage(room);
    engine.applyMutations([...plan.mutations, { type: 'SET_PENDING_CHOICE', choice: plan.choice! }]);
    let choice = engine.roomState.pendingChoice!;
    expect(engine.executePlayerAction(choice.playerId, 'choose', { choiceId: choice.id, allocations: { [choice.options[0].id]: 5 } }).success).toBe(true);
    choice = engine.roomState.pendingChoice!;
    expect(choice.continuation.type).toBe('replacement');
    expect(engine.executePlayerAction(choice.playerId, 'choose', { choiceId: choice.id, choices: ['shield'] }).success).toBe(true);
    expect(engine.roomState.priorityPlayerId).toBe('player1');
    expect(engine.roomState.combatDamage?.completed).toBe(true);
    engine.dispose();
  });

  it('records an ordinary empty-library draw attempt and settles the loss', () => {
    const room = createTestRoom({ phase: 'upkeepStep', turnNumber: 2 });
    const engine = new GameEngine(room);
    engine.applyMutations(new StateMachine(room).transition(room, 'stateDrawPhase'));
    expect(engine.roomState.players.player1.failedDraw).toBe(true);
    expect(engine.roomState.outcome).toMatchObject({ type: 'win', winnerId: 'player2' });
    engine.dispose();
  });

  it('ignores damage to permanents that cannot receive it, including lifelink', () => {
    const source = creature('source', 'player1', 2, 2, ['Lifelink']);
    const artifact = creature('artifact', 'player2'); artifact.blueprint = { ...artifact.blueprint, cardTypes: ['Artifact'] };
    const room = createTestRoom({ battlefield: [source, artifact] });
    expect(planDamage(room, [{ source: captureSourceInformation(room, source), recipient: { kind: 'permanent', cardUuid: 'artifact', zoneRevision: 0 }, amount: 3, combat: false }])).toEqual([]);
  });

  it('tracks gaining, losing and regaining World independently of entry time', () => {
    const a = creature('a', 'player1'); const b = creature('b', 'player1');
    a.state.characteristicTimestamp = 1; b.state.characteristicTimestamp = 2;
    let room = createTestRoom({ battlefield: [a, b] });
    const world = (id: string): GameMutation => ({ type: 'ADD_CONTINUOUS_EFFECT', entry: { id: `world-${id}`, source: id, duration: 'PERMANENT', layer: 4, scope: { cardUuid: id }, effect: { type: 'TYPE', addSuperTypes: ['World'] } } });
    room = gameReducer(room, world('b'));
    room = gameReducer(room, world('a'));
    const plan = planStateBasedActions(room);
    expect(plan.mutations.filter(m => m.type === 'MOVE_CARD').map(m => m.cardUuid)).toEqual(['b']);
    const gained = room.battlefield[0].state.worldTimestamp!;
    room = gameReducer(room, { type: 'REMOVE_CONTINUOUS_EFFECT', id: 'world-a' });
    expect(room.battlefield[0].state.worldTimestamp).toBeUndefined();
    room = gameReducer(room, world('a'));
    expect(room.battlefield[0].state.worldTimestamp).toBeGreaterThan(gained);
  });

  it('prevents a departed token returning before its cessation checkpoint', () => {
    const token = { ...creature('token', 'player1'), isToken: true };
    let room = createTestRoom({ battlefield: [token] });
    room = gameReducer(room, { type: 'MOVE_CARD', cardUuid: token.uuid, playerId: 'player1', from: 'battlefield', to: 'graveyard' });
    room = gameReducer(room, { type: 'MOVE_CARD', cardUuid: token.uuid, playerId: 'player1', from: 'graveyard', to: 'battlefield' });
    expect(room.battlefield).toEqual([]);
  });

  it('ceases a token on the stack without deleting abilities retaining its source', () => {
    const token = { ...creature('token', 'player1'), isToken: true }; token.state.zone = 'stack';
    const object = { uuid: 'spell', type: 'spell' as const, source: token, controllerId: 'player1', countered: false, effects: [] };
    const room = createTestRoom({ stack: [object, { ...object, uuid: 'ability', type: 'activated' }] });
    const plan = planStateBasedActions(room);
    const next = plan.mutations.reduce(gameReducer, room);
    expect(next.stack.map(s => s.uuid)).toEqual(['ability']);
  });

  it('finishes simultaneous legend removals before freezing the terminal snapshot', () => {
    const a = creature('a', 'player1'); const b = creature('b', 'player1');
    for (const card of [a, b]) card.blueprint = { ...card.blueprint, name: 'Legend', superTypes: ['Legendary'] };
    const room = createTestRoom({ battlefield: [a, b] }); room.players.player2.life = 0;
    const choice = planStateBasedActions(room).pendingChoice!;
    const plan = answerStateBasedChoice(room, choice, { values: [choice.options[0].value] });
    const next = plan.mutations.reduce(gameReducer, room);
    expect(next.battlefield.map(c => c.uuid)).toEqual(['a']);
    expect(next.outcome?.type).toBe('win');
  });

  it('replays registration, World tenure, cleanup and atomic result-created zone changes', () => {
    const card = creature('card', 'player1'); card.state.deathtouchDamage = true;
    let room = createTestRoom({ battlefield: [card] });
    const service = new SyncService({} as never);
    const steps: GameMutation[] = [
      { type: 'ADD_REPLACEMENT_EFFECT', effect: { label: 'Shield', operation: { type: 'prevent_damage' }, duration: 'end_of_turn', remaining: 3 } },
      { type: 'ADD_CONTINUOUS_EFFECT', entry: { source: 'card', duration: 'PERMANENT', layer: 4, scope: { cardUuid: 'card' }, effect: { type: 'TYPE', addSuperTypes: ['World'] } } },
      { type: 'CLEAR_DAMAGE' }, { type: 'CLEAR_END_OF_TURN_EFFECTS' },
      { type: 'APPLY_DAMAGE_BATCH', assignments: [{ source: captureSourceInformation(room, card), recipient: { kind: 'player', playerId: 'player2' }, amount: 1, combat: false }], results: [{ type: 'MOVE_CARD', cardUuid: 'card', playerId: 'player1', from: 'battlefield', to: 'hand' }] },
    ];
    for (const mutation of steps) {
      const next = gameReducer(room, mutation);
      const delta = service.buildDelta(room, [mutation], { action: 'integration', playerId: 'player1' });
      expect(applyDeltaChanges(room, JSON.parse(JSON.stringify(delta.changes)))).toEqual(JSON.parse(JSON.stringify(next)));
      room = next;
    }
  });
});
