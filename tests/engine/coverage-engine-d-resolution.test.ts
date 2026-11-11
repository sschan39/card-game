import { describe, expect, it } from 'vitest';
import { applyResolutionChoice, resolutionChoice } from '@engine/resolution-choices';
import {
  buildDynamicParams,
  buildStackEffects,
  instructionConditionMatches,
  resolutionNumericContext,
  revalidateTargets,
} from '@engine/resolution-planning';
import { createRuleContext } from '@engine/rule-conditions';
import { captureSourceInformation } from '@engine/source-information';
import { instantiateCard } from '@library/card-factory';
import { createTestRoom } from '../helpers/test-room-factory';
import { creature } from '../helpers/combat-fixture';
import type { CardInstance } from '@shared/card.types';
import type { GameRoom } from '@shared/game.room.types';
import type { ChoiceAnswer, ListedChoice, PendingChoice, ResolutionContinuation } from '@shared/choice.types';
import type { StackEffect, StackObject } from '@shared/effect.types';

function spell(room: GameRoom, overrides: Partial<StackObject> = {}): StackObject {
  const source = room.battlefield[0] ?? creature('source', 'player1');
  return {
    type: 'spell',
    uuid: 'spell',
    source,
    controllerId: 'player1',
    effects: [],
    countered: false,
    ...overrides,
  } as StackObject;
}

function stackEffect(overrides: Partial<StackEffect> = {}): StackEffect {
  return {
    action: 'TAP',
    params: {},
    tags: [],
    targets: [],
    targeting: { type: 'self', required: false },
    ...overrides,
  } as StackEffect;
}

function handCard(room: GameRoom, playerId: 'player1' | 'player2'): CardInstance {
  const card = instantiateCard('empire-servant');
  card.state = { ...card.state, zone: 'hand', ownerId: playerId, controllerId: playerId };
  room.players[playerId].hand.push(card);
  return card;
}

const results: ResolutionContinuation['results'] = [];

function listed(choice: PendingChoice): ListedChoice {
  return choice as ListedChoice;
}

