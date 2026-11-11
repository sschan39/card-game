import { afterEach, describe, expect, it } from 'vitest';
import { GameEngine } from '@engine/game-engine';
import { buildStackEffects } from '@engine/effect-resolver';
import { conditionMatches, createRuleContext } from '@engine/rule-conditions';
import { parseCardDefinition, parseInstructionDefinition } from '@library/card-parser';
import { collectCards } from '@rules/card-query';
import { cardReference } from '@rules/card-identity';
import { buildPlayerView } from '@server/projection/view-builder';
import { creature } from '../helpers/combat-fixture';
import { createTestRoom, fillTestLibraries } from '../helpers/test-room-factory';
import type { CardInstance } from '@shared/card.types';

const engines: GameEngine[] = [];
afterEach(() => engines.splice(0).forEach(engine => engine.dispose()));

const releaseAll = {
  family: 'cards',
  operation: 'move',
  params: { origin: 'hosted', destination: 'hand', host: { mode: 'release', selection: 'all' } },
};
const storeSelected = {
  family: 'cards',
  operation: 'move',
  params: { origin: 'hand', destination: 'hosted', host: { mode: 'store', visibility: 'controller' } },
  choice: { kind: 'search', zone: 'hand', min: 1, max: 1 },
};
const releaseSelected = {
  family: 'cards',
  operation: 'move',
  params: { origin: 'hosted', destination: 'battlefield', host: { mode: 'release', selection: 'selected' } },
  choice: { kind: 'search', zone: 'hosted', storedUnderSource: true, min: 1, max: 1 },
};
const hostedCount = {
  numeric: { kind: 'query' as const, id: 'count' as const, args: { scope: { storedUnderSource: true as const } } },
};

function fixture(...battlefield: CardInstance[]) {
  const room = createTestRoom({ battlefield });
  fillTestLibraries(room);
  room.players.player1.hand = [];
  const engine = new GameEngine(room);
  engines.push(engine);
  engine.initRoom();
  return engine;
}

function handCard(id: string, owner = 'player1') {
  const card = creature(id, owner);
  card.state.zone = 'hand';
  if (owner !== 'player1') card.state.handHolderId = 'player1';
  return card;
}

function addEffect(engine: GameEngine, source: CardInstance, instruction: Record<string, unknown>) {
  engine.applyMutations([{
    type: 'PUSH_STACK',
    stackObject: {
      uuid: 'test-host-instruction',
      type: 'triggered',
      source,
      controllerId: 'player1',
      countered: false,
      effects: buildStackEffects([parseInstructionDefinition(instruction)], 'player1', source),
    },
  }]);
}

function resolve(engine: GameEngine) {
  expect(engine.resolveTopOfStack().success).toBe(true);
}

function choose(engine: GameEngine, ids: string[]) {
  const choice = engine.roomState.pendingChoice!;
  expect(engine.executePlayerAction(choice.playerId, 'choose', { choiceId: choice.id, choices: ids }).success).toBe(true);
}

