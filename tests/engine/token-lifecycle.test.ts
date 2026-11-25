import { afterEach, describe, expect, it, vi } from 'vitest';
import { GameEngine } from '@engine/game-engine';
import { gameReducer } from '@engine/game-reducer';
import { buildStackEffects, resolveEffects } from '@engine/effect-resolver';
import { planTokenCreation } from '@engine/token-creation';
import { roomCards } from '@engine/continuous-effect-state';
import * as catalog from '@library/card-catalog';
import { instantiateCard, instantiateToken } from '@library/card-factory';
import { parseCardDefinition, parseInstructionDefinition } from '@library/card-parser';
import { buildCatalog } from '@server/catalog/catalog';
import { SyncService } from '@server/rooms/sync-service';
import { buildPlayerView } from '@server/projection/view-builder';
import { applyDeltaChanges } from '@client/store/deltaReducer';
import type { EffectDefinition, StackObject } from '@shared/effect.types';
import type { CardBlueprint } from '@shared/card.types';
import { creature } from '../helpers/combat-fixture';
import { createTestRoom, fillTestLibraries } from '../helpers/test-room-factory';
import { loadMatchContent } from '@server/catalog/match-content';

const tokenId = 'token-angel-1-1';
const create = { family: 'cards', operation: 'create_token', params: { tokenId, amount: 1 } };
const life = { family: 'resources', operation: 'adjust_life', params: { amount: 2 } };
const engines: GameEngine[] = [];
afterEach(() => {
  engines.splice(0).forEach((engine) => engine.dispose());
});
function start(effects: unknown[] = [create], token?: CardBlueprint) {
  const content = loadMatchContent();
  const room = createTestRoom(token ? {
    matchContent: { ...content, tokenBlueprints: { ...content.tokenBlueprints, [token.id]: token } },
  } : undefined);
  fillTestLibraries(room);
  const source = creature('creator', 'player1');
  source.blueprint = parseCardDefinition({
    schemaVersion: 1,
    id: 'creator',
    name: 'Creator',
    cardTypes: ['Artifact'],
    onCastEffects: effects,
  });
  room.battlefield = [source];
  room.players.player1.hand = [];
  const engine = new GameEngine(room);
  engine.initRoom();
  engines.push(engine);
  const object: StackObject = {
    uuid: 'creation-effect',
    type: 'triggered',
    source,
    controllerId: 'player1',
    countered: false,
    effects: buildStackEffects(source.blueprint.onCastEffects, 'player1', source),
  };
  engine.applyMutations([{ type: 'PUSH_STACK', stackObject: object }]);
  return { engine, source, object };
}
function tokens(engine: GameEngine) {
  return engine.roomState.battlefield.filter((card) => card.isToken);
}
function events(engine: GameEngine) {
  return engine.drainEventBatches().flatMap((batch) => batch.events);
}
function watcher(engine: GameEngine, condition: 'ON_ENTER_BATTLEFIELD' | 'ON_DIE') {
  const card = creature('watcher', 'player1');
  card.blueprint = parseCardDefinition({
    schemaVersion: 1,
    id: 'watcher',
    name: 'Watcher',
    cardTypes: ['Artifact'],
    abilities: [
      {
        id: 'watch',
        type: 'triggered',
        triggerCondition: condition,
        trigger: { subject: 'another', controller: 'self', cardTypes: ['Creature'], subTypes: ['上使'] },
        effect: life,
      },
    ],
  });
  engine.roomState.battlefield.push(card);
}