describe('resolution choice construction', () => {
  it('builds an empty discard choice without a player recipient', () => {
    const room = createTestRoom();
    const choice = listed(resolutionChoice(room, spell(room), stackEffect({ action: 'DISCARD_FROM_HAND', params: { amount: 2 }, choice: { kind: 'discard' } }), 0, results));
    expect(choice).toMatchObject({ kind: 'discard', playerId: 'player1', min: 0, max: 0, options: [] });
  });

  it('clamps a discard choice to the recipient hand', () => {
    const room = createTestRoom();
    handCard(room, 'player2');
    const effect = stackEffect({
      action: 'DISCARD_FROM_HAND',
      params: { amount: 2 },
      targets: [{ targetType: 'player', playerId: 'player2' }],
      choice: { kind: 'discard' },
    });
    const choice = listed(resolutionChoice(room, spell(room), effect, 0, results));
    expect(choice).toMatchObject({ playerId: 'player2', min: 1, max: 1 });
    expect(choice.options).toHaveLength(1);
  });

  it('treats a negative discard amount as zero', () => {
    const room = createTestRoom();
    handCard(room, 'player2');
    const choice = listed(
      resolutionChoice(
        room,
        spell(room),
        stackEffect({
          action: 'DISCARD_FROM_HAND',
          params: { amount: -1 },
          targets: [{ targetType: 'player', playerId: 'player2' }],
          choice: { kind: 'discard' },
        }),
        0,
        results,
      ),
    );
    expect(choice).toMatchObject({ min: 0, max: 0 });
  });

  it('offers fixed options, ordering and selection choices', () => {
    const room = createTestRoom({ battlefield: [creature('target', 'player2')] });
    expect(listed(resolutionChoice(room, spell(room), stackEffect({ choice: { kind: 'optional' } }), 0, results))).toMatchObject({
      kind: 'optional',
      min: 1,
      max: 1,
    });
    const modes = [
      { id: 'a', label: 'A', effects: [] },
      { id: 'b', label: 'B', effects: [] },
    ];
    expect(listed(resolutionChoice(room, spell(room), stackEffect({ choice: { kind: 'options', options: modes } }), 0, results))).toMatchObject({
      kind: 'options',
      min: 1,
      max: 1,
    });
    expect(listed(resolutionChoice(room, spell(room), stackEffect({ choice: { kind: 'ordering', options: modes } }), 0, results))).toMatchObject({
      kind: 'ordering',
      min: 2,
      max: 2,
    });
    expect(
      listed(resolutionChoice(room, spell(room), stackEffect({ choice: { kind: 'options', options: modes, min: 0, max: 2 } }), 0, results)),
    ).toMatchObject({ min: 0, max: 2 });
    expect(
      listed(resolutionChoice(room, spell(room), stackEffect({ choice: { kind: 'selection', criteria: { type: 'permanent', required: false } } }), 0, results)),
    ).toMatchObject({ kind: 'selection', min: 0, max: 1 });
    expect(
      listed(resolutionChoice(room, spell(room), stackEffect({ choice: { kind: 'selection', criteria: { type: 'permanent', required: true, maxTargets: 3 } } }), 0, results)),
    ).toMatchObject({ min: 1, max: 3 });
  });

  it('admits pinned search cards and reports ordered prompts', () => {
    const room = createTestRoom();
    const first = handCard(room, 'player1');
    const second = handCard(room, 'player1');
    first.state = { ...first.state, zoneRevision: 0 };
    second.state = { ...second.state, zoneRevision: 1 };
    const search = listed(
      resolutionChoice(
        room,
        spell(room),
        stackEffect({
          choice: {
            kind: 'search',
            zone: 'hand',
            cardRefs: [
              { cardUuid: first.uuid, zoneRevision: 0 },
              { cardUuid: second.uuid, zoneRevision: 1 },
            ],
            ordered: true,
            min: 0,
            max: 2,
          },
        }),
        0,
        results,
      ),
    );
    expect(search.options.map((option) => option.id)).toEqual([first.uuid, second.uuid]);
    expect(search.prompt).toContain('in top-to-bottom order');
    expect(search.min).toBe(0);
    expect(search.max).toBe(2);
    expect(search.kind).toBe('ordering');
  });

  it('treats a missing revision on a pinned search card as zero', () => {
    const room = createTestRoom();
    const card = instantiateCard('empire-servant');
    card.state = { ...card.state, zone: 'hand', ownerId: 'player1', controllerId: 'player1' };
    delete (card.state as { zoneRevision?: number }).zoneRevision;
    room.players.player1.hand.push(card);
    const search = listed(
      resolutionChoice(
        room,
        spell(room),
        stackEffect({ choice: { kind: 'search', zone: 'hand', cardRefs: [{ cardUuid: card.uuid, zoneRevision: 0 }], allAvailable: true } }),
        0,
        results,
      ),
    );
    expect(search.options).toEqual([
      { id: card.uuid, label: expect.any(String), value: { targetType: 'card', cardUuid: card.uuid, zone: 'hand', zoneRevision: 0 } },
    ]);
  });

  it('searches the battlefield without pinned references', () => {
    const room = createTestRoom({ battlefield: [creature('board', 'player1'), creature('enemy', 'player2')] });
    const search = listed(
      resolutionChoice(room, spell(room), stackEffect({ choice: { kind: 'search', zone: 'battlefield', prompt: 'Pick a permanent' } }), 0, results),
    );
    expect(search.options.map((option) => option.id)).toEqual(['board']);
    const everyone = listed(
      resolutionChoice(room, spell(room), stackEffect({ choice: { kind: 'search', zone: 'battlefield', zonePlayer: 'any' } }), 0, results),
    );
    expect(everyone.options.map((option) => option.id).sort()).toEqual(['board', 'enemy']);
    expect(search.prompt).toBe('Pick a permanent');
    expect(search.min).toBe(0);
    expect(search.max).toBe(1);
  });

  it('reports an empty search with the authored minimum', () => {
    const room = createTestRoom();
    const search = listed(
      resolutionChoice(room, spell(room), stackEffect({ choice: { kind: 'search', zone: 'graveyard', min: 2, max: 3 } }), 0, results),
    );
    expect(search).toMatchObject({ min: 2, max: 3, options: [] });
    const defaults = listed(resolutionChoice(room, spell(room), stackEffect({ choice: { kind: 'search', zone: 'graveyard' } }), 0, results));
    expect(defaults).toMatchObject({ min: 0, max: 1, prompt: 'Choose: search' });
  });

  it('resolves a captured search window and its face grants', () => {
    const room = createTestRoom({ battlefield: [creature('seed', 'player2')] });
    const card = handCard(room, 'player1');
    card.state = { ...card.state, zoneRevision: 0 };
    const snapshot = captureSourceInformation(room, card);
    const audience = { faces: ['player1'], count: ['player1'], order: ['player1'] };
    room.cardObservations = {
      sequence: 1,
      active: {
        obs: {
          id: 'obs',
          ownerStackUuid: 'spell',
          resultName: 'picked',
          controllerId: 'player1',
          zoneOwnerId: 'player1',
          sourceInfo: snapshot,
          emptyAudience: audience,
          members: [{ snapshot, audience }],
          turnNumber: 1,
        },
      },
      history: [],
    };
    const captured = { picked: { name: 'picked', kind: 'captured' as const, observationId: 'obs', cards: [{ before: snapshot }] } };
    const object = spell(room, { uuid: 'spell', resolutionResults: captured } as Partial<StackObject>);
    const search = listed(
      resolutionChoice(room, object, stackEffect({ choice: { kind: 'search', zone: 'hand', from: { name: 'picked', kind: 'result' } } }), 0, []),
    );
    expect(search.options).toHaveLength(1);
    expect(search.options[0].id).toBe(card.uuid);
  });

  it('empties a search whose captured result is missing', () => {
    const room = createTestRoom();
    const search = listed(
      resolutionChoice(
        room,
        spell(room),
        stackEffect({ choice: { kind: 'search', zone: 'hand', from: { name: 'missing', kind: 'result' } } }),
        0,
        [],
      ),
    );
    expect(search.options).toEqual([]);
    expect(search.min).toBe(0);
  });

  it('describes an ordered search prompt with a fixed count', () => {
    const room = createTestRoom();
    room.players.player1.hand = [];
    handCard(room, 'player1');
    handCard(room, 'player1');
    const search = listed(
      resolutionChoice(room, spell(room), stackEffect({ choice: { kind: 'search', zone: 'hand', ordered: true, allAvailable: true } }), 0, results),
    );
    expect(search.prompt).toBe('Choose 2 cards in top-to-bottom order');
    expect(search.min).toBe(2);
    expect(search.max).toBe(2);
  });

  it('fills in a revision for a distribution target that has none yet', () => {
    const room = createTestRoom();
    const fresh = creature('fresh', 'player2');
    delete (fresh.state as { zoneRevision?: number }).zoneRevision;
    room.battlefield = [fresh];
    const choice = listed(
      resolutionChoice(
        room,
        spell(room),
        stackEffect({ targets: [{ targetType: 'permanent', cardUuid: 'fresh' }], choice: { kind: 'distribution', total: 1 } }),
        0,
        results,
      ),
    );
    expect(choice.options[0].value).toMatchObject({ cardUuid: 'fresh', zone: 'battlefield', zoneRevision: 0 });
  });

  it('labels distribution options by player, card, stack object or a generic target', () => {
    const room = createTestRoom({ battlefield: [creature('target', 'player2')] });
    const choice = listed(
      resolutionChoice(
        room,
        spell(room),
        stackEffect({
          targets: [
            { targetType: 'player', playerId: 'player2' },
            { targetType: 'permanent', cardUuid: 'target' },
            { targetType: 'stack', stackUuid: 'stack-1' },
            { targetType: 'card' },
          ],
          choice: { kind: 'distribution', total: 2 },
        }),
        0,
        results,
      ),
    );
    expect(choice.kind).toBe('distribution');
    expect(choice.options.map((option) => option.label)).toEqual(['player2', 'target', 'stack-1', 'target']);
    expect(choice.options[1].value).toMatchObject({ cardUuid: 'target', zone: 'battlefield', zoneRevision: 0 });
  });
});

