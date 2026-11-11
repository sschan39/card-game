import { afterEach, describe, expect, it } from 'vitest';
import { GameEngine } from '@engine/game-engine';
import { gameReducer } from '@engine/game-reducer';
import { parseInstructionDefinition } from '@library/card-parser';
import { collectCardSource } from '@rules/card-collections';
import { baseCardVisibility } from '@rules/card-visibility';
import { createCardState } from '@rules/card-state';
import { instantiateCard } from '@library/card-factory';
import type { GameMutation } from '@shared/game-mutation.types';
import {
  capture,
  privateVisibility,
  publicVisibility,
  pause,
  windowSource,
  windowCard,
  windowGame,
  answerWindow,
} from '../helpers/card-window-fixture';

const engines: GameEngine[] = [];
afterEach(() => engines.splice(0).forEach((engine) => engine.dispose()));
function start(...args: Parameters<typeof windowGame>) {
  const game = windowGame(...args);
  engines.push(game.engine);
  return game;
}
function results(engine: GameEngine) {
  const choice = engine.roomState.pendingChoice!;
  if (choice.continuation.type !== 'resolution') throw new Error('Expected resolution');
  return choice.continuation.stackObj.resolutionResults!;
}

describe('captured card windows', () => {
  it('captures exactly six unmoved cards in source order, with ordinary hidden base visibility', () => {
    const { engine } = start();
    const before = JSON.stringify(engine.roomState.players.player1.deck);
    expect(engine.resolveTopOfStack().success).toBe(true);
    expect(JSON.stringify(engine.roomState.players.player1.deck)).toBe(before);
    expect(engine.roomState.players.player1.graveyard).toEqual([]);
    const set = results(engine).window;
    expect(set.kind).toBe('captured');
    expect(set.cards.map((entry) => entry.before.card.uuid)).toEqual([
      'hidden-7',
      'hidden-6',
      'hidden-5',
      'hidden-4',
      'hidden-3',
      'hidden-2',
    ]);
    expect(set.cards.every((entry) => entry.after === undefined)).toBe(true);
    expect(engine.roomState.players.player1.deck.every((card) => baseCardVisibility(card) === 'hidden')).toBe(true);
    expect(
      engine
        .drainEventBatches()
        .flatMap((batch) => batch.events)
        .filter((e) => e.eventId === 'CARD_REVEALED'),
    ).toEqual([]);
  });
  it('selects independently, mills the exact remainder, and counts the original observations', () => {
    const cards = [
      windowCard('deep'),
      windowCard('other'),
      windowCard('c1'),
      windowCard('a1', 'player1', 'Artifact'),
      windowCard('c2'),
      windowCard('a2', 'player1', 'Artifact'),
      windowCard('c3'),
      windowCard('c4'),
    ];
    const select = (type: string) => ({
      family: 'cards',
      operation: 'move',
      params: { origin: 'library', destination: 'hand' },
      choice: { kind: 'search', zone: 'library', from: windowSource, cardTypes: [type], min: 1, max: 1 },
    });
    const { engine } = start(
      [
        capture(),
        select('Creature'),
        select('Artifact'),
        {
          family: 'cards',
          operation: 'mill',
          params: { from: windowSource },
          recordResult: { name: 'remainder', kind: 'milled' },
        },
        {
          family: 'resources',
          operation: 'adjust_life',
          params: {
            amount: {
              numeric: { kind: 'query', id: 'count', args: { scope: { from: { ...windowSource, view: 'recorded' } } } },
            },
          },
        },
        pause,
      ],
      cards,
    );
    engine.resolveTopOfStack();
    expect(answerWindow(engine, ['c4']).success).toBe(true);
    expect(answerWindow(engine, ['a1']).success).toBe(true);
    expect(engine.roomState.players.player1.hand.map((c) => c.uuid)).toEqual(['c4', 'a1']);
    expect(engine.roomState.players.player1.graveyard.map((c) => c.uuid)).toEqual(['c3', 'a2', 'c2', 'c1']);
    expect(engine.roomState.players.player1.deck.map((c) => c.uuid)).toEqual(['deep', 'other']);
    expect(engine.roomState.players.player1.life).toBe(26);
    expect(results(engine).remainder.cards).toHaveLength(4);
  });
  it.each([0, 2])('records the actual available window when only %s cards exist', (size) => {
    const { engine } = start(
      [capture(), pause],
      Array.from({ length: size }, (_, i) => windowCard('short-' + i)),
    );
    engine.resolveTopOfStack();
    expect(results(engine).window.cards).toHaveLength(size);
    expect(engine.roomState.players.player1.failedDraw).toBeUndefined();
    expect(answerWindow(engine, ['no']).success).toBe(true);
    expect(engine.roomState.cardObservations?.active).toEqual({});
  });
  it('skips a declined optional capture branch without creating an observation or event', () => {
    const { engine } = start([
      {
        family: 'resources',
        operation: 'pay_cost',
        params: { cost: {}, then: [capture({ event: 'revealed', visibility: publicVisibility })] },
      },
    ]);
    engine.resolveTopOfStack();
    expect(answerWindow(engine, ['no']).success).toBe(true);
    expect(engine.roomState.cardObservations).toBeUndefined();
    expect(
      engine
        .drainEventBatches()
        .flatMap((batch) => batch.events)
        .some((e) => e.eventId === 'CARD_REVEALED'),
    ).toBe(false);
  });
  it('keeps replacement destinations and mill arrival accounting for a captured remainder', () => {
    const { engine } = start([
      capture(),
      {
        family: 'cards',
        operation: 'mill',
        params: { from: windowSource },
        recordResult: { name: 'remainder', kind: 'milled' },
      },
      pause,
    ]);
    engine.roomState.replacementEffects = [
      {
        id: 'exile-instead',
        label: 'Exile instead',
        match: { kinds: ['discard'], from: 'library', to: 'graveyard' },
        operation: { type: 'move_destination', to: 'exile' },
      },
    ];
    engine.resolveTopOfStack();
    expect(engine.roomState.players.player1.graveyard).toEqual([]);
    expect(engine.roomState.players.player1.exile).toHaveLength(6);
    expect(results(engine).remainder.cards.every((entry) => entry.after?.card.state.zone === 'exile')).toBe(true);
  });
  it('retains capture and result ownership through a serialized replacement decision', () => {
    const { engine } = start([
      capture(),
      {
        family: 'cards',
        operation: 'mill',
        params: { from: windowSource },
        recordResult: { name: 'remainder', kind: 'milled' },
      },
      pause,
    ]);
    engine.roomState.replacementEffects = [
      {
        id: 'exile-one',
        label: 'Exile one instead',
        optional: true,
        match: { kinds: ['discard'], card: { cardUuid: 'hidden-7', zoneRevision: 0 } },
        operation: { type: 'move_destination', to: 'exile' },
      },
    ];
    engine.resolveTopOfStack();
    expect(engine.roomState.pendingChoice?.continuation.type).toBe('replacement');
    const restored = new GameEngine(JSON.parse(JSON.stringify(engine.roomState)));
    engines.push(restored);
    restored.initRoom();
    expect(answerWindow(restored, ['exile-one']).success).toBe(true);
    expect(restored.roomState.players.player1.exile?.map((c) => c.uuid)).toEqual(['hidden-7']);
    expect(restored.roomState.players.player1.graveyard).toHaveLength(5);
    expect(results(restored).remainder.cards).toHaveLength(6);
    expect(restored.roomState.cardObservations?.history).toHaveLength(1);
    expect(answerWindow(restored, ['no']).success).toBe(true);
    expect(restored.roomState.cardObservations?.active).toEqual({});
  });
  it('does not add a later returned incarnation to the captured current set', () => {
    const { engine } = start();
    engine.resolveTopOfStack();
    const old = engine.roomState.players.player1.deck[7];
    engine.applyMutations([
      { type: 'MOVE_CARD', cardUuid: old.uuid, playerId: 'player1', from: 'library', to: 'graveyard' },
      { type: 'MOVE_CARD', cardUuid: old.uuid, playerId: 'player1', from: 'graveyard', to: 'library' },
    ]);
    const members = collectCardSource(engine.roomState.players.player1.deck, windowSource, results(engine))!;
    expect(members.map((member) => member.card.uuid)).not.toContain(old.uuid);
    expect(members).toHaveLength(5);
    expect(collectCardSource([], { ...windowSource, view: 'recorded' }, results(engine))).toHaveLength(6);
  });
  it('survives reconstruction and closes active grants without removing legitimate history', () => {
    const { engine } = start();
    engine.resolveTopOfStack();
    const restored = new GameEngine(JSON.parse(JSON.stringify(engine.roomState)));
    engines.push(restored);
    restored.initRoom();
    expect(answerWindow(restored, ['no']).success).toBe(true);
    expect(restored.roomState.cardObservations?.active).toEqual({});
    expect(restored.roomState.cardObservations?.history).toHaveLength(1);
    expect(restored.roomState.players.player1.deck).toHaveLength(8);
    expect(JSON.stringify(restored.roomState.pendingChoice)).not.toContain('resolutionResults');
  });
  it('has replay-safe monotonic observation mutations', () => {
    const { engine } = start();
    const before = structuredClone(engine.roomState);
    const result = engine.resolveTopOfStack();
    const observation = result.success && result.mutations?.find((m) => m.type === 'RECORD_CARD_OBSERVATION');
    expect(observation).toBeTruthy();
    const once = gameReducer(before, observation as GameMutation);
    expect(gameReducer(once, observation as GameMutation)).toBe(once);
    expect(once.cardObservations?.history).toHaveLength(1);
  });
  it('does not capture or expose anything when the object is countered', () => {
    const { engine } = start(undefined, undefined, 'player1', true);
    engine.resolveTopOfStack();
    expect(engine.roomState.cardObservations).toBeUndefined();
  });
  it('fails closed for an invisible captured choice, while automatic rule queries can use the set', () => {
    const { engine } = start([
      capture({ visibility: { faces: [], count: [], order: [], expires: 'resolution_end' } }),
      {
        family: 'cards',
        operation: 'move',
        params: { origin: 'library', destination: 'hand' },
        choice: { kind: 'search', zone: 'library', from: windowSource, min: 0, max: 1 },
      },
    ]);
    engine.resolveTopOfStack();
    expect(engine.roomState.pendingChoice?.options).toEqual([]);
    expect(answerWindow(engine, ['hidden-7']).success).toBe(false);
    expect(answerWindow(engine, []).success).toBe(true);
    expect(engine.roomState.players.player1.hand).toEqual([]);
  });
  it('a same-zone selected subset inherits visibility revocation from its parent window', () => {
    const selectedSource = { kind: 'result', name: 'chosen' };
    const { engine } = start([
      capture(),
      {
        family: 'cards',
        operation: 'reorder_library',
        params: { placement: 'top' },
        choice: { kind: 'search', zone: 'library', from: windowSource, recordSelection: 'chosen', min: 1, max: 1 },
      },
      {
        family: 'cards',
        operation: 'set_collection_visibility',
        params: { from: windowSource, visibility: { faces: [], count: [], order: [], expires: 'resolution_end' } },
      },
      {
        family: 'cards',
        operation: 'move',
        params: { origin: 'library', destination: 'hand' },
        choice: { kind: 'search', zone: 'library', from: selectedSource, min: 0, max: 1 },
      },
    ]);
    expect(engine.resolveTopOfStack().success).toBe(true);
    expect(answerWindow(engine, ['hidden-7']).success).toBe(true);
    const sets = results(engine);
    expect(sets.chosen).toMatchObject({ kind: 'selected', observationId: sets.window.observationId });
    expect(collectCardSource(engine.roomState.players.player1.deck, { kind: 'result', name: 'chosen' }, sets)
      ?.map(entry => entry.card.uuid)).toEqual(['hidden-7']);
    expect(collectCardSource(engine.roomState.players.player1.deck, { kind: 'result', name: 'window', except: 'missing' }, sets))
      .toBeUndefined();
    expect(engine.roomState.pendingChoice?.options).toEqual([]);
    expect(answerWindow(engine, ['hidden-7']).success).toBe(false);
    expect(answerWindow(engine, []).success).toBe(true);
    expect(engine.roomState.players.player1.hand).toEqual([]);
    expect(engine.roomState.cardObservations?.active).toEqual({});
  });

  it('keeps capture and public reveal events distinct, publishing each explicit reveal once at completion', () => {
    const { engine } = start([capture({ visibility: publicVisibility, event: 'revealed' }), pause]);
    engine.resolveTopOfStack();
    expect(
      engine
        .drainEventBatches()
        .flatMap((b) => b.events)
        .filter((e) => e.eventId === 'CARD_REVEALED'),
    ).toHaveLength(0);
    answerWindow(engine, ['no']);
    expect(
      engine
        .drainEventBatches()
        .flatMap((b) => b.events)
        .filter((e) => e.eventId === 'CARD_REVEALED'),
    ).toHaveLength(6);
  });
  it('closes active grants when the stack object is removed or the game ends', () => {
    for (const finish of ['counter', 'concede']) {
      const { engine } = start();
      engine.resolveTopOfStack();
      if (finish === 'counter') engine.applyMutations([{ type: 'COUNTER_STACK', stackUuid: 'window-effect' }]);
      else engine.executePlayerAction('player1', 'concede', {});
      expect(engine.roomState.cardObservations?.active).toEqual({});
    }
  });
});

