import { afterEach, expect, it } from 'vitest';
import { GameEngine } from '@engine/game-engine';
import { createTestRoom } from '../helpers/test-room-factory';
import { instantiateCard } from '@library/card-factory';
import { buildStackEffects } from '@engine/effect-resolver';
import type { EffectDefinition } from '@shared/effect.types';
import type { CardInstance } from '@shared/card.types';
const engines: GameEngine[] = [];
afterEach(() => engines.splice(0).forEach(engine => engine.dispose()));
function card(id: string) { const c = instantiateCard(id); c.state = { ...c.state, zone: 'library', ownerId: 'player1', controllerId: 'player1' }; return c; }
function start(deck: CardInstance[], countered = false, effects?: EffectDefinition[]) {
  const source = card('red-wolf'); source.state.zone = 'battlefield';
  const engine = new GameEngine(createTestRoom({ battlefield: [source] })); engine.initRoom(); engines.push(engine);
  engine.roomState.players.player1.deck = deck; engine.roomState.players.player1.hand = [];
  engine.applyMutations([{ type: 'PUSH_STACK', stackObject: { uuid: 'reveal', type: 'triggered', controllerId: 'player1', source,
    effects: buildStackEffects(effects ?? source.blueprint.onEnterEffects, 'player1', source), countered } }]);
  engine.resolveTopOfStack();
  if (!effects && !countered) choose(engine, ['yes']);
  return engine;
}
function choose(engine: GameEngine, ids: string[]) {
  const c = engine.roomState.pendingChoice!; expect(c).toBeTruthy();
  expect(engine.executePlayerAction(c.playerId, 'choose', { choiceId: c.id, choices: ids }).success).toBe(true);
}
it('reveals exactly the top three, excludes another red wolf, and returns remainder before self claims', () => {
  const deep = card('broken-fireball'), fire = card('broken-fireball'), wolf = card('red-wolf'), mountain = card('awakened-blood-mountain');
  const engine = start([deep, fire, wolf, mountain]);
  const c = engine.roomState.pendingChoice!; if (c.kind === 'number') throw new Error('search');
  expect(c.options).toEqual([]); choose(engine, []);
  const order = engine.roomState.pendingChoice!; if (order.kind === 'number') throw new Error('ordering');
  expect(order.options.map(o => o.id)).toEqual([mountain.uuid, wolf.uuid, fire.uuid]);
  choose(engine, [fire.uuid, mountain.uuid, wolf.uuid]);
  expect(engine.roomState.players.player1.deck.map(c => c.uuid)).toEqual([wolf.uuid, mountain.uuid, fire.uuid, deep.uuid]);
  const events = engine.drainEventBatches().flatMap(b => b.events).filter(e => e.eventId === 'CARD_REVEALED');
  expect(events.map(e => e.payload.card.uuid)).toEqual([mountain.uuid, wolf.uuid, fire.uuid]);
  const triggerOrder = engine.roomState.pendingChoice!; if (triggerOrder.kind === 'number') throw new Error('trigger ordering');
  choose(engine, triggerOrder.options.map(o => o.id));
  expect(engine.roomState.stack.filter(s => s.type === 'triggered')).toHaveLength(2);
  engine.resolveTopOfStack(); choose(engine, ['yes']);
  engine.resolveTopOfStack(); choose(engine, ['yes']);
  expect(engine.roomState.players.player1.hand.map(c => c.uuid).sort()).toEqual([mountain.uuid, fire.uuid].sort());
  expect(engine.roomState.players.player1.deck.map(c => c.uuid)).toEqual([wolf.uuid, deep.uuid]);
});
it('does not reveal when the revealing ability is countered', () => {
  const engine = start([card('broken-fireball')], true);
  expect(engine.roomState.pendingChoice).toBeFalsy();
  expect(engine.drainEventBatches().flatMap(b => b.events).some(e => e.eventId === 'CARD_REVEALED')).toBe(false);
});
it.each(['broken-fireball', 'andu-gittes'])('does not let an old %s reveal trigger claim a later zone incarnation', id => {
  const revealed = card(id), deep = card('red-wolf'); const engine = start([deep, revealed]);
  choose(engine, []); choose(engine, [revealed.uuid, deep.uuid]);
  expect(engine.roomState.stack).toHaveLength(1);
  engine.applyMutations([
    { type: 'MOVE_CARD', cardUuid: revealed.uuid, playerId: 'player1', from: 'library', to: 'graveyard' },
    { type: 'MOVE_CARD', cardUuid: revealed.uuid, playerId: 'player1', from: 'graveyard', to: 'library' },
  ]);
  engine.resolveTopOfStack(); choose(engine, ['yes']);
  expect(engine.roomState.pendingChoice).toBeFalsy();
  expect(engine.roomState.players.player1.hand).toHaveLength(0);
  expect(engine.roomState.players.player1.graveyard).toHaveLength(0);
  expect(engine.roomState.players.player1.deck.some(card => card.uuid === revealed.uuid && card.state.zoneRevision === 2)).toBe(true);
});
it('赤狼 lets its controller decline revealing before exposing or moving any card', () => {
  const source = card('red-wolf'); source.state.zone = 'battlefield';
  const room = createTestRoom(); room.players.player1.deck = [card('broken-fireball')];
  const engine = new GameEngine(room); engine.initRoom(); engines.push(engine);
  engine.applyMutations([{ type: 'PUSH_STACK', stackObject: { uuid: 'optional-reveal', type: 'triggered', controllerId: 'player1', source, effects: buildStackEffects(source.blueprint.onEnterEffects, 'player1', source), countered: false } }]);
  engine.resolveTopOfStack();
  expect(engine.roomState.pendingChoice?.kind).toBe('optional');
  choose(engine, ['no']);
  expect(engine.roomState.players.player1.deck).toHaveLength(1);
  expect(engine.drainEventBatches().flatMap(batch => batch.events).some(event => event.eventId === 'CARD_REVEALED')).toBe(false);
});