describe('resolution effect planning', () => {
  it('turns authored effect definitions into resolved stack effects', () => {
    const room = createTestRoom();
    const source = creature('source', 'player1');
    expect(buildStackEffects(undefined, 'player1')).toEqual([]);
    const [self, allPlayers, allCards] = buildStackEffects(
      [
        { action: 'DRAW', params: { amount: 1 } },
        { action: 'DRAW', params: { amount: 1 }, targeting: { type: 'player', all: true } },
        { action: 'TAP', targeting: { type: 'permanent', all: true, cardTypes: ['Creature'] } },
      ],
      'player1',
      source,
    );
    expect(self.targets).toEqual([{ targetType: 'player', playerId: 'player1' }]);
    expect(self.params).toEqual({ amount: 1 });
    expect(allPlayers.targets[0]).toMatchObject({ targetType: 'player', all: true });
    expect(allCards.targets[0]).toMatchObject({ targetType: 'permanent', all: true, cardTypes: ['Creature'] });
    expect(room.battlefield).toEqual([]);
  });

  it('uses the source incarnation as a self target', () => {
    const room = createTestRoom();
    const permanent = creature('source', 'player1');
    const onBoard = buildStackEffects([{ action: 'TAP', targeting: { type: 'self', subject: 'source' } }], 'player1', permanent);
    expect(onBoard[0].targets[0]).toEqual({ targetType: 'permanent', cardUuid: 'source', zone: 'battlefield', zoneRevision: 0 });
    const inHand = instantiateCard('empire-servant');
    inHand.state = { ...inHand.state, zone: 'hand' };
    const fromHand = buildStackEffects([{ action: 'TAP', targeting: { type: 'self', subject: 'source' } }], 'player1', inHand);
    expect(fromHand[0].targets[0]).toMatchObject({ targetType: 'card', zone: 'hand' });
  });

  it('leaves explicit targeting for the server to fill', () => {
    const [effect] = buildStackEffects([{ action: 'TAP', targeting: { type: 'permanent', required: true } }], 'player1');
    expect(effect.targets).toEqual([]);
    expect(effect.targeting).toEqual({ type: 'permanent', required: true });
  });

  it('keeps condition, outcome and record fields from the definition', () => {
    const [effect] = buildStackEffects(
      [
        {
          action: 'DRAW',
          params: { amount: 1 },
          recordResult: { name: 'drawn', kind: 'milled' },
          tags: ['cards'],
          condition: { op: 'eq', left: { path: 'room.turnNumber' }, right: 1 },
        },
      ],
      'player1',
    );
    expect(effect).toMatchObject({ recordResult: { name: 'drawn' }, tags: ['cards'], instructionId: '0' });
    expect(effect.condition).toBeDefined();
  });
});