describe('strict visibility and capture schema', () => {
  it.each([
    { zone: 'hand' },
    { zonePlayer: 'any' },
    { position: 'bottom' },
    { amount: -1 },
    { amount: 0 },
    { amount: 1.5 },
    { amount: 65 },
    { extra: true },
    { event: 'looked' },
    { event: 'revealed', visibility: privateVisibility },
    { visibility: { ...privateVisibility, count: [] } },
    { visibility: { ...privateVisibility, faces: [], order: ['controller'] } },
    { visibility: { ...privateVisibility, faces: ['admin'] } },
    { visibility: { ...privateVisibility, faces: ['controller', 'controller'] } },
    { visibility: { ...privateVisibility, expires: 'turn_end' } },
    { visibility: { ...privateVisibility, public: true } },
  ])('rejects malformed or contradictory capture params: %j', (params) => {
    expect(() => parseInstructionDefinition(capture(params))).toThrow();
  });
  it('requires correctly paired result kinds and rejects snapshot-based visibility changes', () => {
    expect(() => parseInstructionDefinition({ ...capture(), recordResult: undefined })).toThrow();
    expect(() =>
      parseInstructionDefinition({ ...capture(), recordResult: { name: 'window', kind: 'milled' } }),
    ).toThrow();
    expect(() =>
      parseInstructionDefinition({
        family: 'cards',
        operation: 'mill',
        params: { amount: 1 },
        recordResult: { name: 'window', kind: 'captured' },
      }),
    ).toThrow();
    expect(() =>
      parseInstructionDefinition({
        family: 'cards',
        operation: 'set_collection_visibility',
        params: { from: { ...windowSource, view: 'recorded' }, visibility: privateVisibility },
      }),
    ).toThrow();
  });
});