describe('named token templates and creation', () => {
  it('shares immutable card blueprints but excludes tokens from playable catalog/deck construction', () => {
    const a = instantiateToken(tokenId, 'player1'),
      b = instantiateToken(tokenId, 'player2');
    expect(a.uuid).not.toBe(b.uuid);
    expect(a.blueprint).toBe(b.blueprint);
    expect(Object.isFrozen(a.blueprint)).toBe(true);
    expect(a).toMatchObject({
      isToken: true,
      blueprint: { power: 1, toughness: 1, subTypes: ['上使'], abilities: [] },
      state: {
        zone: 'battlefield',
        visibility: 'public',
        ownerId: 'player1',
        controllerId: 'player1',
        summoningSickness: true,
        summonKind: 'effect',
        zoneRevision: 0,
      },
    });
    expect(catalog.getTokenIds()).toContain(tokenId);
    expect(catalog.getCardIds()).not.toContain(tokenId);
    expect(buildCatalog().has(tokenId)).toBe(false);
    expect(() => instantiateCard(tokenId)).toThrow('token factory');
    expect(() => instantiateToken('empire-servant', 'player1')).toThrow('Unknown token');
  });
  it('creates on resolution and uses the ordinary ETB event/trigger pipeline without casting or staging', () => {
    const { engine } = start([{ ...create, params: { tokenId, amount: 2 } }]);
    watcher(engine, 'ON_ENTER_BATTLEFIELD');
    expect(tokens(engine)).toHaveLength(0);
    expect(engine.resolveTopOfStack().success).toBe(true);
    expect(tokens(engine)).toHaveLength(2);
    expect(engine.roomState.players.player1.graveyard).toEqual([]);
    expect(engine.roomState.players.player1.hand).toEqual([]);
    const stream = events(engine);
    expect(stream.filter((event) => event.eventId === 'PERMANENT_ENTERED')).toHaveLength(2);
    expect(stream.some((event) => event.eventId === 'SPELL_CAST')).toBe(false);
    expect(stream.some((event) => event.eventId === 'CARD_MOVED' && event.payload.after.isToken)).toBe(false);
    // Simultaneous ordinary triggers use the existing player-owned ordering prompt.
    if (engine.roomState.pendingChoice?.kind === 'ordering') {
      const request = engine.roomState.pendingChoice;
      expect(
        engine.executePlayerAction(request.playerId, 'choose', {
          choiceId: request.id,
          choices: request.options.map((option) => option.id),
        }).success,
      ).toBe(true);
    }
    expect(engine.roomState.stack).toHaveLength(2);
    engine.resolveTopOfStack();
    engine.resolveTopOfStack();
    expect(engine.roomState.players.player1.life).toBe(24);
  });
  it('supports ordinary own-entry and death abilities on a predefined token blueprint', () => {
    const blueprint = parseCardDefinition({
      schemaVersion: 1,
      id: tokenId,
      name: 'Witness Token',
      cardTypes: ['Creature'],
      power: 1,
      toughness: 1,
      onEnterEffects: [life],
      abilities: [
        { id: 'farewell', type: 'triggered', triggerCondition: 'ON_DIE', trigger: { subject: 'self' }, effect: life },
      ],
    });
    const { engine } = start([create], blueprint);
    engine.resolveTopOfStack();
    expect(engine.roomState.stack).toHaveLength(1);
    engine.resolveTopOfStack();
    expect(engine.roomState.players.player1.life).toBe(22);
    const token = tokens(engine)[0];
    engine.applyMutations([{ type: 'DESTROY_CARD', cardUuid: token.uuid, zoneRevision: 0 }]);
    expect(engine.roomState.players.player1.graveyard).toEqual([]);
    expect(engine.roomState.stack).toHaveLength(1);
    engine.resolveTopOfStack();
    expect(engine.roomState.players.player1.life).toBe(24);
  });
  it('creates for an explicitly selected player, with that player owning and controlling the token', () => {
    const { engine } = start([
      { ...create, targeting: { type: 'player', controller: 'opponent', all: true, required: false } },
    ]);
    engine.resolveTopOfStack();
    expect(tokens(engine)[0].state).toMatchObject({
      ownerId: 'player2',
      controllerId: 'player2',
      visibility: 'public',
    });
  });
  it('fires entry and death once for a zero-toughness token while retaining its queued entry ability', () => {
    const { engine } = start(
      [create], parseCardDefinition({
        schemaVersion: 1,
        id: tokenId,
        name: 'Fleeting Token',
        cardTypes: ['Creature'],
        power: 1,
        toughness: 0,
        onEnterEffects: [life],
      }),
    );
    engine.resolveTopOfStack();
    expect(tokens(engine)).toHaveLength(0);
    const stream = events(engine);
    expect(stream.filter((event) => event.eventId === 'PERMANENT_ENTERED')).toHaveLength(1);
    expect(stream.filter((event) => event.eventId === 'PERMANENT_DIED')).toHaveLength(1);
    expect(engine.roomState.players.player1.graveyard).toEqual([]);
    expect(engine.roomState.stack).toHaveLength(1);
    engine.resolveTopOfStack();
    expect(engine.roomState.players.player1.life).toBe(22);
  });
  it('does not recreate earlier tokens when a later replacement choice survives reconstruction', () => {
    const { engine } = start([create, life]);
    engine.roomState.replacementEffects = [
      {
        id: 'life-choice',
        label: 'Skip healing',
        optional: true,
        match: { kinds: ['life_change'] },
        operation: { type: 'cancel_event' },
      },
    ];
    engine.resolveTopOfStack();
    expect(engine.roomState.pendingChoice?.continuation.type).toBe('replacement');
    const originalUuid = tokens(engine)[0].uuid;
    const restored = new GameEngine(JSON.parse(JSON.stringify(engine.roomState)));
    engines.push(restored);
    restored.initRoom();
    const choice = restored.roomState.pendingChoice!;
    expect(
      restored.executePlayerAction(choice.playerId, 'choose', {
        choiceId: choice.id,
        choices: ['skip:life-choice'],
      }).success,
    ).toBe(true);
    expect(tokens(restored).map((token) => token.uuid)).toEqual([originalUuid]);
    expect(restored.roomState.tokenSequence).toBe(1);
    expect(restored.roomState.players.player1.life).toBe(22);
  });
  it('does not allocate token identities for a countered creation effect', () => {
    const { engine, object } = start();
    const uuid = vi.fn(() => 'unused');
    expect(
      resolveEffects(engine.roomState, { ...object, countered: true }, [], false, { random: () => 0, uuid }),
    ).toEqual([]);
    expect(uuid).not.toHaveBeenCalled();
  });
  it('replays a serialized birth once, even after its token has ceased', () => {
    const { engine, object } = start();
    const creations = planTokenCreation(engine.roomState, object.effects[0], {
      random: () => 0,
      uuid: () => 'stable-token',
    });
    let room = creations.reduce(gameReducer, engine.roomState);
    expect(room.battlefield.some((card) => card.uuid === 'stable-token')).toBe(true);
    room = gameReducer(room, {
      type: 'MOVE_CARD',
      cardUuid: 'stable-token',
      playerId: 'player1',
      from: 'battlefield',
      to: 'graveyard',
    });
    const restored = JSON.parse(JSON.stringify(room));
    expect(gameReducer(restored, JSON.parse(JSON.stringify(creations[0])))).toBe(restored);
    expect(roomCards(restored).some((card) => card.uuid === 'stable-token')).toBe(false);
  });
  it.each([
    { tokenId, amount: -1 },
    { tokenId, amount: 1.5 },
    { tokenId, amount: 65 },
    { tokenId, destination: 'hand' },
    { tokenId, card: { name: 'arbitrary' } },
  ])('rejects unsupported or forged creation params: %j', (params) => {
    expect(() => parseInstructionDefinition({ ...create, params })).toThrow();
  });
  it('rejects non-player recipients and supports bounded numeric amounts through the ordinary parser', () => {
    expect(() => parseInstructionDefinition({ ...create, targeting: { type: 'permanent', required: true } })).toThrow(
      'players',
    );
    expect(() =>
      parseInstructionDefinition({ ...create, targeting: { type: 'self', subject: 'source', required: false } }),
    ).toThrow('players');
    const { engine } = start([
      {
        ...create,
        params: {
          tokenId,
          amount: {
            numeric: {
              kind: 'query',
              id: 'count',
              args: { scope: { zones: ['battlefield'], cardTypes: ['Artifact'], controller: 'self' } },
            },
          },
        },
      },
    ]);
    engine.resolveTopOfStack();
    expect(tokens(engine)).toHaveLength(1);
  });
  it('rejects duplicate/colliding identities and nonexistent owners without partial creation', () => {
    const { engine, object } = start();
    expect(
      planTokenCreation(
        engine.roomState,
        { ...object.effects[0], params: { tokenId, amount: 2 } },
        { random: () => 0, uuid: () => 'duplicate' },
      ),
    ).toEqual([]);
    expect(planTokenCreation(engine.roomState, object.effects[0], { random: () => 0, uuid: () => 'creator' })).toEqual(
      [],
    );
    expect(
      gameReducer(engine.roomState, {
        type: 'CREATE_TOKEN',
        tokenId,
        playerId: 'missing',
        cardUuid: 'new',
        sequence: 1,
      }),
    ).toBe(engine.roomState);
    expect(
      gameReducer(engine.roomState, {
        type: 'CREATE_TOKEN',
        tokenId,
        playerId: 'constructor',
        cardUuid: 'forged-owner',
        sequence: 1,
      }),
    ).toBe(engine.roomState);
  });
});