describe('target revalidation', () => {
  function board(): GameRoom {
    return createTestRoom({ battlefield: [creature('a', 'player1'), creature('b', 'player2')] });
  }

  it('expands all-player targets honouring the self and opponent filters', () => {
    const room = board();
    const selfOnly = revalidateTargets(room, stackEffect({ targets: [{ targetType: 'player', all: true, controller: 'self' }] }), 'player1');
    expect(selfOnly.targets).toEqual([{ targetType: 'player', playerId: 'player1' }]);
    const opponents = revalidateTargets(room, stackEffect({ targets: [{ targetType: 'player', all: true, controller: 'opponent' }] }), 'player1');
    expect(opponents.targets).toEqual([{ targetType: 'player', playerId: 'player2' }]);
    const everyone = revalidateTargets(room, stackEffect({ targets: [{ targetType: 'player', all: true }] }), 'player1');
    expect(everyone.targets).toHaveLength(2);
  });

  it('expands all-permanent targets against matching cards', () => {
    const room = board();
    const expanded = revalidateTargets(room, stackEffect({ targets: [{ targetType: 'permanent', all: true, cardTypes: ['Creature'] }] }), 'player1');
    expect(expanded.targets).toEqual([
      { targetType: 'permanent', cardUuid: 'a' },
      { targetType: 'permanent', cardUuid: 'b' },
    ]);
  });

  it('drops concrete targets that no longer have the fields they need', () => {
    const room = board();
    const resolved = revalidateTargets(
      room,
      stackEffect({
        targets: [
          { targetType: 'card' },
          { targetType: 'card', cardUuid: 'missing' },
          { targetType: 'player' },
          { targetType: 'stack' },
          { targetType: 'self' },
          { targetType: 'nonsense' as never },
        ],
      }),
      'player1',
    );
    expect(resolved.targets).toEqual([{ targetType: 'self' }]);
  });

  it('keeps a legal concrete target and fizzles a required effect whose targets all left', () => {
    const room = board();
    expect(
      revalidateTargets(room, stackEffect({ targets: [{ targetType: 'permanent', cardUuid: 'a', zoneRevision: 0 }] }), 'player1').targets,
    ).toEqual([{ targetType: 'permanent', cardUuid: 'a', zoneRevision: 0 }]);
    expect(
      revalidateTargets(
        room,
        stackEffect({ targeting: { type: 'permanent', required: true }, targets: [{ targetType: 'permanent', cardUuid: 'gone' }] }),
        'player1',
      ),
    ).toMatchObject({ targets: [], fizzled: true });
  });

  it('consults permissions only when a source is supplied', () => {
    const room = board();
    const effect = stackEffect({ targeting: { type: 'permanent', required: true }, targets: [{ targetType: 'permanent', cardUuid: 'a', zoneRevision: 0 }] });
    const source = room.battlefield[0];
    expect(revalidateTargets(room, effect, 'player1').targets).toHaveLength(1);
    expect(revalidateTargets(room, effect, 'player1', source).targets).toHaveLength(1);
  });

  it('keeps a stack target that is still on the stack', () => {
    const room = board();
    const onStack = spell(room) as StackObject & { uuid: string };
    (onStack as { uuid: string }).uuid = 'stack-1';
    room.stack = [onStack];
    expect(
      revalidateTargets(room, stackEffect({ targets: [{ targetType: 'stack', stackUuid: 'stack-1' }] }), 'player1').targets,
    ).toEqual([{ targetType: 'stack', stackUuid: 'stack-1' }]);
    expect(revalidateTargets(room, stackEffect({ targets: [{ targetType: 'stack', stackUuid: 'other' }] }), 'player1').targets).toEqual([]);
  });

  it('compares a fresh incarnation that has no revision yet', () => {
    const room = createTestRoom();
    const fresh = creature('fresh', 'player1');
    delete (fresh.state as { zoneRevision?: number }).zoneRevision;
    room.battlefield = [fresh];
    expect(
      revalidateTargets(room, stackEffect({ targets: [{ targetType: 'permanent', cardUuid: 'fresh', zoneRevision: 0 }] }), 'player1').targets,
    ).toHaveLength(1);
    expect(
      resolutionNumericContext(room, spell(room), stackEffect({ targets: [{ targetType: 'permanent', cardUuid: 'fresh', zoneRevision: 0 }] })).exactTarget?.uuid,
    ).toBe('fresh');
  });
});

