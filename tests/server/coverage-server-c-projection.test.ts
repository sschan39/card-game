import { describe, expect, it } from 'vitest';
import { PROTOCOL_VERSION, type ActionOption, type PublicNotification } from '@card-game/protocol';
import type { GameRoom } from '@card-game/engine/types/game.room.types';
import type { CardInstance, CardSnapshot } from '@card-game/engine/types/card.types';
import type { CardObservation } from '@card-game/engine/types/card-observation.types';
import { observationLimits } from '@card-game/engine/shared/observation-policy';
import { gameReducer } from '@engine/game-reducer';
import { CardCharacteristicService } from '@card-game/engine/engine/card-characteristic-service';
import { authConfig } from '@server/config';
import { InMemoryAccountStore } from '@server/auth/account-store';
import { AuthService } from '@server/auth/service';
import { InMemoryStore } from '@server/rooms/state-store';
import { projectActionOptions } from '@server/projection/action-options';
import { projectViewDelta } from '@server/projection/delta-projector';
import { buildObservationViews } from '@server/projection/observation-view';
import { decodeAbilityId, publicAbilityId } from '@server/projection/wire-identifiers';
import { authenticateHandshake } from '@server/realtime/handshake';
import { createTestRoom, fillTestLibraries } from '../helpers/test-room-factory';
import { creature } from '../helpers/combat-fixture';
import { windowCard } from '../helpers/card-window-fixture';

const audience = (faces: string[] = [], count: string[] = [], order: string[] = []) => ({ faces, count, order });

function snapshot(card: CardInstance, overrides: Partial<CardSnapshot> = {}): CardSnapshot {
  return { card, power: 1, toughness: 1, ...overrides };
}

function observations(room: GameRoom, active: CardObservation[], history: CardObservation[] = []) {
  room.cardObservations = {
    sequence: history.length,
    active: Object.fromEntries(active.map(observation => [observation.id, observation])),
    history: history.map((observation, index) => ({ sequence: index + 1, observation })),
  };
  return room;
}

function observation(overrides: Partial<CardObservation> = {}): CardObservation {
  return {
    id: 'observation-one',
    ownerStackUuid: 'stack-one',
    resultName: 'window',
    controllerId: 'player1',
    zoneOwnerId: 'player1',
    sourceInfo: snapshot(creature('source', 'player1')),
    emptyAudience: audience(),
    members: [],
    turnNumber: 3,
    ...overrides,
  };
}

describe('projected action options', () => {
  it('strips provenance from ability labels and keeps only wire-safe data fields', () => {
    const options = [
      { actionId: 'activate_ability', label: 'Granted ability@effect:secret', description: 'Use it', disabled: true, disabledReason: 'No mana', hidden: true,
        data: { abilityId: 'granted@effect:secret', manaColor: 'red', abilityIndex: 2, zoneRevision: 3, secret: 'hidden', unsafe: 1.5, stringIndex: '2' } },
      { actionId: 'play_land', label: 'Play land', data: { abilityId: 'plain-id', manaColor: 7, zoneRevision: Number.MAX_SAFE_INTEGER + 2, abilityIndex: 'one' } },
      { actionId: 'pass_priority', label: 'Pass priority' },
    ] as ActionOption[];
    const projected = projectActionOptions(options, 'room-one', 'player1');
    expect(projected).toHaveLength(3);
    expect(projected[0].label).toBe('Granted ability');
    expect(projected[0]).toMatchObject({ description: 'Use it', disabled: true, disabledReason: 'No mana', hidden: true });
    expect(projected[0].data).toEqual({
      abilityId: publicAbilityId('room-one', 'player1', 'granted@effect:secret'),
      manaColor: 'red',
      abilityIndex: 2,
      zoneRevision: 3,
    });
    expect(JSON.stringify(projected[0].data)).not.toContain('effect:secret');
    expect(projected[1].label).toBe('Play land');
    expect(projected[1].data).toEqual({ abilityId: 'plain-id' });
    expect(projected[1].data).not.toHaveProperty('manaColor');
    expect(projected[2]).toEqual({ actionId: 'pass_priority', label: 'Pass priority' });
    expect(projected[2].data).toBeUndefined();
  });
});

