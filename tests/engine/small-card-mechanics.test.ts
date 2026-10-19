import { afterEach, describe, expect, it } from 'vitest';
import { GameEngine } from '../../src/engine/game-engine';
import { instantiateCard } from '../../src/library/card-factory';
import { normalizeAbility, normalizeCard } from '../../src/library/card-parser';
import { createTestRoom, fillTestLibraries } from '../helpers/test-room-factory';
import { evaluateNumericValue } from '../../src/engine/numeric-values';
import type { TriggeredAbility } from '../../src/types/card.types';
import type { CardZone } from '../../src/types/card.types';

const engines: GameEngine[] = [];
afterEach(() => engines.splice(0).forEach(engine => engine.dispose()));
function card(id: string, zone: CardZone, player = 'player1') {
  const c = instantiateCard(id); c.state = { ...c.state, zone, ownerId: player, controllerId: player, summoningSickness: false }; return c;
}
function game(id = 'empire-servant') {
  const room = createTestRoom(); fillTestLibraries(room, 12);
  const source = card(id, 'hand'); room.players.player1.hand = [source];
  const engine = new GameEngine(room); engine.initRoom(); engines.push(engine); return { engine, source };
}
const self = { type: 'self', required: false };
const opponent = { type: 'player', controller: 'opponent', all: true, required: false };
function spell(effects: Record<string, unknown>[]) {
  const setup = game(); setup.source.blueprint = normalizeCard({ id: 'mechanics-fixture', cardTypes: ['Spell'], onCastEffects: effects }); return setup;
}
function cast(engine: GameEngine, source: ReturnType<typeof card>) {
  expect(engine.executePlayerAction('player1', 'cast_spell', { cardUuid: source.uuid }).success).toBe(true); engine.resolveTopOfStack();
}
function choose(engine: GameEngine, ids?: string[]) {
  const c = engine.roomState.pendingChoice!; if (c.kind === 'number') throw new Error('Expected listed choice');
  expect(engine.executePlayerAction(c.playerId, 'choose', { choiceId: c.id, choices: ids ?? c.options.slice(0, c.min).map(o => o.id) }).success).toBe(true);
}

