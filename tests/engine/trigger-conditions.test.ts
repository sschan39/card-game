import { describe, expect, it } from 'vitest';
import { GameEngine } from '@engine/game-engine';
import { createTestRoom } from '../helpers/test-room-factory';
import { instantiateCard } from '@library/card-factory';
import type { TriggeredAbility } from '@shared/card.types';

function fixture(ability: Partial<TriggeredAbility> = {}) {
  const room = createTestRoom(), source = instantiateCard('empire-servant');
  source.state = { ...source.state, zone: 'battlefield', ownerId: 'player1', controllerId: 'player1' };
  source.blueprint = { ...source.blueprint, abilities: [{ id: 'test', type: 'triggered', castSpeed: 'instant', triggerCondition: 'ON_LIFE_GAIN',
    effect: { action: 'MODIFY_LIFE', params: { amount: 'DYNAMIC:event.payload.amount' }, targeting: { type: 'player', controller: 'opponent', all: true, required: false } }, ...ability }] };
  room.battlefield = [source]; const engine = new GameEngine(room); engine.initRoom(); return { engine, source };
}
describe('event-dependent trigger conditions and resolution', () => {
  it('skips unresolved event parameters without corrupting state and records the skipped instruction', () => {
    const { engine } = fixture({ effect: { action: 'MODIFY_LIFE', params: { amount: 'DYNAMIC:event.payload.missing' }, targeting: { type: 'player', controller: 'opponent', all: true, required: false } } });
    engine.applyMutations([{ type: 'SET_LIFE', playerId: 'player1', amount: 21 }]); engine.drainEventBatches(); engine.resolveTopOfStack();
    expect(engine.roomState.players.player2.life).toBe(20);
    const result = engine.drainEventBatches().flatMap(batch => batch.events).find(event => event.eventId === 'STACK_ITEM_RESOLVED');
    expect(result?.payload.skipped).toBe('unresolved_parameter'); engine.dispose();
  });
  it.each(['yes', 'no'])('resumes optional trigger effects with the %s decision after recovery', decision => {
    const { engine } = fixture({ effect: { action: 'MODIFY_LIFE', params: { amount: 'DYNAMIC:event.payload.amount' }, targeting: { type: 'player', controller: 'opponent', all: true, required: false }, choice: { kind: 'optional' } } });
    engine.applyMutations([{ type: 'SET_LIFE', playerId: 'player1', amount: 23 }]); engine.resolveTopOfStack();
    expect(engine.roomState.pendingChoice?.kind).toBe('optional'); const restored = new GameEngine(JSON.parse(JSON.stringify(engine.roomState))); engine.dispose(); restored.initRoom();
    expect(restored.executePlayerAction('player1', 'choose', { choiceId: restored.roomState.pendingChoice!.id, choices: [decision] }).success).toBe(true);
    expect(restored.roomState.players.player2.life).toBe(decision === 'yes' ? 23 : 20); expect(restored.roomState.stack).toEqual([]); restored.dispose();
  });
  it('reads the recorded event amount rather than cumulative/current life', () => {
    const { engine } = fixture(); engine.applyMutations([{ type: 'SET_LIFE', playerId: 'player1', amount: 23 }]);
    engine.applyMutations([{ type: 'SET_LIFE', playerId: 'player1', amount: 22 }]);
    engine.resolveTopOfStack(); expect(engine.roomState.players.player2.life).toBe(23); engine.dispose();
  });
  it('checks an intervening condition at discovery and again at resolution', () => {
    const { engine } = fixture({ interveningIf: { op: 'gte', left: { path: 'controller.life' }, right: 22 } });
    engine.applyMutations([{ type: 'SET_LIFE', playerId: 'player1', amount: 21 }]); expect(engine.roomState.stack).toEqual([]);
    engine.applyMutations([{ type: 'SET_LIFE', playerId: 'player1', amount: 23 }]); expect(engine.roomState.stack).toHaveLength(1);
    engine.applyMutations([{ type: 'SET_LIFE', playerId: 'player1', amount: 20 }]); engine.resolveTopOfStack();
    expect(engine.roomState.players.player2.life).toBe(20); expect(engine.roomState.stack).toEqual([]); engine.dispose();
  });
  it('combines event predicates with all/any/not without treating missing values as matches', () => {
    const { engine } = fixture({ trigger: { condition: { all: [{ op: 'gt', left: { path: 'event.payload.amount' }, right: 2 },
      { any: [{ op: 'eq', left: { path: 'controller.life' }, right: 23 }, { not: { op: 'eq', left: { path: 'source.blueprint.cardTypes.0' }, right: 'Creature' } }] }] } } });
    engine.applyMutations([{ type: 'SET_LIFE', playerId: 'player1', amount: 21 }]); expect(engine.roomState.stack).toEqual([]);
    engine.applyMutations([{ type: 'SET_LIFE', playerId: 'player1', amount: 20 }]); engine.applyMutations([{ type: 'SET_LIFE', playerId: 'player1', amount: 23 }]);
    engine.resolveTopOfStack(); expect(engine.roomState.players.player2.life).toBe(23); engine.dispose();
  });
  it('reads departed event subject characteristics from the event snapshot', () => {
    const { engine, source } = fixture({ triggerCondition: 'ON_DIE', effect: { action: 'MODIFY_LIFE', params: { amount: 'DYNAMIC:event.payload.snapshot.power' }, targeting: { type: 'self', required: false } } });
    engine.applyMutations([{ type: 'ADD_COUNTER', cardUuid: source.uuid, counterType: '+1/+1', amount: 2 }, { type: 'MOVE_CARD', cardUuid: source.uuid, playerId: 'player1', from: 'battlefield', to: 'graveyard' }]);
    engine.resolveTopOfStack(); expect(engine.roomState.players.player1.life).toBe(23); engine.dispose();
  });
});