describe('opaque wire identifiers', () => {
  it('hashes only identifiers that embed server provenance and is viewer specific', () => {
    expect(publicAbilityId('room', 'viewer', 'plain')).toBe('plain');
    const first = publicAbilityId('room', 'viewer', 'granted@effect:secret');
    expect(first).toMatch(/^ability:[0-9a-f]{64}$/);
    expect(publicAbilityId('room', 'viewer', 'granted@effect:secret')).toBe(first);
    expect(publicAbilityId('room', 'other', 'granted@effect:secret')).not.toBe(first);
  });

  it('decodes an advertised ability from the battlefield and the hand', () => {
    let room = createTestRoom();
    fillTestLibraries(room);
    const handCard = room.players.player1.hand[0];
    const battlefieldCard = creature('field-host', 'player1');
    room.battlefield = [battlefieldCard];
    const grant = (card: CardInstance, suffix: string) => ({
      type: 'ADD_CONTINUOUS_EFFECT' as const,
      entry: {
        id: 'effect:' + suffix,
        source: 'global' as const,
        requiredZone: null,
        duration: 'PERMANENT' as const,
        layer: 6 as const,
        scope: { cardUuid: card.uuid },
        effect: { type: 'ABILITY' as const, add: [{ id: 'granted', type: 'activated' as const, cost: {}, castSpeed: 'instant' as const,
          effect: { action: 'DRAW' as const, params: { amount: 1 }, targeting: { type: 'player' as const, required: true } } }] },
      },
    });
    room = gameReducer(room, grant(handCard, handCard.uuid));
    room = gameReducer(room, grant(battlefieldCard, battlefieldCard.uuid));
    for (const card of [handCard, battlefieldCard]) {
      const granted = CardCharacteristicService.resolveAbilities(room, card).find(ability => typeof ability.id === 'string' && ability.id.includes('@'));
      expect(granted).toBeDefined();
      const wireId = publicAbilityId(room.roomId, 'player1', granted!.id as string);
      expect(decodeAbilityId(room, 'player1', { cardUuid: card.uuid, abilityId: wireId })).toEqual({ cardUuid: card.uuid, abilityId: granted!.id });
    }
  });

  it('passes through unrelated data and rejects unadvertised or unknown abilities', () => {
    const room = createTestRoom();
    fillTestLibraries(room);
    const plain = { cardUuid: 'no-card', action: 'cast_spell' };
    expect(decodeAbilityId(room, 'player1', plain)).toBe(plain);
    expect(decodeAbilityId(room, 'player1', { cardUuid: 'no-card', abilityId: 'plain-id' })).toEqual({ cardUuid: 'no-card', abilityId: 'plain-id' });
    expect(() => decodeAbilityId(room, 'player1', { cardUuid: 'missing-card', abilityId: 'ability:deadbeef' })).toThrow('Invalid ability option');
    const handCard = room.players.player1.hand[0];
    expect(() => decodeAbilityId(room, 'player1', { cardUuid: handCard.uuid, abilityId: 'ability:deadbeef' })).toThrow('Invalid ability option');
    expect(() => decodeAbilityId(room, 'outsider', { cardUuid: handCard.uuid, abilityId: 'ability:deadbeef' })).toThrow('Invalid ability option');
  });
});

describe('delta projection boundary', () => {
  it('projects a full update list when no previous snapshot exists', () => {
    const after = createTestRoom({ roomId: 'room-delta' });
    fillTestLibraries(after);
    const delta = projectViewDelta(undefined, after, 'player1', { seq: 7, timestamp: 99 });
    expect(delta).toMatchObject({ protocolVersion: PROTOCOL_VERSION, viewerId: 'player1', roomId: 'room-delta', seq: 7, timestamp: 99 });
    expect(delta.action).toBeUndefined();
    expect(delta.playerId).toBeUndefined();
    expect(delta.commandId).toBeUndefined();
    expect(delta.notifications).toBeUndefined();
    expect(delta.changes.length).toBeGreaterThan(0);
    expect(delta.changes.every(change => change.op === 'update')).toBe(true);
  });

  it('reports removals, updates and optional metadata without leaking raw state', () => {
    const before = createTestRoom({ roomId: 'room-delta', outcome: { type: 'draw', losses: [] } });
    fillTestLibraries(before);
    const after = structuredClone(before);
    delete (after as { outcome?: unknown }).outcome;
    after.turnNumber = 9;
    const delta = projectViewDelta(before, after, 'player1', {
      seq: 8,
      timestamp: 100,
      action: 'pass_priority',
      playerId: 'player1',
      commandId: 'command-1',
      notifications: [{ eventId: 'ACTION_RESOLVED', eventUuid: 'event-1', summary: 'hello' } as PublicNotification],
    });
    expect(delta.changes).toContainEqual({ path: 'outcome', op: 'remove' });
    expect(delta.changes).toContainEqual({ path: 'turnNumber', op: 'update', value: 9 });
    expect(delta.changes.every(change => change.op !== 'remove' || change.path === 'outcome')).toBe(true);
    expect(delta).toMatchObject({ action: 'pass_priority', playerId: 'player1', commandId: 'command-1' });
    expect(delta.notifications).toHaveLength(1);
    const empty = projectViewDelta(before, after, 'player1', { seq: 9, timestamp: 101, notifications: [] });
    expect(empty.notifications).toBeUndefined();
  });
});