describe('small card mechanics', () => {
  it.each([['hand', 'CARD_DISCARDED_FROM_HAND'], ['library', 'CARD_DISCARDED_FROM_LIBRARY']] as const)('distinguishes discard from %s at the committed event boundary', (zone, eventId) => {
    const { engine, source } = game(); const subject = zone === 'hand' ? source : engine.roomState.players.player1.deck.at(-1)!;
    engine.applyMutations([{ type: 'MOVE_CARD', cardUuid: subject.uuid, playerId: 'player1', from: zone, to: 'graveyard', reason: 'discard' }]);
    const events = engine.drainEventBatches().flatMap(b => b.events).filter(e => e.eventId.startsWith('CARD_DISCARDED'));
    expect(events.map(e => e.eventId)).toEqual([eventId]);
    expect(events[0].payload).toMatchObject({ card: { uuid: subject.uuid }, playerId: 'player1' });
    expect(engine.roomState.turnHistory?.counts[eventId]).toBe(1);
  });

  it.each(['hand', 'library'] as const)('does not report an ordinary %s transfer as a discard', zone => {
    const { engine, source } = game(); const subject = zone === 'hand' ? source : engine.roomState.players.player1.deck.at(-1)!;
    engine.applyMutations([{ type: 'MOVE_CARD', cardUuid: subject.uuid, playerId: 'player1', from: zone, to: 'graveyard' }]);
    expect(engine.drainEventBatches().flatMap(b => b.events).filter(e => e.eventId.startsWith('CARD_DISCARDED'))).toEqual([]);
  });

  it.each([0, 1, 5])('turns a count of %s into a bounded existence bonus', count => {
    const query = { numeric: { kind: 'query', id: 'exists', args: { scope: { zones: ['battlefield'], controller: 'self', cardTypes: ['Creature'] } } } };
    expect(evaluateNumericValue(query, { count: () => count })).toEqual({ ok: true, value: count ? 1 : 0 });
  });

  it.each(['hand', 'library'] as const)('queues only the matching source trigger for %s discard', zone => {
    const { engine, source } = game(); const observer = card('worlds-traveler', 'battlefield');
    observer.blueprint = normalizeCard({ id: 'discard-observer', cardTypes: ['Creature'], power: 1, toughness: 2, abilities: ['HAND', 'LIBRARY'].map(from => ({ id: from, type: 'triggered', triggerCondition: 'ON_DISCARD_FROM_' + from, effectId: 'MODIFY_LIFE', params: { amount: 1 } })) });
    engine.roomState.battlefield = [observer]; const subject = zone === 'hand' ? source : engine.roomState.players.player1.deck.at(-1)!;
    engine.applyMutations([{ type: 'MOVE_CARD', cardUuid: subject.uuid, playerId: 'player1', from: zone, to: 'graveyard', reason: 'discard' }]);
    expect(engine.roomState.stack.map(s => s.ability?.id)).toEqual([zone.toUpperCase()]);
  });

  it.each(['cancel_event', 'move_destination'] as const)('does not emit completed library discard when replacement is %s', type => {
    const { engine } = game(); const c = engine.roomState.players.player1.deck.at(-1)!;
    engine.roomState.replacementEffects = [{ id: 'replace', label: 'Replace discard', match: { kinds: ['discard'], from: 'library' }, operation: type === 'cancel_event' ? { type } : { type, to: 'exile' } }];
    engine.applyMutations([{ type: 'MOVE_CARD', cardUuid: c.uuid, playerId: 'player1', from: 'library', to: 'graveyard', reason: 'discard' }]);
    expect(engine.drainEventBatches().flatMap(b => b.events).some(e => e.eventId === 'CARD_DISCARDED_FROM_LIBRARY')).toBe(false);
  });

  it.each([0, 1, 3])('discards the top available library cards without a draw failure (size=%s)', size => {
    const { engine, source } = spell([{ action: 'DISCARD_FROM_LIBRARY', params: { amount: 2 }, targeting: opponent }]);
    const cards = Array.from({ length: size }, () => card('land-red', 'library', 'player2')); engine.roomState.players.player2.deck = cards;
    cast(engine, source);
    expect(engine.roomState.players.player2.graveyard.map(c => c.uuid)).toEqual(cards.slice(-2).reverse().map(c => c.uuid));
    expect(engine.roomState.players.player2.deck.map(c => c.uuid)).toEqual(cards.slice(0, Math.max(0, size - 2)).map(c => c.uuid));
    expect(engine.roomState.status).toBe('playing');
    expect(engine.drainEventBatches().flatMap(b => b.events).filter(e => e.eventId === 'CARD_DISCARDED_FROM_LIBRARY')).toHaveLength(Math.min(size, 2));
  });

  it('draws then selects hand discards, resumes after serialization and never redraws', () => {
    const { engine, source } = spell([{ action: 'DRAW', params: { amount: 3 }, targeting: self }, { action: 'DISCARD_FROM_HAND', params: { amount: 2 }, targeting: self, choice: { kind: 'discard' } }]);
    cast(engine, source); expect(engine.roomState.players.player1.hand).toHaveLength(3);
    const c = engine.roomState.pendingChoice!; expect(c).toMatchObject({ kind: 'discard', min: 2, max: 2 });
    if (c.kind === 'number') throw new Error('Expected discard');
    expect(engine.executePlayerAction('player1', 'choose', { choiceId: c.id, choices: [c.options[0].id, c.options[0].id] }).success).toBe(false);
    const resumed = new GameEngine(JSON.parse(JSON.stringify(engine.roomState))); resumed.initRoom(); engines.push(resumed);
    choose(resumed); expect(resumed.roomState.players.player1.hand).toHaveLength(1);
    expect(resumed.roomState.players.player1.deck).toHaveLength(9);
    expect(resumed.roomState.players.player1.graveyard).toHaveLength(3);
    expect(resumed.roomState.pendingChoice).toBeNull(); expect(resumed.roomState.stack).toEqual([]);
    expect(resumed.drainEventBatches().flatMap(b => b.events).filter(e => e.eventId === 'CARD_DISCARDED_FROM_HAND')).toHaveLength(2);
  });

  it.each([0, 1])('discards as much as possible from a short hand of %s cards', size => {
    const { engine, source } = spell([{ action: 'DISCARD_FROM_HAND', params: { amount: 2 }, targeting: self, choice: { kind: 'discard' } }]);
    for (let i = 0; i < size; i++) engine.roomState.players.player1.hand.push(card('land-red', 'hand'));
    cast(engine, source);
    if (size) { expect(engine.roomState.pendingChoice).toMatchObject({ min: 1, max: 1 }); choose(engine); }
    expect(engine.roomState.pendingChoice).toBeNull(); expect(engine.roomState.players.player1.hand).toEqual([]);
    expect(engine.roomState.stack).toEqual([]);
  });

  it('lets the affected opponent choose their own hand discards', () => {
    const { engine, source } = spell([{ action: 'DISCARD_FROM_HAND', params: { amount: 1 }, targeting: opponent, choice: { kind: 'discard' } }]);
    const enemy = card('land-red', 'hand', 'player2'); engine.roomState.players.player2.hand = [enemy];
    cast(engine, source); expect(engine.roomState.pendingChoice?.playerId).toBe('player2'); choose(engine);
    expect(engine.roomState.players.player2.graveyard[0].uuid).toBe(enemy.uuid);
  });

  it.each([false, true])('keeps damage and draw in one ordinary trigger (target leaves=%s)', leaves => {
    const { engine, source } = game(); source.state.zone = 'battlefield'; engine.roomState.players.player1.hand = [];
    source.blueprint = normalizeCard({ id: 'ordered-observer', cardTypes: ['Creature'], power: 1, toughness: 2, abilities: [{ id: 'attack', type: 'triggered', triggerCondition: 'ON_ATTACK', effects: [
      { action: 'MODIFY_STATS', params: { damage: 2 }, tags: ['damage'], targeting: { type: 'permanent', controller: 'opponent', cardTypes: ['Creature'], required: true } },
      { action: 'DRAW', params: { amount: 1 }, targeting: self },
    ] }] });
    const enemy = card('musketeer-infantry', 'battlefield', 'player2'); engine.roomState.battlefield = [source, enemy];
    engine.roomState.phase = 'declareAttackersStep'; engine.roomState.priorityPlayerId = null;
    expect(engine.executePlayerAction('player1', 'declare_attackers', { attackers: [{ cardUuid: source.uuid }] }).success).toBe(true);
    choose(engine); expect(engine.roomState.stack).toHaveLength(1); expect(engine.roomState.stack[0].effects).toHaveLength(2);
    if (leaves) engine.applyMutations([{ type: 'MOVE_CARD', cardUuid: enemy.uuid, playerId: 'player2', from: 'battlefield', to: 'graveyard' }]);
    engine.resolveTopOfStack(); expect(engine.roomState.players.player1.hand).toHaveLength(leaves ? 0 : 1);
    if (!leaves) expect(engine.roomState.battlefield.find(c => c.uuid === enemy.uuid)?.state.damageTaken).toBe(2);
  });

  it('runs an ordered delayed trigger through the same effect-list path', () => {
    const { engine, source } = game(); const ability = normalizeAbility({ id: 'delayed', type: 'triggered', triggerCondition: 'ON_LIFE_GAIN', effects: [
      { action: 'DRAW', params: { amount: 1 }, targeting: self }, { action: 'ADD_MANA', params: { color: 'blue', amount: 1 }, targeting: self },
    ] }) as TriggeredAbility;
    engine.applyMutations([{ type: 'ADD_DELAYED_TRIGGER', registration: { id: '', source, controllerId: 'player1', ability, lifetime: 'once' } }]);
    engine.applyMutations([{ type: 'SET_LIFE', playerId: 'player1', amount: 21 }]); engine.resolveTopOfStack();
    expect(engine.roomState.players.player1.hand).toHaveLength(2); expect(engine.roomState.players.player1.mana.blue).toBe(6);
  });

  it('validates numeric expressions in every ordered trigger instruction', () => {
    expect(() => normalizeAbility({ id: 'bad', type: 'triggered', effects: [
      { action: 'DRAW', params: { amount: 1 }, targeting: self },
      { action: 'DRAW', params: { amount: { numeric: { kind: 'binding', name: 'X' } } }, targeting: self },
    ] })).toThrow('Numeric binding');
  });

  it.each([
    ['rise-of-power', 'empire-servant', 'player1', 0, 2], ['rise-of-power', 'empire-servant', 'player2', 1, 3], ['rise-of-power', 'empire-servant', 'player1', 3, 3],
    ['pursuit-of-purifying-fire', 'fatiao-warrior', 'player2', 1, 2], ['pursuit-of-purifying-fire', 'fatiao-warrior', 'player1', 1, 3], ['pursuit-of-purifying-fire', 'fatiao-warrior', 'player1', 3, 3],
  ] as const)('%s checks its printed existence scope (%s/%s/%s)', (id, matching, player, count, amount) => {
    const { engine, source } = game(id); engine.roomState.battlefield = Array.from({ length: count }, () => card(matching, 'battlefield', player));
    cast(engine, source); expect(engine.roomState.players.player1.hand).toHaveLength(amount);
  });

  it('reevaluates the bonus when 追求淨化之火 resolves', () => {
    const { engine, source } = game('pursuit-of-purifying-fire'); const dragon = card('fatiao-warrior', 'battlefield'); engine.roomState.battlefield = [dragon];
    expect(engine.executePlayerAction('player1', 'cast_spell', { cardUuid: source.uuid }).success).toBe(true);
    engine.applyMutations([{ type: 'MOVE_CARD', cardUuid: dragon.uuid, playerId: 'player1', from: 'battlefield', to: 'graveyard' }]);
    engine.resolveTopOfStack(); expect(engine.roomState.players.player1.hand).toHaveLength(2);
  });

  it('uses 蒼海巡察組’s printed entry discard from the opposing library', () => {
    const { engine, source } = game('sea-patrol'); cast(engine, source); engine.resolveTopOfStack();
    expect(source.blueprint).toMatchObject({ colors: ['blue'], power: 2, toughness: 2 });
    expect(engine.roomState.players.player2.deck).toHaveLength(10);
    expect(engine.roomState.turnHistory?.counts.CARD_DISCARDED_FROM_LIBRARY).toBe(2);
  });

  it.each([['sea-city-noble', 1], ['worlds-traveler', 0]] as const)('uses 深淵幻士’s friendly 蒼巨人 attack filter (%s)', (attacker, amount) => {
    const { engine, source } = game('abyss-illusionist'); cast(engine, source);
    const ally = card(attacker, 'battlefield'); engine.roomState.battlefield.push(ally);
    engine.roomState.phase = 'declareAttackersStep'; engine.roomState.priorityPlayerId = null;
    expect(engine.executePlayerAction('player1', 'declare_attackers', { attackers: [{ cardUuid: ally.uuid }] }).success).toBe(true);
    engine.resolveTopOfStack(); expect(engine.roomState.players.player2.deck).toHaveLength(12 - amount);
  });

  it('uses 諸界海之主’s live friendly 幽爾 count for its library discard amount', () => {
    const { engine, source } = game('worlds-sea-lord'); cast(engine, source);
    engine.roomState.battlefield.push(card('worlds-traveler', 'battlefield'), card('sea-city-noble', 'battlefield'), card('worlds-traveler', 'battlefield', 'player2'));
    engine.roomState.battlefield.find(c => c.uuid === source.uuid)!.state.summoningSickness = false;
    engine.roomState.phase = 'declareAttackersStep'; engine.roomState.priorityPlayerId = null;
    expect(engine.executePlayerAction('player1', 'declare_attackers', { attackers: [{ cardUuid: source.uuid }] }).success).toBe(true);
    engine.resolveTopOfStack(); expect(engine.roomState.players.player2.deck).toHaveLength(8);
  });

  it('uses 狂海幻力’s actual draw-three then selected discard-two instructions', () => {
    const { engine, source } = game('raging-sea-power'); cast(engine, source); choose(engine);
    expect(engine.roomState.players.player1.hand).toHaveLength(1); expect(engine.roomState.players.player1.graveyard).toHaveLength(3);
  });

  it('runs 諸界火術士 from another friendly 幽爾 attacker and resolves damage then draw', () => {
    const { engine, source } = game('worlds-pyromancer'); cast(engine, source);
    const ally = card('worlds-traveler', 'battlefield'), enemy = card('musketeer-infantry', 'battlefield', 'player2'); engine.roomState.battlefield.push(ally, enemy);
    engine.roomState.phase = 'declareAttackersStep'; engine.roomState.priorityPlayerId = null;
    expect(engine.executePlayerAction('player1', 'declare_attackers', { attackers: [{ cardUuid: ally.uuid }] }).success).toBe(true);
    choose(engine); engine.resolveTopOfStack();
    expect(engine.roomState.battlefield.find(c => c.uuid === enemy.uuid)?.state.damageTaken).toBe(2); expect(engine.roomState.players.player1.hand).toHaveLength(1);
    expect(engine.drainEventBatches().flatMap(b => b.events).filter(e => e.eventId === 'STACK_ITEM_RESOLVED').map(e => e.payload.effectId)).toEqual(['MODIFY_STATS', 'DRAW']);
  });

  it.each([false, true])('keeps 幻海人 戈圖’s optional entry group together (accept=%s)', accept => {
    const { engine, source } = game('phantom-sea-gotu'); cast(engine, source); engine.resolveTopOfStack();
    choose(engine, [accept ? 'accept' : 'decline']);
    if (accept) choose(engine);
    expect(engine.roomState.players.player1.hand).toHaveLength(accept ? 1 : 0);
    expect(engine.roomState.pendingChoice).toBeNull();
    engine.roomState.battlefield.find(c => c.uuid === source.uuid)!.state.summoningSickness = false;
    engine.roomState.phase = 'declareAttackersStep'; engine.roomState.priorityPlayerId = null;
    expect(engine.executePlayerAction('player1', 'declare_attackers', { attackers: [{ cardUuid: source.uuid }] }).success).toBe(true);
    engine.resolveTopOfStack(); expect(engine.roomState.players.player2.deck).toHaveLength(10);
  });
});