describe('card instance base visibility', () => {
  it('stores zone defaults and resets them through actual movement', () => {
    const instance = instantiateCard('land-red');
    expect(createCardState(instance.blueprint, 'player1', 'player1', 'library').visibility).toBe('hidden');
    for (const zone of ['battlefield', 'graveyard', 'exile', 'stack'] as const) {
      expect(createCardState(instance.blueprint, 'player1', 'player1', zone).visibility).toBe('public');
    }
    const { engine } = start();
    const card = engine.roomState.players.player1.deck[0];
    engine.applyMutations([
      { type: 'MOVE_CARD', cardUuid: card.uuid, playerId: 'player1', from: 'library', to: 'hand' },
    ]);
    expect(engine.roomState.players.player1.hand[0].state.visibility).toBe('owner');
    engine.applyMutations([
      { type: 'MOVE_CARD', cardUuid: card.uuid, playerId: 'player1', from: 'hand', to: 'graveyard' },
    ]);
    expect(engine.roomState.players.player1.graveyard[0].state.visibility).toBe('public');
    engine.applyMutations([
      { type: 'MOVE_CARD', cardUuid: card.uuid, playerId: 'player1', from: 'graveyard', to: 'library' },
    ]);
    expect(engine.roomState.players.player1.deck.find((c) => c.uuid === card.uuid)?.state.visibility).toBe('hidden');
  });
});