describe('observation projection', () => {
  it('omits observations with no audience for the viewer in both active and history', () => {
    const room = observations(createTestRoom(), [observation()], [observation({ id: 'history-one' })]);
    expect(buildObservationViews(room, 'player2')).toEqual({ active: [], history: [] });
    expect(buildObservationViews(createTestRoom(), 'player1')).toEqual({ active: [], history: [] });
  });

  it('projects faces, counts and opaque independent ordering for an authorized viewer', () => {
    const first = windowCard('alpha'), second = windowCard('beta');
    first.blueprint = { ...first.blueprint, power: undefined, toughness: undefined, subTypes: undefined };
    first.state.zoneRevision = undefined;
    second.state.zoneRevision = 5;
    second.lastKnownCharacteristics = {
      ...second.blueprint,
      name: 'Recovered beta',
      cardTypes: ['Artifact'],
      subTypes: ['Relic'],
      rulesText: 'Recovered rules',
      power: 2,
      toughness: 3,
    } as unknown as NonNullable<CardInstance['lastKnownCharacteristics']>;
    const observationOne = observation({
      id: 'public-window',
      members: [
        { snapshot: snapshot(first), audience: audience(['player2'], [], ['player2']) },
        { snapshot: snapshot(second), audience: audience(['player2'], ['player2'], ['player2']) },
      ],
    });
    const room = observations(createTestRoom(), [observationOne]);
    const view = buildObservationViews(room, 'player2').active[0];
    expect(view).toMatchObject({ turnNumber: 3, ordered: true, count: 1 });
    expect(view.cards?.map(card => card.name)).toEqual(['Secret alpha', 'Recovered beta']);
    expect(view.cards?.[1]).toMatchObject({ definitionId: 'definition-creature', cardTypes: ['Artifact'], subTypes: ['Relic'], rulesText: 'Recovered rules', power: 2, toughness: 3 });
    expect(view.cards?.[0]).not.toHaveProperty('power');
    expect(view.cards?.[0]).not.toHaveProperty('toughness');
    expect(view.cards?.[0].subTypes).toEqual([]);
    expect(new Set(view.cards?.map(card => card.id)).size).toBe(2);
    expect(view.cards?.[0].id).not.toBe(first.uuid);
    expect(JSON.stringify(view)).not.toContain('"uuid"');
  });

  it('sorts unordered faces by opaque identifier so source order does not leak', () => {
    const cards = ['zebra', 'alpha', 'middle'].map(name => windowCard(name));
    const unordered = observation({
      members: cards.map(card => ({ snapshot: snapshot(card), audience: audience(['player1'], ['player1'], []) })),
    });
    const room = observations(createTestRoom(), [unordered]);
    const forwardView = buildObservationViews(room, 'player1').active[0];
    const reversedRoom = observations(room, [{ ...unordered, members: [...unordered.members].reverse() }]);
    expect(forwardView.ordered).toBe(false);
    expect(forwardView.cards?.map(card => card.name)).toEqual(
      buildObservationViews(reversedRoom, 'player1').active[0].cards?.map(card => card.name),
    );
    const names = forwardView.cards?.map(card => card.name) ?? [];
    const ids = forwardView.cards?.map(card => card.id) ?? [];
    expect(names).toHaveLength(3);
    expect(ids).toEqual([...ids].sort((a, b) => a.localeCompare(b)));
  });

  it('discloses a count without faces for count-only and empty windows', () => {
    const first = windowCard('counted'), second = windowCard('also-counted');
    const counted = observation({
      id: 'count-only',
      members: [
        { snapshot: snapshot(first), audience: audience([], ['player2'], []) },
        { snapshot: snapshot(second), audience: audience(['player1'], ['player2'], ['player1']) },
      ],
    });
    const empty = observation({ id: 'empty-window', members: [], emptyAudience: audience([], ['player2'], []) });
    const facesOnly = observation({
      id: 'faces-only',
      members: [{ snapshot: snapshot(windowCard('faces-only-card')), audience: audience(['player2'], [], ['player2']) }],
    });
    const room = observations(createTestRoom(), [counted, empty, facesOnly]);
    const views = buildObservationViews(room, 'player2').active;
    expect(views).toHaveLength(3);
    expect(views[0]).toMatchObject({ count: 2, ordered: false });
    expect(views[0].cards).toBeUndefined();
    expect(views[1]).toMatchObject({ count: 0, ordered: false });
    expect(views[1].cards).toBeUndefined();
    expect(views[2].ordered).toBe(true);
    expect(views[2].count).toBeUndefined();
    expect(views[2].cards).toHaveLength(1);
    expect(buildObservationViews(observations(createTestRoom(), [], [empty]), 'player2').history[0].count).toBe(0);
  });

  it('keeps only the most recent authorized history entries', () => {
    const history = Array.from({ length: observationLimits.historyLimit + 3 }, (_, index) =>
      observation({ id: 'history-' + index, turnNumber: index, members: [{ snapshot: snapshot(windowCard('history-' + index)), audience: audience(['player1'], ['player1'], ['player1']) }] }),
    );
    const room = observations(createTestRoom(), [], history);
    const views = buildObservationViews(room, 'player1').history;
    expect(views).toHaveLength(observationLimits.historyLimit);
    expect(views[views.length - 1].turnNumber).toBe(observationLimits.historyLimit + 2);
    expect(views[0].turnNumber).toBe(3);
  });
});