describe('cards stored under a host', () => {
  it('moves the same physical card and projects its face to the controller who stored it', () => {
    const host = creature('host', 'player1');
    const other = creature('other-host', 'player1');
    const engine = fixture(host, other);
    const borrowed = handCard('stored-from-borrowed-hand', 'player2');
    engine.roomState.players.player1.hand.push(borrowed);

    addEffect(engine, host, storeSelected);
    resolve(engine);
    choose(engine, [borrowed.uuid]);

    expect(engine.roomState.players.player1.hand).toHaveLength(0);
    const stored = engine.roomState.players.player2.hosted?.[0];
    expect(stored).toMatchObject({
      uuid: borrowed.uuid,
      state: { zone: 'hosted', ownerId: 'player2', zoneRevision: 1, hostedBy: {
        host: cardReference(host), viewerId: 'player1',
      } },
    });
    expect(collectCards(engine.roomState, { zones: ['exile'] })).toEqual([]);
    expect(collectCards(engine.roomState, { host: cardReference(host) })).toEqual([stored]);
    expect(collectCards(engine.roomState, { host: cardReference(other) })).toEqual([]);
    const count = { op: 'eq' as const, left: hostedCount, right: 1 };
    expect(conditionMatches(count, createRuleContext(engine.roomState, host, 'player1'))).toBe(true);
    expect(conditionMatches(count, createRuleContext(engine.roomState, other, 'player1'))).toBe(false);

    expect(buildPlayerView(engine.roomState, 'player1').hostedCards?.[0].cards.map(card => card.uuid)).toEqual([borrowed.uuid]);
    expect(buildPlayerView(engine.roomState, 'player2').hostedCards).toBeUndefined();
    expect(JSON.stringify(buildPlayerView(engine.roomState, 'player2'))).not.toContain(borrowed.uuid);
  });

  it('a destruction trigger releases the former host collection, including cards stored face down', () => {
    const host = creature('host', 'player1');
    const other = creature('other-host', 'player1');
    host.blueprint = parseCardDefinition({
      schemaVersion: 1, id: 'host', name: 'Host', cardTypes: ['Artifact'],
      abilities: [{
        id: 'release-at-destruction', type: 'triggered', triggerCondition: 'ON_DESTROY',
        trigger: { listener: { kind: 'event_card', state: 'before', zones: ['battlefield'] } },
        effects: [{ ...releaseAll, choice: { kind: 'optional' } }],
      }],
    });
    const engine = fixture(host, other);
    const first = handCard('stored-first');
    const second = handCard('stored-second');
    engine.roomState.players.player1.hand.push(first, second);
    for (const [card, owner] of [[first, host], [second, other]]) {
      engine.applyMutations([{
        type: 'MOVE_CARD', cardUuid: card.uuid, playerId: 'player1', from: 'hand', to: 'hosted',
        toHost: { host: cardReference(owner), visibility: 'hidden' },
      }]);
    }
    expect(buildPlayerView(engine.roomState, 'player1').hostedCards).toBeUndefined();
    engine.applyMutations([{ type: 'DESTROY_CARD', ...cardReference(host) }]);
    expect(engine.roomState.stack).toHaveLength(1);
    resolve(engine);
    choose(engine, ['yes']);
    expect(engine.roomState.players.player1.hand.map(card => card.uuid)).toEqual([first.uuid]);
    expect(engine.roomState.players.player1.hosted?.map(card => card.uuid)).toEqual([second.uuid]);
    expect(engine.roomState.players.player1.hand[0].state.hostedBy).toBeUndefined();
  });

  it('scopes release choices to visible cards under this incarnation and deploys through a normal move', () => {
    const host = creature('host', 'player1');
    const other = creature('other-host', 'player1');
    const engine = fixture(host, other);
    const shown = handCard('shown');
    const hidden = handCard('hidden');
    const elsewhere = handCard('other-card');
    engine.roomState.players.player1.hand.push(shown, hidden, elsewhere);
    engine.applyMutations([
      { type: 'MOVE_CARD', cardUuid: shown.uuid, playerId: 'player1', from: 'hand', to: 'hosted',
        toHost: { host: cardReference(host), visibility: 'public' } },
      { type: 'MOVE_CARD', cardUuid: hidden.uuid, playerId: 'player1', from: 'hand', to: 'hosted',
        toHost: { host: cardReference(host), visibility: 'hidden' } },
      { type: 'MOVE_CARD', cardUuid: elsewhere.uuid, playerId: 'player1', from: 'hand', to: 'hosted',
        toHost: { host: cardReference(other), visibility: 'public' } },
    ]);
    expect(buildPlayerView(engine.roomState, 'player2').hostedCards?.find(group => group.hostUuid === host.uuid)
      ?.cards.map(card => card.uuid)).toEqual([shown.uuid]);
    addEffect(engine, host, releaseSelected);
    resolve(engine);
    const choice = engine.roomState.pendingChoice;
    if (choice?.kind !== 'search') throw new Error('Expected hosted search');
    expect(choice.options.map(option => option.id)).toEqual([shown.uuid]);
    expect(engine.executePlayerAction('player1', 'choose', { choiceId: choice.id, choices: [elsewhere.uuid] }).success).toBe(false);
    choose(engine, [shown.uuid]);
    expect(engine.roomState.battlefield.find(card => card.uuid === shown.uuid)?.state).toMatchObject({
      zone: 'battlefield', zoneRevision: 2, visibility: 'public', summonKind: 'effect',
    });
    expect(engine.roomState.players.player1.hosted?.map(card => card.uuid)).toEqual([hidden.uuid, elsewhere.uuid]);

    engine.applyMutations([
      { type: 'MOVE_CARD', cardUuid: host.uuid, playerId: 'player1', from: 'battlefield', to: 'exile' },
      { type: 'MOVE_CARD', cardUuid: host.uuid, playerId: 'player1', from: 'exile', to: 'battlefield' },
    ]);
    const returned = engine.roomState.battlefield.find(card => card.uuid === host.uuid)!;
    expect(collectCards(engine.roomState, { host: cardReference(returned) })).toEqual([]);
    engine.applyMutations([{
      type: 'MOVE_CARD', cardUuid: hidden.uuid, playerId: 'player1', from: 'hosted', to: 'hand', fromHost: cardReference(returned),
    }]);
    expect(engine.roomState.players.player1.hand).toEqual([]);
  });

  it('checks mana activations against the live hosted count without refreshing spent uses', () => {
    const host = creature('mana-host', 'player1');
    host.blueprint = parseCardDefinition({
      schemaVersion: 1, id: 'mana-host', name: 'Mana host', cardTypes: ['Land'],
      abilities: [{
        id: 'hosted-mana', type: 'activated', cost: {},
        usage: { period: 'turn', limit: hostedCount, identity: 'source_incarnation', consume: 'on_commit' },
        effect: { family: 'resources', operation: 'add_mana', params: { color: 'green', amount: 1 } },
      }],
    });
    const engine = fixture(host);
    const startingMana = engine.roomState.players.player1.mana.green;
    const use = () => engine.executePlayerAction('player1', 'tapForMana', { cardUuid: host.uuid, abilityId: 'hosted-mana' }).success;
    const deposit = (card: CardInstance) => {
      engine.roomState.players.player1.hand.push(card);
      engine.applyMutations([{
        type: 'MOVE_CARD', cardUuid: card.uuid, playerId: 'player1', from: 'hand', to: 'hosted',
        toHost: { host: cardReference(host), visibility: 'public' },
      }]);
    };
    const first = handCard('first-for-mana');
    expect(use()).toBe(false);
    deposit(first);
    expect(use()).toBe(true);
    expect(use()).toBe(false);
    deposit(handCard('second-for-mana'));
    expect(use()).toBe(true);
    expect(use()).toBe(false);
    engine.applyMutations([{
      type: 'MOVE_CARD', cardUuid: first.uuid, playerId: 'player1', from: 'hosted', to: 'hand',
      fromHost: cardReference(host),
    }]);
    deposit(handCard('third-for-mana'));
    expect(use()).toBe(false);
    expect(engine.roomState.players.player1.mana.green).toBe(startingMana + 2);
  });

  it('waives a life-gain trigger limit while the host condition holds and restores the same budget', () => {
    const host = creature('draw-host', 'player1');
    host.blueprint = parseCardDefinition({
      schemaVersion: 1, id: 'draw-host', name: 'Draw host', cardTypes: ['Artifact'],
      abilities: [{
        id: 'draw-on-heal', type: 'triggered', triggerCondition: 'ON_LIFE_GAIN',
        trigger: { controller: 'self', listener: { kind: 'watcher', activeZones: ['battlefield'] } },
        usage: {
          period: 'turn', limit: 1, identity: 'source_incarnation', consume: 'on_commit',
          waivedWhen: { op: 'gte', left: hostedCount, right: 3 },
        },
        effects: [{ family: 'cards', operation: 'draw', params: { amount: 1 } }],
      }],
    });
    const engine = fixture(host);
    const gain = (shouldTrigger: boolean) => {
      engine.applyMutations([{ type: 'CHANGE_LIFE', playerId: 'player1', amount: 1, healing: true }]);
      expect(engine.roomState.stack).toHaveLength(shouldTrigger ? 1 : 0);
      if (shouldTrigger) resolve(engine);
    };
    gain(true);
    gain(false);
    const cards = ['first-held-land', 'second-held-land', 'third-held-land'].map(id => handCard(id));
    engine.roomState.players.player1.hand.push(...cards);
    engine.applyMutations(cards.map(card => ({
      type: 'MOVE_CARD', cardUuid: card.uuid, playerId: 'player1', from: 'hand', to: 'hosted',
      toHost: { host: cardReference(host), visibility: 'public' },
    })));
    engine.applyMutations([{ type: 'SET_TURN', playerId: 'player2', advance: true }]);
    gain(true);
    gain(true);
    addEffect(engine, host, releaseAll);
    resolve(engine);
    gain(false);
    engine.applyMutations([{ type: 'SET_TURN', playerId: 'player1', advance: true }]);
    gain(true);
    gain(false);
  });

  it('requires explicit hosting or release instructions and a bound hosted search', () => {
    for (const instruction of [
      { ...storeSelected, params: { origin: 'hand', destination: 'hosted' } },
      { ...releaseAll, params: { origin: 'hosted', destination: 'hand' } },
      { ...releaseSelected, choice: { kind: 'search', zone: 'hosted', min: 1, max: 1 } },
      { ...releaseAll, choice: { kind: 'selection', criteria: { type: 'card', zones: ['hosted'], required: true } } },
    ]) expect(() => parseInstructionDefinition(instruction)).toThrow();
  });
});
