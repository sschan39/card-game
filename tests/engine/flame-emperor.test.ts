import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { GameEngine } from '../../src/engine/game-engine';
import { ActionRegistry, registerAction } from '../../src/engine/action-registry';
import { declareAttackersHandler } from '../../src/engine/handlers/declare-attackers-handler';
import { instantiateCard } from '../../src/library/card-factory';
import { createTestRoom } from '../helpers/test-room-factory';
import { creature } from '../helpers/combat-fixture';

const engines: GameEngine[] = [];
let registry: typeof ActionRegistry;
beforeEach(() => { registry = { ...ActionRegistry }; registerAction('declare_attackers', declareAttackersHandler); });
afterEach(() => { engines.splice(0).forEach(engine => engine.dispose()); Object.keys(ActionRegistry).forEach(key => delete ActionRegistry[key]); Object.assign(ActionRegistry, registry); });
function fixture() {
  const emperor = instantiateCard('flame-emperor-achilles'); emperor.state = { ...emperor.state, zone: 'battlefield', ownerId: 'player1', controllerId: 'player1', summoningSickness: false };
  const ally = instantiateCard('empire-servant'); ally.state = { ...ally.state, zone: 'battlefield', ownerId: 'player1', controllerId: 'player1', summoningSickness: false }; ally.state.counters.scorch = 8;
  const first = creature('first', 'player2', 2, 20), second = creature('second', 'player2', 2, 20); first.state.counters.scorch = 1; second.state.counters.scorch = 2;
  const room = createTestRoom({ battlefield: [emperor, ally, first, second], phase: 'declareAttackersStep', priorityPlayerId: null });
  room.players.player1.deck = ['land-red', 'musketeer-infantry', 'empire-servant'].map(id => { const card = instantiateCard(id); card.state = { ...card.state, zone: 'library', ownerId: 'player1', controllerId: 'player1' }; return card; });
  const engine = new GameEngine(room); engine.initRoom(); engines.push(engine); return { engine, emperor, ally };
}
function choose(engine: GameEngine, ids: string[]) {
  const choice = engine.roomState.pendingChoice!;
  expect(engine.executePlayerAction(choice.playerId, 'choose', { choiceId: choice.id, choices: ids }).success).toBe(true);
}
describe('極炎皇帝 阿基里斯', () => {
  it.each(['player', 'permanent'] as const)('self-attack chooses one %s and deals a single multiplied hit from current opposing Scorch', target => {
    const { engine, emperor } = fixture();
    expect(engine.executePlayerAction('player1', 'declare_attackers', { attackers: [{ cardUuid: emperor.uuid }] }).success).toBe(true);
    let choice = engine.roomState.pendingChoice!; if (choice.kind === 'number') throw new Error('Ordering');
    expect(choice.kind).toBe('ordering'); choose(engine, choice.options.map(option => option.id));
    choice = engine.roomState.pendingChoice!; if (choice.kind === 'number') throw new Error('Targets');
    choose(engine, [choice.options.find(option => target === 'player' ? (option.value as { playerId?: string }).playerId === 'player2' : (option.value as { cardUuid?: string }).cardUuid === 'first')!.id]);
    expect(engine.roomState.stack).toHaveLength(2);
    // Stack order can put either trigger first; decline the independent reveal if it is top.
    if (engine.roomState.stack.at(-1)!.ability?.id === 'flame-beast-attack-reveal') { engine.resolveTopOfStack(); choose(engine, ['no']); }
    engine.roomState.battlefield.find(card => card.uuid === 'second')!.state.counters.scorch = 3;
    expect(engine.resolveTopOfStack().success).toBe(true);
    expect(target === 'player' ? engine.roomState.players.player2.life : engine.roomState.battlefield.find(card => card.uuid === 'first')!.state.damageTaken).toBe(target === 'player' ? 8 : 12);
    const hits = engine.drainEventBatches().flatMap(batch => batch.events).filter(event => event.eventId === 'DAMAGE_DEALT');
    expect(hits).toHaveLength(1); expect(hits[0].payload.amount).toBe(12);
  });
  it('a friendly 炎獸 attack reveals, counts, Scorches and returns exactly those cards', () => {
    const { engine, ally } = fixture(); const revealed = [...engine.roomState.players.player1.deck];
    expect(engine.executePlayerAction('player1', 'declare_attackers', { attackers: [{ cardUuid: ally.uuid }] }).success).toBe(true);
    expect(engine.roomState.stack).toHaveLength(1);
    expect(engine.resolveTopOfStack().success).toBe(true); choose(engine, ['yes']);
    const target = engine.roomState.pendingChoice!; if (target.kind === 'number') throw new Error('Target');
    choose(engine, [target.options.find(option => (option.value as { cardUuid?: string }).cardUuid === 'first')!.id]);
    expect(engine.roomState.battlefield.find(card => card.uuid === 'first')!.state.counters.scorch).toBe(3);
    choose(engine, revealed.map(card => card.uuid));
    expect(engine.roomState.players.player1.deck.map(card => card.uuid)).toEqual(revealed.map(card => card.uuid).reverse());
    expect(engine.drainEventBatches().flatMap(batch => batch.events).filter(event => event.eventId === 'CARD_REVEALED')).toHaveLength(3);
  });
});