it('selected 炎獸 card in hand still produces its on-reveal trigger after reconnect', () => {
  const claimed = card('broken-fireball'); claimed.blueprint = { ...claimed.blueprint, subTypes: ['炎獸'] };
  const deep = card('red-wolf');
  const engine = start([deep, claimed]);
  choose(engine, [claimed.uuid]);
  expect(engine.roomState.players.player1.hand.map(c => c.uuid)).toContain(claimed.uuid);
  engine.roomState.pendingChoice = JSON.parse(JSON.stringify(engine.roomState.pendingChoice));
  choose(engine, [deep.uuid]);
  expect(engine.roomState.stack.filter(s => s.type === 'triggered')).toHaveLength(1);
  expect(engine.roomState.stack[0].source.state.zone).toBe('hand');
  engine.resolveTopOfStack(); choose(engine, ['yes']);
  expect(engine.roomState.players.player1.hand.filter(c => c.uuid === claimed.uuid)).toHaveLength(1);
});
it('does not claim from a source that is no longer an 炎獸 in the reveal snapshot', () => {
  const fire = card('broken-fireball'); const engine = start([fire]);
  const choice = engine.roomState.pendingChoice!;
  if (choice.continuation.type !== 'resolution') throw new Error('resolution');
  const retained = choice.continuation.stackObj.resolutionReveals![0].sourceInfo.card;
  retained.lastKnownCharacteristics!.subTypes = [];
  choose(engine, []); choose(engine, [fire.uuid]);
  expect(engine.roomState.stack).toHaveLength(0);
});

it.each([false, true])('安度基特斯 discards itself from %s selection, then places Scorch and draws', selected => {
  const andu = card('andu-gittes'), deep = card('red-wolf'); const engine = start([deep, andu]);
  const enemy = card('awakened-blood-mountain'); enemy.state = { ...enemy.state, zone: 'battlefield', ownerId: 'player2', controllerId: 'player2' };
  engine.roomState.battlefield = [...engine.roomState.battlefield, enemy];
  choose(engine, selected ? [andu.uuid] : []);
  choose(engine, selected ? [deep.uuid] : [andu.uuid, deep.uuid]);
  expect(engine.roomState.stack).toHaveLength(1);
  engine.resolveTopOfStack(); choose(engine, ['yes']);
  expect(engine.roomState.players.player1.graveyard.map(c => c.uuid)).toContain(andu.uuid);
  expect(engine.roomState.players.player1.hand).toHaveLength(0);
  const choice = engine.roomState.pendingChoice!; if (choice.kind === 'number') throw new Error('selection');
  choose(engine, [choice.options.find(o => (o.value as {cardUuid?:string}).cardUuid === enemy.uuid)!.id]);
  expect(engine.roomState.battlefield.find(c => c.uuid === enemy.uuid)?.state.counters.scorch).toBe(2);
  expect(engine.roomState.players.player1.hand.map(c => c.uuid)).toEqual([deep.uuid]);
});
it.each(['cancel_event', 'move_destination'] as const)('does not give 安度基特斯 a payoff when discard is %s', replacement => {
  const andu = card('andu-gittes'), deep = card('red-wolf'); const engine = start([deep, andu]);
  choose(engine, []); choose(engine, [andu.uuid, deep.uuid]);
  engine.roomState.replacementEffects = [{ id: 'stop-discard', label: 'Stop discard', match: { kinds: ['discard'] },
    operation: replacement === 'cancel_event' ? { type: 'cancel_event' } : { type: 'move_destination', to: 'exile' } }];
  engine.resolveTopOfStack(); choose(engine, ['yes']);
  expect(engine.roomState.pendingChoice).toBeFalsy();
  expect(engine.roomState.players.player1.hand).toHaveLength(0);
  expect(engine.roomState.players.player1.graveyard).toHaveLength(0);
  expect(engine.roomState.players.player1.deck.some(c => c.uuid === deep.uuid)).toBe(true);
});
it('declining 安度基特斯 keeps its card at the bottom and draws nothing', () => {
  const andu = card('andu-gittes'), deep = card('red-wolf'); const engine = start([deep, andu]);
  choose(engine, []); choose(engine, [andu.uuid, deep.uuid]);
  engine.resolveTopOfStack(); choose(engine, ['no']);
  expect(engine.roomState.players.player1.deck.map(c => c.uuid)).toEqual([deep.uuid, andu.uuid]);
  expect(engine.roomState.players.player1.hand).toHaveLength(0);
});
const emperorReveal: EffectDefinition[] = [{ action: 'REVEAL_TOP', params: { amount: 3, disposition: 'scorch',
  matchingClauses: [{ cardTypes: ['Creature'], subTypes: ['炎獸'] }, { cardTypes: ['Spell'], subTypes: ['炎兵'] }] },
  targeting: { type: 'self', required: false }, choice: { kind: 'optional', prompt: 'Reveal top three?' } }];