describe('resolution numeric context', () => {
  it('evaluates event, source and target dynamic parameters', () => {
    const room = createTestRoom({ battlefield: [creature('target', 'player2', 3, 3), creature('source', 'player1', 4, 4)] });
    const object = spell(room, {
      type: 'triggered',
      triggeringEvent: { eventId: 'PERMANENT_ENTERED', payload: { amount: 7, label: 'seven', huge: 2 ** 53 } },
      source: room.battlefield[1],
    } as Partial<StackObject>);
    const effect = stackEffect({
      params: {
        fromEvent: 'DYNAMIC:event.payload.amount',
        fromLabel: 'DYNAMIC:event.payload.label',
        sourcePower: 'DYNAMIC:source.power',
        targetPower: 'DYNAMIC:target.power',
        ignored: 'literal',
        unknownPath: 'DYNAMIC:unknown.path',
        unsafeEvent: 'DYNAMIC:event.payload.huge',
        numericField: { numeric: { kind: 'query', id: 'field', args: { path: 'source.power' } } },
        numericUnreadable: { numeric: { kind: 'query', id: 'field', args: { path: 'event.payload.label' } } },
        numericCount: { numeric: { kind: 'query', id: 'count', args: { scope: { zones: ['battlefield'] } } } },
      },
      targets: [{ targetType: 'permanent', cardUuid: 'target', zoneRevision: 0 }],
    });
    const params = buildDynamicParams(room, object, effect);
    expect(params).toEqual({
      fromEvent: 7,
      sourcePower: 4,
      targetPower: 3,
      fromLabel: 'seven',
      numericField: 4,
      numericUnreadable: undefined,
      numericCount: 2,
      unsafeEvent: undefined,
    });
  });

  it('drops target parameters once the target has left the battlefield', () => {
    const room = createTestRoom();
    const object = spell(room);
    const effect = stackEffect({
      params: { targetPower: 'DYNAMIC:target.power' },
      targets: [{ targetType: 'permanent', cardUuid: 'gone', zoneRevision: 0 }],
    });
    expect(buildDynamicParams(room, object, effect)).toEqual({ targetPower: undefined });
  });

  it('exposes the resolution field view including the target', () => {
    const room = createTestRoom({ battlefield: [creature('target', 'player2')] });
    const effect = stackEffect({ targets: [{ targetType: 'permanent', cardUuid: 'target', zoneRevision: 0 }] });
    const fields = resolutionNumericContext(room, spell(room), effect).fields as {
      source: { power?: number };
      target?: { uuid: string; zone: string };
      event?: unknown;
    };
    expect(fields.target).toMatchObject({ uuid: 'target' });
    expect(fields.source.power).toBe(2);
    const noTarget = resolutionNumericContext(room, spell(room), stackEffect()).fields as { target?: unknown; event?: unknown };
    expect(noTarget.target).toBeUndefined();
    expect(noTarget.event).toBeUndefined();
  });

  it('treats a stale revision as no exact target', () => {
    const room = createTestRoom({ battlefield: [creature('target', 'player2')] });
    const effect = stackEffect({ targets: [{ targetType: 'permanent', cardUuid: 'target', zoneRevision: 9 }] });
    expect(resolutionNumericContext(room, spell(room), effect).exactTarget).toBeUndefined();
  });

  it('checks instruction conditions only when authored', () => {
    const room = createTestRoom();
    const object = spell(room);
    expect(instructionConditionMatches(room, object, stackEffect())).toBe(true);
    expect(
      instructionConditionMatches(room, object, stackEffect({ condition: { op: 'eq', left: { path: 'room.turnNumber' }, right: 1 } })),
    ).toBe(true);
    expect(
      instructionConditionMatches(room, object, stackEffect({ condition: { op: 'eq', left: { path: 'room.turnNumber' }, right: 2 } })),
    ).toBe(false);
  });
});