describe('board-only token lifecycle', () => {
  it.each(['graveyard', 'hand', 'library', 'exile'] as const)(
    'ceases atomically instead of occupying %s',
    (destination) => {
      const { engine } = start();
      engine.resolveTopOfStack();
      const token = tokens(engine)[0];
      const before = structuredClone(engine.roomState);
      const moved = gameReducer(before, {
        type: 'MOVE_CARD',
        cardUuid: token.uuid,
        playerId: 'player1',
        from: 'battlefield',
        to: destination,
        zoneRevision: 0,
      });
      expect(roomCards(moved).some((card) => card.uuid === token.uuid)).toBe(false);
      expect(moved.players.player1.hand).toEqual([]);
      expect(moved.players.player1.graveyard).toEqual([]);
      expect(moved.players.player1.exile ?? []).toEqual([]);
      expect(moved.players.player1.deck).toHaveLength(before.players.player1.deck.length);
    },
  );
  it('keeps actual death, destruction and kill attribution without a graveyard arrival', () => {
    const { engine } = start();
    engine.resolveTopOfStack();
    watcher(engine, 'ON_DIE');
    const token = tokens(engine)[0];
    events(engine);
    engine.applyMutations([{ type: 'DESTROY_CARD', cardUuid: token.uuid, zoneRevision: 0 }]);
    const stream = events(engine);
    expect(stream.filter((e) => e.eventId === 'PERMANENT_DIED')).toHaveLength(1);
    expect(stream.filter((e) => e.eventId === 'PERMANENT_DESTROYED')).toHaveLength(1);
    expect(stream.filter((e) => e.eventId === 'CREATURE_KILLED')).toHaveLength(1);
    expect(stream.filter((e) => e.eventId === 'TOKEN_CEASED')).toHaveLength(1);
    expect(stream.some((e) => e.eventId === 'CARD_MOVED' && e.payload.cardUuid === token.uuid)).toBe(false);
    expect(engine.roomState.players.player1.graveyard).toEqual([]);
    engine.resolveTopOfStack();
    expect(engine.roomState.players.player1.life).toBe(22);
  });
  it('sacrifice counts as death but does not count as destruction or a kill', () => {
    const { engine } = start();
    engine.resolveTopOfStack();
    const token = tokens(engine)[0];
    events(engine);
    engine.applyMutations([{ type: 'SACRIFICE_CARD', cardUuid: token.uuid, zoneRevision: 0 }]);
    const stream = events(engine);
    expect(stream.filter((e) => e.eventId === 'PERMANENT_DIED')).toHaveLength(1);
    expect(stream.filter((e) => e.eventId === 'PERMANENT_DESTROYED' || e.eventId === 'CREATURE_KILLED')).toHaveLength(
      0,
    );
    expect(engine.roomState.players.player1.graveyard).toEqual([]);
  });
  it.each(['hand', 'exile'] as const)('a replacement to %s removes the token without a false death', (destination) => {
    const { engine } = start();
    engine.resolveTopOfStack();
    const token = tokens(engine)[0];
    events(engine);
    engine.roomState.replacementEffects = [
      {
        id: 'redirect',
        label: 'Redirect',
        match: { kinds: ['destroy'] },
        operation: { type: 'move_destination', to: destination },
      },
    ];
    engine.applyMutations([{ type: 'DESTROY_CARD', cardUuid: token.uuid, zoneRevision: 0 }]);
    expect(tokens(engine)).toHaveLength(0);
    expect(roomCards(engine.roomState).some((card) => card.uuid === token.uuid)).toBe(false);
    expect(
      events(engine).filter((e) => e.eventId === 'PERMANENT_DIED' || e.eventId === 'PERMANENT_DESTROYED'),
    ).toHaveLength(0);
  });
  it.each(['cancel_event', 'regenerate'] as const)('preserves the token when destruction is replaced by %s', (type) => {
    const { engine } = start();
    engine.resolveTopOfStack();
    const token = tokens(engine)[0];
    events(engine);
    engine.roomState.replacementEffects = [
      { id: 'save', label: 'Save', match: { kinds: ['destroy'] }, operation: { type } },
    ];
    engine.applyMutations([{ type: 'DESTROY_CARD', cardUuid: token.uuid, zoneRevision: 0 }]);
    expect(tokens(engine)).toHaveLength(1);
    expect(events(engine).some((e) => e.eventId === 'PERMANENT_DIED' || e.eventId === 'TOKEN_CEASED')).toBe(false);
  });
  it('retains destruction-outcome follow-ups despite having no destination occupant', () => {
    const { engine } = start();
    engine.resolveTopOfStack();
    const token = tokens(engine)[0];
    const source = engine.roomState.battlefield.find((card) => !card.isToken)!;
    const effects = buildStackEffects(
      [
        {
          action: 'DESTROY',
          params: {},
          targeting: { type: 'permanent', required: true },
          recordOutcome: { name: 'destroyed', kind: 'destroyed' },
        },
        {
          action: 'MODIFY_LIFE',
          params: { amount: 3 },
          targeting: { type: 'self', required: false },
          requiresOutcome: 'destroyed',
        },
      ] as EffectDefinition[],
      'player1',
      source,
    );
    effects[0].targets = [{ targetType: 'permanent', cardUuid: token.uuid, zoneRevision: 0 }];
    engine.applyMutations([
      {
        type: 'PUSH_STACK',
        stackObject: {
          uuid: 'destroy-token',
          type: 'triggered',
          source,
          controllerId: 'player1',
          countered: false,
          effects,
        },
      },
    ]);
    engine.resolveTopOfStack();
    expect(engine.roomState.players.player1.life).toBe(23);
    expect(engine.roomState.players.player1.graveyard).toEqual([]);
  });
  it('projects creation and departure deltas without adding phantom graveyard/exile cards', () => {
    const { engine } = start();
    const sync = new SyncService({} as never);
    const before = structuredClone(engine.roomState);
    const result = engine.resolveTopOfStack();
    if (!result.success) throw new Error('Expected birth');
    const raw = sync.buildDelta(before, result.mutations!, { action: 'resolve', playerId: 'player1' });
    for (const viewer of ['player1', 'player2']) {
      const filtered = sync.filterForPlayer(raw, viewer, engine.roomState);
      expect(applyDeltaChanges(buildPlayerView(before, viewer), filtered.changes)).toEqual(
        buildPlayerView(engine.roomState, viewer),
      );
    }
    const token = tokens(engine)[0],
      prior = structuredClone(engine.roomState);
    const moves = engine.applyMutations([
      { type: 'MOVE_CARD', cardUuid: token.uuid, playerId: 'player1', from: 'battlefield', to: 'exile' },
    ]);
    const removal = sync.buildDelta(prior, moves, { action: 'resolve', playerId: 'player1' });
    expect(removal.changes.some((change) => change.path.includes('exile'))).toBe(false);
    const filtered = sync.filterForPlayer(removal, 'player2', engine.roomState);
    expect(applyDeltaChanges(buildPlayerView(prior, 'player2'), filtered.changes)).toEqual(
      buildPlayerView(engine.roomState, 'player2'),
    );
  });
});