it('Emperor freezes its matching count, places Scorch, returns all cards, then triggers revealed cards', () => {
  const deep = card('red-wolf'), fire = card('broken-fireball'), wolf = card('red-wolf'), mountain = card('awakened-blood-mountain');
  const engine = start([deep, fire, wolf, mountain], false, emperorReveal);
  expect(engine.drainEventBatches().flatMap(b => b.events).filter(e => e.eventId === 'CARD_REVEALED')).toHaveLength(0);
  const enemy = card('awakened-blood-mountain'); enemy.state = { ...enemy.state, zone: 'battlefield', ownerId: 'player2', controllerId: 'player2' };
  engine.roomState.battlefield = [...engine.roomState.battlefield, enemy];
  choose(engine, ['yes']);
  const targetChoice = engine.roomState.pendingChoice!; if (targetChoice.kind === 'number') throw new Error('selection');
  fire.blueprint = { ...fire.blueprint, subTypes: [] }; // Count is frozen before this later change.
  choose(engine, [targetChoice.options.find(o => (o.value as {cardUuid?:string}).cardUuid === enemy.uuid)!.id]);
  expect(engine.roomState.battlefield.find(c => c.uuid === enemy.uuid)?.state.counters.scorch).toBe(2);
  expect(engine.roomState.players.player1.hand).toHaveLength(0);
  expect(engine.roomState.stack).toHaveLength(1); // Resolving reveal, no on-reveal triggers yet.
  const order = engine.roomState.pendingChoice!; if (order.kind === 'number') throw new Error('ordering');
  expect(order.options.map(o => o.id)).toEqual([mountain.uuid, wolf.uuid, fire.uuid]);
  engine.roomState.pendingChoice = JSON.parse(JSON.stringify(engine.roomState.pendingChoice));
  choose(engine, [wolf.uuid, mountain.uuid, fire.uuid]);
  expect(engine.roomState.players.player1.deck.map(c => c.uuid)).toEqual([fire.uuid, mountain.uuid, wolf.uuid, deep.uuid]);
  const events = engine.drainEventBatches().flatMap(b => b.events).filter(e => e.eventId === 'CARD_REVEALED');
  expect(events).toHaveLength(3);
  expect(events.every(e => e.payload.controllerId === 'player1' && e.payload.sourceInfo.card.lastKnownCharacteristics!.subTypes.includes('炎獸'))).toBe(true);
  const triggerOrder = engine.roomState.pendingChoice!; if (triggerOrder.kind === 'number') throw new Error('trigger ordering');
  choose(engine, triggerOrder.options.map(o => o.id));
  expect(engine.roomState.stack).toHaveLength(2);
  engine.resolveTopOfStack(); choose(engine, ['yes']);
  engine.resolveTopOfStack(); choose(engine, ['yes']);
  expect(engine.roomState.players.player1.hand.map(c => c.uuid).sort()).toEqual([fire.uuid, mountain.uuid].sort());
});
it('declining optional Emperor reveal produces no reveal event or bottom choice', () => {
  const engine = start([card('broken-fireball')], false, emperorReveal);
  choose(engine, ['no']);
  expect(engine.roomState.pendingChoice).toBeFalsy();
  expect(engine.drainEventBatches().flatMap(b => b.events).filter(e => e.eventId === 'CARD_REVEALED')).toHaveLength(0);
});