describe('resolution choice application', () => {
  function continuation(room: GameRoom, effects: StackEffect[]): ResolutionContinuation {
    return { type: 'resolution', stackObj: spell(room, { effects } as Partial<StackObject>), effectIndex: 0, results };
  }

  function choice(room: GameRoom, effects: StackEffect[], kind: ListedChoice['kind'] = 'optional'): PendingChoice {
    return { id: 'choice', playerId: 'player1', kind, prompt: 'Pick', min: 0, max: 1, options: [], continuation: continuation(room, effects) };
  }

  function answer(values: ChoiceAnswer): ChoiceAnswer {
    return values;
  }

  it('rejects a numeric announcement and a foreign continuation', () => {
    const room = createTestRoom();
    expect(() =>
      applyResolutionChoice(
        room,
        {
          id: 'n',
          playerId: 'player1',
          kind: 'number',
          prompt: 'Pick',
          range: { min: 0 },
          continuation: { type: 'action', actionId: 'x', data: {}, field: 'modes' },
        },
        answer({ values: [1], number: 1 }),
      ),
    ).toThrow('Numeric announcement cannot resume resolution');
    expect(() =>
      applyResolutionChoice(
        room,
        {
          id: 'c',
          playerId: 'player1',
          kind: 'optional',
          prompt: 'Pick',
          min: 0,
          max: 1,
          options: [],
          continuation: { type: 'action', actionId: 'x', data: {}, field: 'modes' },
        },
        answer({ values: [1] }),
      ),
    ).toThrow('Expected resolution continuation');
  });

  it('adds or removes an optional effect', () => {
    const room = createTestRoom();
    const effect = stackEffect({ choice: { kind: 'optional' } });
    expect(applyResolutionChoice(room, choice(room, [effect]), answer({ values: [true] })).stackObj.effects).toHaveLength(1);
    const declined = applyResolutionChoice(room, choice(room, [effect]), answer({ values: [false] }));
    expect(declined.stackObj.effects).toEqual([]);
  });

  it('replaces an options choice with the selected mode effects', () => {
    const room = createTestRoom();
    const modes = [{ id: 'a', label: 'A', effects: [{ action: 'DRAW', params: { amount: 1 } }] }];
    const effect = stackEffect({ choice: { kind: 'options', options: modes } });
    const applied = applyResolutionChoice(room, choice(room, [effect]), answer({ values: [modes[0]] }));
    expect(applied.stackObj.effects).toEqual([expect.objectContaining({ action: 'DRAW', params: { amount: 1 } })]);
  });

  it('splits a distribution preserving the authored sign', () => {
    const room = createTestRoom();
    const effect = stackEffect({
      params: { damage: -3 },
      targets: [{ targetType: 'player', playerId: 'player2' }],
      choice: { kind: 'distribution', total: 3, field: 'damage' },
    });
    const pending = {
      ...choice(room, [effect], 'distribution'),
      options: [{ id: 'player:player2', label: 'player2', value: { targetType: 'player' as const, playerId: 'player2' } }],
    };
    const applied = applyResolutionChoice(room, pending, answer({ values: [], allocations: { 'player:player2': 2 } }));
    expect(applied.stackObj.effects[0].params).toEqual({ damage: -2 });
    expect(applied.stackObj.effects[0].targets).toEqual([{ targetType: 'player', playerId: 'player2' }]);
  });

  it('drops distribution options that were not allocated and defaults the field', () => {
    const room = createTestRoom();
    const effect = stackEffect({
      params: { amount: 2 },
      targets: [{ targetType: 'player', playerId: 'player2' }],
      choice: { kind: 'distribution', total: 2 },
    });
    const pending = {
      ...choice(room, [effect], 'distribution'),
      options: [{ id: 'player:player2', label: 'player2', value: { targetType: 'player' as const, playerId: 'player2' } }],
    };
    expect(applyResolutionChoice(room, pending, answer({ values: [], allocations: {} })).stackObj.effects).toEqual([]);
  });

  it('rewrites a plain target answer onto the effect', () => {
    const room = createTestRoom();
    const effect = stackEffect({ targeting: { type: 'permanent', required: true } });
    const applied = applyResolutionChoice(room, choice(room, [effect], 'selection'), answer({ values: [{ targetType: 'permanent', cardUuid: 'target' }] }));
    expect(applied.stackObj.effects).toEqual([
      expect.objectContaining({
        targeting: { type: 'self', required: false },
        targets: [{ targetType: 'permanent', cardUuid: 'target' }],
      }),
    ]);
  });
});

