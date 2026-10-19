import { afterEach, beforeEach, expect, it } from 'vitest';
import { GameEngine } from '../../src/engine/game-engine';
import { ActionRegistry, registerAction } from '../../src/engine/action-registry';
import { playCardHandler } from '../../src/engine/handlers/play-card-handler';
import { instantiateCard } from '../../src/library/card-factory';
import { createTestRoom, fillTestLibraries } from '../helpers/test-room-factory';
import { creature } from '../helpers/combat-fixture';
const engines: GameEngine[] = [];
let registry: typeof ActionRegistry;
beforeEach(() => { registry = { ...ActionRegistry }; registerAction('cast_spell', playCardHandler); });
afterEach(() => { engines.splice(0).forEach(e => e.dispose()); Object.keys(ActionRegistry).forEach(k => delete ActionRegistry[k]); Object.assign(ActionRegistry, registry); });
function fixture(prevent: 'none' | 'indestructible' | 'exile' = 'none', artifact = false) {
  const king = instantiateCard('wolf-king-keps'); king.state = { ...king.state, zone: 'hand', ownerId: 'player1', controllerId: 'player1' };
  const victim = creature('victim', 'player2', 3, 3, prevent === 'indestructible' ? ['Indestructible'] : []);
  if (artifact) victim.blueprint = { ...victim.blueprint, cardTypes: ['Artifact'] };
  const room = createTestRoom({ battlefield: [victim] }); fillTestLibraries(room); room.players.player1.hand = [king];
  if (prevent === 'exile') room.replacementEffects = [{ id: 'redirect', label: 'Exile instead', match: { kinds: ['destroy'] }, operation: { type: 'move_destination', to: 'exile' } }];
  const engine = new GameEngine(room); engine.initRoom(); engines.push(engine);
  return { engine, king, victim };
}
function cast(engine: GameEngine, uuid: string) {
  expect(engine.executePlayerAction('player1', 'cast_spell', { cardUuid: uuid }).success).toBe(true);
  expect(engine.resolveTopOfStack().success).toBe(true);
}
function target(engine: GameEngine, uuid: string) {
  const choice = engine.roomState.pendingChoice!; expect(choice).toBeTruthy(); if (choice.kind === 'number') throw new Error('targets');
  expect(choice.kind).toBe('targets');
  const option = choice.options.find(o => (o.value as { cardUuid?: string }).cardUuid === uuid)!;
  expect(engine.executePlayerAction(choice.playerId, 'choose', { choiceId: choice.id, choices: [option.id] }).success).toBe(true);
}
it.each([false, true])('casts the actual king, chooses an opposing target (Artifact=%s), destroys it and draws', artifact => {
  const { engine, king, victim } = fixture('none', artifact); const top = engine.roomState.players.player1.deck.at(-1)!.uuid;
  cast(engine, king.uuid); target(engine, victim.uuid);
  expect(engine.roomState.players.player1.hand).toHaveLength(0);
  expect(engine.resolveTopOfStack().success).toBe(true);
  expect(engine.roomState.players.player2.graveyard.map(c => c.uuid)).toContain(victim.uuid);
  expect(engine.roomState.players.player1.hand.map(c => c.uuid)).toEqual([top]);
  const events = engine.drainEventBatches().flatMap(b => b.events);
  expect(events.filter(e => e.eventId === 'PERMANENT_DIED')).toHaveLength(artifact ? 0 : 1);
  expect(events.filter(e => e.eventId === 'PERMANENT_LEFT')).toHaveLength(1);
  expect(events.filter(e => e.eventId === 'CARD_DRAWN')).toHaveLength(1);
});
it.each(['indestructible', 'exile'] as const)('does not draw when its actual target is %s', prevent => {
  const { engine, king, victim } = fixture(prevent); cast(engine, king.uuid); target(engine, victim.uuid);
  expect(engine.resolveTopOfStack().success).toBe(true);
  expect(engine.roomState.players.player1.hand).toHaveLength(0);
  expect(engine.roomState.players.player2.graveyard).toHaveLength(0);
  expect(engine.roomState.players.player2.exile?.some(c => c.uuid === victim.uuid) ?? false).toBe(prevent === 'exile');
});
it('a countered entry ability neither destroys nor draws', () => {
  const { engine, king, victim } = fixture(); cast(engine, king.uuid); target(engine, victim.uuid);
  engine.applyMutations([{ type: 'COUNTER_STACK', stackUuid: engine.roomState.stack.at(-1)!.uuid }]);
  expect(engine.roomState.stack).toHaveLength(0);
  expect(engine.drainEventBatches().flatMap(b => b.events).filter(e => e.eventId === 'STACK_COUNTERED')).toHaveLength(1);
  expect(engine.roomState.battlefield.some(c => c.uuid === victim.uuid)).toBe(true);
  expect(engine.roomState.players.player1.hand).toHaveLength(0);
});
it('a target that leaves before resolution fizzles the ability and does not draw', () => {
  const { engine, king, victim } = fixture(); cast(engine, king.uuid); target(engine, victim.uuid);
  engine.applyMutations([{ type: 'MOVE_CARD', cardUuid: victim.uuid, playerId: 'player2', from: 'battlefield', to: 'hand' }]);
  expect(engine.resolveTopOfStack().success).toBe(true);
  expect(engine.roomState.players.player1.hand).toHaveLength(0);
  expect(engine.roomState.players.player2.hand.some(c => c.uuid === victim.uuid)).toBe(true);
});
it('the same physical king may use its entry trigger again after leaving and returning in one turn', () => {
  const { engine, king, victim } = fixture(); const second = creature('second', 'player2', 2, 2);
  engine.roomState.battlefield = [...engine.roomState.battlefield, second];
  cast(engine, king.uuid); target(engine, victim.uuid); expect(engine.resolveTopOfStack().success).toBe(true);
  const firstRevision = engine.roomState.battlefield.find(c => c.uuid === king.uuid)!.state.zoneRevision ?? 0;
  engine.applyMutations([{ type: 'MOVE_CARD', cardUuid: king.uuid, playerId: 'player1', from: 'battlefield', to: 'hand' }]);
  cast(engine, king.uuid); target(engine, second.uuid); expect(engine.resolveTopOfStack().success).toBe(true);
  expect(engine.roomState.players.player1.hand).toHaveLength(2);
  expect(engine.roomState.players.player2.graveyard.map(c => c.uuid).sort()).toEqual([victim.uuid, second.uuid].sort());
  expect(engine.roomState.battlefield.find(c => c.uuid === king.uuid)!.state.zoneRevision).toBeGreaterThan(firstRevision);
});
