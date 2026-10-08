import { describe, expect, it } from 'vitest';
import { GameEngine } from '../../src/engine/game-engine';
import { createTestRoom } from '../helpers/test-room-factory';
import { instantiateCard } from '../../src/library/card-factory';
import type { TriggeredAbility } from '../../src/types/card.types';

const life = (amount: number) => ({ action: 'MODIFY_LIFE', params: { amount }, targeting: { type: 'self' as const, required: false } });
function fixture(abilities: { controller: string; ability: Partial<TriggeredAbility> }[]) {
  const room = createTestRoom(); room.battlefield = abilities.map(({ controller, ability }, index) => {
    const card = instantiateCard('empire-servant');
    card.state = { ...card.state, zone: 'battlefield', ownerId: controller, controllerId: controller };
    card.blueprint = { ...card.blueprint, abilities: [{ id: 'trigger-' + index, type: 'triggered', triggerCondition: 'BEGIN_UPKEEP', castSpeed: 'instant', trigger: { controller: 'any' }, effect: life(index + 1), ...ability }] };
    return card;
  }); const engine = new GameEngine(room); engine.initRoom();
  return { engine, cards: room.battlefield };
}
const fire = (engine: GameEngine) => engine.applyMutations([{ type: 'SET_PHASE', phase: 'upkeepStep' }]);
const answer = (engine: GameEngine, choices: string[], player = 'player1') => engine.executePlayerAction(player, 'choose', { choiceId: engine.roomState.pendingChoice!.id, choices });
describe('checkpoint trigger scheduling', () => {
  it('places active-player triggers below nonactive triggers independent of discovery order', () => {
    const { engine, cards } = fixture([{ controller: 'player2', ability: {} }, { controller: 'player1', ability: {} }]); fire(engine);
    expect(engine.roomState.stack.map(object => object.source.uuid)).toEqual([cards[1].uuid, cards[0].uuid]); engine.dispose();
  });
  it('requests controller ordering, blocks unrelated actions and resumes after serialization', () => {
    const { engine, cards } = fixture([{ controller: 'player1', ability: {} }, { controller: 'player1', ability: {} }, { controller: 'player2', ability: {} }]); fire(engine);
    expect(engine.roomState.pendingChoice?.kind).toBe('ordering'); expect(engine.roomState.stack).toEqual([]);
    expect(engine.roomState.priorityPlayerId).toBeNull();
    expect(engine.executePlayerAction('player1', 'pass_priority').success).toBe(false);
    expect(answer(engine, engine.roomState.pendingChoice!.options.map(option => option.id), 'player2').success).toBe(false);
    const recovered = new GameEngine(JSON.parse(JSON.stringify(engine.roomState))); recovered.initRoom(); engine.dispose();
    expect(answer(recovered, recovered.roomState.pendingChoice!.options.map(option => option.id).reverse()).success).toBe(true);
    expect(recovered.roomState.stack.map(object => object.source.uuid)).toEqual([cards[1].uuid, cards[0].uuid, cards[2].uuid]);
    expect(recovered.roomState.priorityPlayerId).toBe('player1'); expect(recovered.roomState.pendingChoice).toBeNull(); recovered.dispose();
  });
  it('chooses trigger modes and all target groups before stack insertion', () => {
    const { engine } = fixture([{ controller: 'player1', ability: { effect: life(0), modes: [{ id: 'target', label: 'Choose target', effects: [{ ...life(-2), targetGroup: 'victim', targeting: { type: 'player', controller: 'opponent', required: true, maxTargets: 1 } }] }] } }]); fire(engine);
    expect(engine.roomState.pendingChoice?.kind).toBe('modes'); answer(engine, ['target']);
    expect(engine.roomState.pendingChoice?.kind).toBe('targets'); expect(engine.roomState.stack).toEqual([]);
    answer(engine, [engine.roomState.pendingChoice!.options[0].id]); expect(engine.roomState.stack).toHaveLength(1);
    engine.resolveTopOfStack(); expect(engine.roomState.players.player2.life).toBe(18); engine.dispose();
  });
  it('drops a trigger with no legal required target without leaving a deadlocked request', () => {
    const { engine } = fixture([{ controller: 'player1', ability: { effect: { action: 'TAP', params: {}, targeting: { type: 'permanent', controller: 'opponent', required: true } } } }]); fire(engine);
    expect(engine.roomState.stack).toEqual([]); expect(engine.roomState.pendingChoice).toBeUndefined(); expect(engine.hasPendingRulesWork).toBe(false); engine.dispose();
  });
  it('restores multiple target-group selections and locks a divided effect before insertion', () => {
    const { engine } = fixture([{ controller: 'player1', ability: { effect: life(0), modes: [{ id: 'divide', label: 'Divide', effects: [
      { ...life(-3), targetGroup: 'division', targeting: { type: 'player', required: true, minTargets: 2, maxTargets: 2 }, choice: { kind: 'distribution', total: 3 } },
      { ...life(1), targetGroup: 'bonus', targeting: { type: 'player', controller: 'self', required: true } },
    ] }] } }]); fire(engine); expect(answer(engine, ['divide']).success).toBe(true);
    expect(engine.roomState.pendingChoice!.continuation).toMatchObject({ field: 'targetGroups', groupId: 'division' });
    expect(answer(engine, engine.roomState.pendingChoice!.options.map(option => option.id)).success).toBe(true);
    const recovered = new GameEngine(JSON.parse(JSON.stringify(engine.roomState))); recovered.initRoom(); engine.dispose();
    expect(recovered.roomState.pendingChoice!.continuation).toMatchObject({ field: 'targetGroups', groupId: 'bonus' });
    expect(answer(recovered, [recovered.roomState.pendingChoice!.options[0].id]).success).toBe(true);
    expect(recovered.roomState.pendingChoice?.kind).toBe('distribution'); expect(recovered.roomState.stack).toEqual([]);
    const choice = recovered.roomState.pendingChoice!, keys = choice.options.map(option => option.id);
    const before = structuredClone(recovered.roomState);
    expect(recovered.executePlayerAction('player1', 'choose', { choiceId: choice.id, allocations: { [keys[0]]: 3, [keys[1]]: 0 } }).success).toBe(false);
    expect(recovered.roomState).toEqual(before);
    expect(recovered.executePlayerAction('player1', 'choose', { choiceId: choice.id, allocations: { [keys[0]]: 1, [keys[1]]: 2 } }).success).toBe(true);
    expect(recovered.roomState.stack[0].targetGroups).toHaveLength(2); expect(recovered.roomState.pendingChoice).toBeNull();
    recovered.resolveTopOfStack(); expect(recovered.roomState.players.player1.life).toBe(20); expect(recovered.roomState.players.player2.life).toBe(18); recovered.dispose();
  });
});