describe('socket handshake authentication', () => {
  function makeAuth() {
    const store = new InMemoryStore(new InMemoryAccountStore());
    return { store, auth: new AuthService(store.auth, store, authConfig) };
  }

  it('resolves a game session to its player and owned room', async () => {
    const { auth, store } = makeAuth();
    const room = createTestRoom({ roomId: 'room-handshake' });
    store.saveRoom(room);
    const guest = auth.guest();
    const session = auth.sessions.validate(guest.token)!;
    auth.claimSeat(session, room.roomId, 'player1');
    const identity = authenticateHandshake(auth, { protocolVersion: PROTOCOL_VERSION, token: guest.token, roomId: room.roomId });
    expect(identity).toMatchObject({ playerId: 'player1', roomId: room.roomId });
    expect(identity.rejoinDenied).toBeUndefined();
    expect(identity.session.id).toBe(session.id);
    const withoutRoom = authenticateHandshake(auth, { protocolVersion: PROTOCOL_VERSION, token: guest.token });
    expect(withoutRoom.roomId).toBeNull();
    expect(withoutRoom.playerId).toBe('guest:' + session.subject.id);
  });

  it('denies rejoining a room the session does not own', () => {
    const { auth } = makeAuth();
    const guest = auth.guest();
    const identity = authenticateHandshake(auth, { protocolVersion: PROTOCOL_VERSION, token: guest.token, roomId: 'missing-room' });
    expect(identity.roomId).toBeNull();
    expect(identity.rejoinDenied).toBe(true);
  });

  it('rejects malformed input, revoked tokens, browser and admin sessions', async () => {
    const { auth } = makeAuth();
    expect(() => authenticateHandshake(auth, {})).toThrow('valid session');
    expect(() => authenticateHandshake(auth, { protocolVersion: PROTOCOL_VERSION, token: 'a'.repeat(43) })).toThrow('expired or revoked');
    const account = await auth.register({ username: 'handshake-user', password: 'copper-lantern-river-94!' });
    const browser = await auth.login({ username: 'handshake-user', password: 'copper-lantern-river-94!' }, undefined, true);
    expect(() => authenticateHandshake(auth, { protocolVersion: PROTOCOL_VERSION, token: browser.token })).toThrow('game session');
    await auth.bootstrapAdmin('handshake-admin', 'copper-lantern-river-94!');
    const admin = await auth.login({ username: 'handshake-admin', password: 'copper-lantern-river-94!', scope: 'admin' });
    expect(() => authenticateHandshake(auth, { protocolVersion: PROTOCOL_VERSION, token: admin.token })).toThrow('game session');
    auth.logout(account.token);
    expect(() => authenticateHandshake(auth, { protocolVersion: PROTOCOL_VERSION, token: account.token })).toThrow('expired or revoked');
  });
});