describe('rule context construction', () => {
  it('builds a room-free context from the source blueprint', () => {
    const card = instantiateCard('land-red');
    const context = createRuleContext(undefined, card, 'player1');
    expect(context.source).toMatchObject({ uuid: card.uuid, power: 0, toughness: 0 });
    expect(context.room).toBeUndefined();
    expect(context.controller).toBeUndefined();
    const readField = (context.numericContext as { readField: (path: string) => unknown }).readField;
    expect(readField('source.power')).toBe(0);
    expect(readField('room.phase')).toBeUndefined();
  });

  it('counts board cards through resolved characteristics', () => {
    const room = createTestRoom({ battlefield: [creature('a', 'player1'), creature('b', 'player2')] });
    const context = createRuleContext(room, room.battlefield[0], 'player1');
    const count = (context.numericContext as { count: (scope: { zones: string[] }) => number }).count;
    expect(count({ zones: ['battlefield'] })).toBe(2);
  });

  it('prefers an explicit snapshot and last-known characteristics', () => {
    const room = createTestRoom({ battlefield: [creature('source', 'player1', 5, 5)] });
    const card = room.battlefield[0];
    const snapshot = captureSourceInformation(room, card);
    const context = createRuleContext(room, card, 'player1', undefined, snapshot, { extra: 'value' });
    expect(context.extra).toBe('value');
    expect(context.source).toMatchObject({ power: 5, toughness: 5, manaValue: 0 });
    expect(context.room).toEqual({ phase: 'stateMainPhase', turnNumber: 1, activeTurnPlayerId: 'player1' });

    const live = createRuleContext(room, card, 'player1');
    expect((live.source as { manaValue?: number }).manaValue).toBe(0);

    const detached = createRuleContext(undefined, card, 'player1', undefined, snapshot);
    expect((detached.source as { manaValue?: number }).manaValue).toBe(0);
  });

  it('reports an unknown mana value when no room or last-known data exists', () => {
    const card = instantiateCard('empire-servant');
    delete (card as { lastKnownCharacteristics?: unknown }).lastKnownCharacteristics;
    const context = createRuleContext(undefined, card, 'player1');
    expect((context.source as { manaValue?: number }).manaValue).toBeUndefined();
  });

  it('reads the live mana value for a snapshot without last-known data', () => {
    const room = createTestRoom({ battlefield: [creature('source', 'player1', 1, 1)] });
    const card = room.battlefield[0];
    const bare = { card: { ...card, lastKnownCharacteristics: undefined }, power: 1, toughness: 1 };
    const context = createRuleContext(room, card, 'player1', undefined, bare);
    expect((context.source as { manaValue?: number }).manaValue).toBe(0);
  });
});

