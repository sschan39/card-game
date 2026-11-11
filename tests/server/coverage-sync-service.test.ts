import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { SyncService, getAtPath, cardStatePath, type StateDelta, type DeltaChange } from '@server/rooms/sync-service';
import { createTestRoom } from '../helpers/test-room-factory';
import { creature } from '../helpers/combat-fixture';
import { instantiateCard } from '@library/card-factory';
import { captureSourceInformation } from '@engine/source-information';
import { gameConfig } from '@card-game/engine/config';
import { GameLogger, serverLogger } from '@card-game/engine/shared/game-logger';
import type { GameRoom, PlayerId } from '@shared/game.room.types';
import type { GameMutation } from '@shared/game-mutation.types';
import type { CardInstance, CardZone } from '@shared/card.types';
import type { StackObject } from '@shared/effect.types';
import type { ContinuousEffectEntry } from '@shared/continuous-effect.types';
import type { CardObservation } from '@shared/card-observation.types';
import type { TurnHistory } from '@shared/trigger.types';
import type { AppliedEventBatch } from '@shared/game-event.types';

const P1: PlayerId = 'player1';
const P2: PlayerId = 'player2';

function cardInZone(uuid: string, owner: PlayerId, zone: CardZone): CardInstance {
  const base = creature(uuid, owner);
  return { ...base, state: { ...base.state, zone, ownerId: owner, controllerId: owner, zoneRevision: 0 } };
}

function realCard(id: string, owner: PlayerId, zone: CardZone): CardInstance {
  const base = instantiateCard(id);
  return { ...base, state: { ...base.state, zone, ownerId: owner, controllerId: owner, zoneRevision: 0 } };
}

function tokenCard(uuid: string, owner: PlayerId, zone: CardZone): CardInstance {
  const base = cardInZone(uuid, owner, zone);
  return { ...base, isToken: true };
}

function spell(uuid: string, source: CardInstance): StackObject {
  return { uuid, type: 'spell', controllerId: source.state.controllerId, source, effects: [], countered: false };
}

function abilityObject(uuid: string, source: CardInstance): StackObject {
  return { uuid, type: 'triggered', controllerId: source.state.controllerId, source, effects: [], countered: false };
}

function continuousEntry(overrides: Partial<ContinuousEffectEntry> & Pick<ContinuousEffectEntry, 'effect' | 'source'>): ContinuousEffectEntry {
  return { duration: 'PERMANENT', layer: 6, scope: {}, ...overrides };
}

function delayedTrigger(id: string, source: CardInstance, room: GameRoom) {
  return {
    id,
    source,
    sourceInfo: captureSourceInformation(room, source),
    controllerId: source.state.controllerId,
    lifetime: 'once' as const,
    ability: { id: `${id}-ability`, type: 'triggered' as const, triggerCondition: 'ON_DIE' as const, castSpeed: 'instant' as const, effects: [] },
  };
}

function history(turnNumber = 2): TurnHistory {
  return { turnNumber, events: [], counts: {}, playerCounts: {}, uses: {} };
}

function observation(room: GameRoom, source: CardInstance): CardObservation {
  return {
    id: 'obs-1',
    ownerStackUuid: 'stack-1',
    resultName: 'look',
    controllerId: P1,
    zoneOwnerId: P1,
    sourceInfo: captureSourceInformation(room, source),
    emptyAudience: { faces: [], count: [], order: [] },
    members: [],
    turnNumber: 1,
  };
}

describe('SyncService coverage — mutation mapping', () => {
  let service: SyncService;
  let tmpDir: string;
  let emitted: Array<{ room: string; event: string; data: unknown }>;

  const mockIo = () => ({
    to: (room: string) => ({
      emit: (event: string, data: unknown) => { emitted.push({ room, event, data }); },
    }),
  }) as any;

  const run = (room: GameRoom, mutations: GameMutation[], extra: { action?: string; playerId?: PlayerId; batches?: AppliedEventBatch[] } = {}) =>
    service.buildDelta(room, mutations, { action: extra.action ?? 'test', playerId: extra.playerId ?? P1, batches: extra.batches });

  const find = (delta: StateDelta, target: string) => delta.changes.find(change => change.path === target);

  beforeEach(() => {
    emitted = [];
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sync-coverage-'));
    service = new SyncService(mockIo(), path.join(tmpDir, 'deltas.jsonl'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('maps token creation to the battlefield array and token sequence', () => {
    const room = createTestRoom();
    const delta = run(room, [{ type: 'CREATE_TOKEN', tokenId: 'token-angel-1-1', cardUuid: 'token-1', playerId: P1, sequence: 1 }]);

    expect(find(delta, 'battlefield')?.op).toBe('update');
    expect((find(delta, 'battlefield')?.value as CardInstance[]).map(card => card.uuid)).toEqual(['token-1']);
    expect(find(delta, 'tokenSequence')).toMatchObject({ op: 'update', oldValue: undefined, value: 1 });
  });

  it('maps a shuffle to the player deck path', () => {
    const first = cardInZone('deck-a', P1, 'library');
    const second = cardInZone('deck-b', P1, 'library');
    const room = createTestRoom();
    room.players[P1].deck = [first, second];
    const order = [second, first].map(card => ({ cardUuid: card.uuid, zoneRevision: 0 }));

    const delta = run(room, [{ type: 'SHUFFLE_LIBRARY', playerId: P1, order }]);

    expect(find(delta, `players.${P1}.deck`)).toMatchObject({ op: 'update' });
    expect((find(delta, `players.${P1}.deck`)?.value as CardInstance[]).map(card => card.uuid)).toEqual(['deck-b', 'deck-a']);
  });

  it('maps a library reorder to the player deck path', () => {
    const first = cardInZone('deck-a', P1, 'library');
    const second = cardInZone('deck-b', P1, 'library');
    const room = createTestRoom();
    room.players[P1].deck = [first, second];
    const order = [second, first].map(card => ({ cardUuid: card.uuid, zoneRevision: 0 }));

    const delta = run(room, [{ type: 'REORDER_LIBRARY', playerId: P1, order }]);

    expect((find(delta, `players.${P1}.deck`)?.value as CardInstance[]).map(card => card.uuid)).toEqual(['deck-b', 'deck-a']);
  });

  it('maps replacement effect registration to the pool and its sequence', () => {
    const room = createTestRoom();
    const delta = run(room, [{
      type: 'ADD_REPLACEMENT_EFFECT',
      effect: { label: 'Shield', operation: { type: 'prevent_damage', amount: 1 } },
    }]);

    expect(find(delta, 'replacementEffects')).toMatchObject({ op: 'update', oldValue: undefined });
    expect((find(delta, 'replacementEffects')?.value as unknown[]).length).toBe(1);
    expect(find(delta, 'replacementSequence')).toMatchObject({ op: 'update', value: 1 });
  });

  it('maps replacement effect removal and wholesale replacement', () => {
    const room = createTestRoom();
    room.replacementEffects = [{ id: 'shield', label: 'Shield', operation: { type: 'prevent_damage', amount: 1 } }];
    room.replacementSequence = 1;
    const removed = run(room, [{ type: 'REMOVE_REPLACEMENT_EFFECT', id: 'shield' }]);
    expect(find(removed, 'replacementEffects')?.value).toEqual([]);

    const replaced = run(room, [{ type: 'SET_REPLACEMENT_EFFECTS', effects: [] }]);
    expect(find(replaced, 'replacementEffects')?.value).toEqual([]);
  });

  it('maps CEASE_CARD on the stack, library and hand to the owning array', () => {
    const stackSource = tokenCard('token-stack', P1, 'stack');
    const stackRoom = createTestRoom();
    stackRoom.stack = [spell('spell-stack', stackSource)];
    const stackDelta = run(stackRoom, [{ type: 'CEASE_CARD', cardUuid: 'token-stack', zoneRevision: 0, playerId: P1, zone: 'stack' }]);
    expect(find(stackDelta, 'stack')).toMatchObject({ op: 'update' });
    expect(find(stackDelta, 'stack')?.value).toEqual([]);

    const libraryToken = tokenCard('token-library', P1, 'library');
    const libraryRoom = createTestRoom();
    libraryRoom.players[P1].deck = [libraryToken];
    const libraryDelta = run(libraryRoom, [{ type: 'CEASE_CARD', cardUuid: 'token-library', zoneRevision: 0, playerId: P1, zone: 'library' }]);
    expect(find(libraryDelta, `players.${P1}.deck`)).toMatchObject({ op: 'update', value: [] });

    const handToken = tokenCard('token-hand', P1, 'hand');
    const handRoom = createTestRoom();
    handRoom.players[P1].hand = [handToken];
    const handDelta = run(handRoom, [{ type: 'CEASE_CARD', cardUuid: 'token-hand', zoneRevision: 0, playerId: P1, zone: 'hand' }]);
    expect(find(handDelta, `players.${P1}.hand`)).toMatchObject({ op: 'update', value: [] });
  });

  it('maps ATTACH_CARD and UNATTACH_CARD to the permanent state path', () => {
    const equipment = realCard('heavenly-lance', P1, 'battlefield');
    const host = realCard('empire-servant', P1, 'battlefield');
    const room = createTestRoom();
    room.battlefield = [equipment, host];

    const attached = run(room, [{ type: 'ATTACH_CARD', cardUuid: equipment.uuid, zoneRevision: 0, hostUuid: host.uuid, hostRevision: 0, controllerId: P1 }]);
    const attachment = find(attached, 'battlefield[0].state');
    expect(attachment?.op).toBe('update');
    expect((attachment?.value as CardInstance['state']).attachedTo).toBe(host.uuid);

    const roomAfter = structuredClone(room);
    roomAfter.battlefield = [{ ...equipment, state: { ...equipment.state, attachedTo: host.uuid, attachedToRevision: 0, attachedToPlayerId: null } }, host];
    const detached = run(roomAfter, [{ type: 'UNATTACH_CARD', cardUuid: equipment.uuid }]);
    expect((find(detached, 'battlefield[0].state')?.value as CardInstance['state']).attachedTo).toBeNull();
  });

  it('maps SET_BATTLE_PROTECTOR to the protector field', () => {
    const permanent = cardInZone('permanent', P1, 'battlefield');
    const room = createTestRoom();
    room.battlefield = [permanent];
    const delta = run(room, [{ type: 'SET_BATTLE_PROTECTOR', cardUuid: permanent.uuid, playerId: P2 }]);
    expect(find(delta, 'battlefield[0].state.protectorId')).toMatchObject({ op: 'update', value: P2 });
  });

  it('maps life, failed draw and draw mutations to player fields', () => {
    const lifeRoom = createTestRoom();
    const lifeDelta = run(lifeRoom, [{ type: 'CHANGE_LIFE', playerId: P2, amount: -3 }]);
    expect(find(lifeDelta, `players.${P2}.life`)).toMatchObject({ op: 'update', oldValue: 20, value: 17 });

    const failedRoom = createTestRoom();
    const failedDelta = run(failedRoom, [{ type: 'SET_FAILED_DRAW', playerId: P2, value: true }]);
    expect(find(failedDelta, `players.${P2}.failedDraw`)).toMatchObject({ op: 'update', value: true });

    const drawRoom = createTestRoom();
    drawRoom.players[P1].deck = [cardInZone('top-card', P1, 'library')];
    const drawDelta = run(drawRoom, [{ type: 'DRAW_CARDS', playerId: P1, amount: 1 }]);
    expect(find(drawDelta, `players.${P1}.deck`)).toMatchObject({ op: 'update', value: [] });
    expect((find(drawDelta, `players.${P1}.hand`)?.value as CardInstance[]).map(card => card.uuid)).toContain('top-card');
    expect(find(drawDelta, `players.${P1}.failedDraw`)).toMatchObject({ op: 'update', value: undefined });

    const emptyRoom = createTestRoom();
    emptyRoom.players[P1].deck = [];
    const emptyDelta = run(emptyRoom, [{ type: 'DRAW_CARDS', playerId: P1, amount: 1 }]);
    expect(find(emptyDelta, `players.${P1}.failedDraw`)).toMatchObject({ op: 'update', value: true });
  });

  it('maps damage, deathtouch and regeneration state changes', () => {
    const damaged = cardInZone('damaged', P1, 'battlefield');
    const room = createTestRoom();
    room.battlefield = [damaged];
    const marked = run(room, [{ type: 'MARK_DAMAGE', cardUuid: damaged.uuid, zoneRevision: 0, amount: 2 }]);
    expect(find(marked, 'battlefield[0].state.damageTaken')).toMatchObject({ op: 'update', oldValue: 0, value: 2 });

    const deathtouchRoom = createTestRoom();
    deathtouchRoom.battlefield = [damaged];
    const deathtouch = run(deathtouchRoom, [{ type: 'SET_DEATHTOUCH_DAMAGE', cardUuid: damaged.uuid, value: true }]);
    expect(find(deathtouch, 'battlefield[0].state.deathtouchDamage')).toMatchObject({ op: 'update', value: true });

    const regenerateRoom = createTestRoom();
    const wounded = { ...damaged, state: { ...damaged.state, damageTaken: 3 } };
    regenerateRoom.battlefield = [wounded];
    regenerateRoom.combat = [{ uuid: wounded.uuid, attacker: wounded, attackerPower: 2, blockers: [] }];
    const regenerated = run(regenerateRoom, [{ type: 'REGENERATE_CARD', cardUuid: wounded.uuid, zoneRevision: 0 }]);
    expect((find(regenerated, 'battlefield[0].state')?.value as CardInstance['state']).isTapped).toBe(true);
    // Combat reconciliation is attached even though REGENERATE_CARD has no explicit combat mapping.
    expect(find(regenerated, 'combat')?.value).toEqual([]);
  });

  it('maps destroy and sacrifice to a battlefield-to-graveyard move', () => {
    const destroyed = cardInZone('destroyed', P1, 'battlefield');
    const destroyRoom = createTestRoom();
    destroyRoom.battlefield = [destroyed];
    const destroyDelta = run(destroyRoom, [{ type: 'DESTROY_CARD', cardUuid: destroyed.uuid, zoneRevision: 0 }]);
    expect(find(destroyDelta, 'battlefield[0]')).toMatchObject({ op: 'remove', oldValue: destroyed });
    expect(find(destroyDelta, `players.${P1}.graveyard[0]`)).toMatchObject({ op: 'add' });

    const sacrificed = cardInZone('sacrificed', P1, 'battlefield');
    const sacrificeRoom = createTestRoom();
    sacrificeRoom.battlefield = [sacrificed];
    const sacrificeDelta = run(sacrificeRoom, [{ type: 'SACRIFICE_CARD', cardUuid: sacrificed.uuid, zoneRevision: 0 }]);
    expect(find(sacrificeDelta, 'battlefield[0]')).toMatchObject({ op: 'remove' });
    expect(find(sacrificeDelta, `players.${P1}.graveyard[0]`)).toMatchObject({ op: 'add' });
  });

  it('maps a damage batch without precomputed results to life and battlefield state changes', () => {
    const source = cardInZone('source', P1, 'battlefield');
    const target = cardInZone('target', P2, 'battlefield');
    const room = createTestRoom();
    room.battlefield = [source, target];
    const sourceInfo = captureSourceInformation(room, source);
    const delta = run(room, [{
      type: 'APPLY_DAMAGE_BATCH',
      assignments: [
        { source: sourceInfo, recipient: { kind: 'player', playerId: P2 }, amount: 3, combat: false },
        { source: sourceInfo, recipient: { kind: 'permanent', cardUuid: target.uuid, zoneRevision: 0 }, amount: 2, combat: false },
      ],
    }]);

    expect(find(delta, `players.${P2}.life`)).toMatchObject({ op: 'update', oldValue: 20, value: 17 });
    expect(find(delta, 'battlefield[1].state')).toBeDefined();
    expect((find(delta, 'battlefield[1].state')?.value as CardInstance['state']).damageTaken).toBe(2);
  });

  it('replays damage-batch result mutations in order and tolerates no-op results', () => {
    const source = cardInZone('source', P1, 'battlefield');
    const room = createTestRoom();
    room.battlefield = [source];
    const sourceInfo = captureSourceInformation(room, source);
    const delta = run(room, [{
      type: 'APPLY_DAMAGE_BATCH',
      assignments: [{ source: sourceInfo, recipient: { kind: 'player', playerId: P2 }, amount: 2, combat: false }],
      results: [
        { type: 'CHANGE_LIFE', playerId: P2, amount: -2 },
        { type: 'TAP_CARD', cardUuid: 'not-on-battlefield' },
      ],
    }]);

    expect(find(delta, `players.${P2}.life`)).toMatchObject({ op: 'update', oldValue: 20, value: 18 });
    expect(delta.changes.filter(change => change.path === 'battlefield[0].state.isTapped')).toHaveLength(0);
  });

  it('maps combat damage state', () => {
    const room = createTestRoom();
    const delta = run(room, [{ type: 'SET_COMBAT_DAMAGE', state: null }]);
    expect(find(delta, 'combatDamage')).toMatchObject({ op: 'update', value: null });
  });

  it('maps player zone replacement', () => {
    const room = createTestRoom();
    const deck = [cardInZone('new-deck', P1, 'library')];
    const hand = [cardInZone('new-hand', P1, 'hand')];
    const delta = run(room, [{ type: 'SET_PLAYER_ZONES', playerId: P1, deck, hand }]);
    expect((find(delta, `players.${P1}.deck`)?.value as CardInstance[]).map(card => card.uuid)).toEqual(['new-deck']);
    expect((find(delta, `players.${P1}.hand`)?.value as CardInstance[]).map(card => card.uuid)).toEqual(['new-hand']);
  });

  it('maps END_GAME to all terminal fields and closes observations', () => {
    const source = cardInZone('source', P1, 'battlefield');
    const room = createTestRoom();
    room.battlefield = [source];
    const obs = observation(room, source);
    room.cardObservations = { sequence: 1, active: { [obs.id]: obs }, history: [] };
    const delta = run(room, [{ type: 'END_GAME', outcome: { type: 'win', winnerId: P1, losses: [{ playerId: P2, reason: 'life_total' }] } }], { action: 'end' });

    for (const target of ['status', 'outcome', 'engineState', 'priorityPlayerId', 'lastPassedPlayerId']) {
      expect(find(delta, target)).toMatchObject({ op: 'update' });
    }
    expect(find(delta, 'status')?.value).toBe('gameOver');
    expect(find(delta, 'cardObservations')).toBeDefined();
    expect((find(delta, 'cardObservations')?.value as { active: Record<string, unknown> }).active).toEqual({});
  });

  it('maps single life, mana, add-mana and spend-mana mutations', () => {
    const room = createTestRoom();
    expect(find(run(room, [{ type: 'SET_LIFE', playerId: P1, amount: 12 }]), `players.${P1}.life`)).toMatchObject({ value: 12 });
    expect(find(run(room, [{ type: 'SET_MANA', playerId: P1, color: 'red', amount: 2 }]), `players.${P1}.mana.red`)).toMatchObject({ value: 2 });
    expect(find(run(room, [{ type: 'ADD_MANA', playerId: P1, color: 'blue', amount: 2 }]), `players.${P1}.mana.blue`)).toMatchObject({ value: 7 });
    expect(find(run(room, [{ type: 'SPEND_MANA', playerId: P1, cost: { red: 2 } }]), `players.${P1}.mana`)).toMatchObject({ op: 'update' });
  });

  it('maps tap, untap, summoning sickness, attack flag and damage set mutations', () => {
    const base = cardInZone('permanent', P1, 'battlefield');
    const room = createTestRoom();
    room.battlefield = [base];
    expect(find(run(room, [{ type: 'TAP_CARD', cardUuid: base.uuid }]), 'battlefield[0].state.isTapped')).toMatchObject({ value: true });

    const tappedRoom = createTestRoom();
    tappedRoom.battlefield = [{ ...base, state: { ...base.state, isTapped: true } }];
    expect(find(run(tappedRoom, [{ type: 'UNTAP_CARD', cardUuid: base.uuid }]), 'battlefield[0].state.isTapped')).toMatchObject({ value: false });

    expect(find(run(room, [{ type: 'SET_SUMMONING_SICKNESS', cardUuid: base.uuid, value: true }]), 'battlefield[0].state.summoningSickness')).toMatchObject({ value: true });
    expect(find(run(room, [{ type: 'SET_ATTACKED_THIS_TURN', cardUuid: base.uuid, value: true }]), 'battlefield[0].state.attackedThisTurn')).toMatchObject({ value: true });
    expect(find(run(room, [{ type: 'SET_DAMAGE', cardUuid: base.uuid, amount: 3 }]), 'battlefield[0].state.damageTaken')).toMatchObject({ value: 3 });
  });

  it('maps CLEAR_DAMAGE per damaged permanent and clears deathtouch flags', () => {
    const damaged = { ...cardInZone('damaged', P1, 'battlefield'), state: { ...cardInZone('damaged', P1, 'battlefield').state, damageTaken: 2, deathtouchDamage: true } };
    const healthy = cardInZone('healthy', P1, 'battlefield');
    const room = createTestRoom();
    room.battlefield = [damaged, healthy];

    const delta = run(room, [{ type: 'CLEAR_DAMAGE' }]);

    expect(find(delta, 'battlefield[0].state.damageTaken')).toMatchObject({ oldValue: 2, value: 0 });
    expect(find(delta, 'battlefield[0].state.deathtouchDamage')).toMatchObject({ oldValue: true, value: false });
    expect(find(delta, 'battlefield[1].state.damageTaken')).toBeUndefined();
    expect(find(delta, 'battlefield[1].state.deathtouchDamage')).toBeUndefined();
  });

  it('treats a legacy permanent without a damage value as undamaged during cleanup', () => {
    const legacy = cardInZone('legacy', P1, 'battlefield');
    legacy.state = { ...legacy.state, damageTaken: undefined as unknown as number };
    const room = createTestRoom();
    room.battlefield = [legacy];

    const delta = run(room, [{ type: 'CLEAR_DAMAGE' }]);

    expect(delta.changes).toEqual([]);
  });

  it('maps counter addition and removal', () => {
    const permanent = cardInZone('countered', P1, 'battlefield');
    const room = createTestRoom();
    room.battlefield = [permanent];
    const added = run(room, [{ type: 'ADD_COUNTER', cardUuid: permanent.uuid, counterType: '+1/+1', amount: 1 }]);
    expect(find(added, 'battlefield[0].state.counters.+1/+1')).toMatchObject({ op: 'update', value: 1 });

    const withCounter = createTestRoom();
    withCounter.battlefield = [{ ...permanent, state: { ...permanent.state, counters: { '+1/+1': 2 } } }];
    const removed = run(withCounter, [{ type: 'REMOVE_COUNTER', cardUuid: permanent.uuid, counterType: '+1/+1', amount: 1 }]);
    expect(find(removed, 'battlefield[0].state.counters.+1/+1')).toMatchObject({ op: 'update', oldValue: 2, value: 1 });
  });

  it('maps a granted World supertype to a new world timestamp', () => {
    const source = cardInZone('world-source', P1, 'battlefield');
    const room = createTestRoom();
    room.battlefield = [source];
    const delta = run(room, [{
      type: 'ADD_CONTINUOUS_EFFECT',
      entry: continuousEntry({
        id: 'world-effect', source: source.uuid, sourceRevision: 0, origin: 'resolved', requiredZone: null,
        scope: { cardUuid: source.uuid }, effect: { type: 'TYPE', addSuperTypes: ['World'] },
      }),
    }]);

    expect(find(delta, 'continuousEffectPool[0]')).toMatchObject({ op: 'add' });
    expect(find(delta, 'battlefield[0].state.worldTimestamp')).toMatchObject({ op: 'update', oldValue: undefined });
    expect(find(delta, 'battlefield[0].state.worldTimestamp')?.value).toEqual(expect.any(Number));
  });

  it('maps a control change to summoning sickness on the permanent', () => {
    const source = cardInZone('control-source', P1, 'battlefield');
    const room = createTestRoom();
    room.battlefield = [source];
    const delta = run(room, [{
      type: 'ADD_CONTINUOUS_EFFECT',
      entry: continuousEntry({
        id: 'control-effect', source: source.uuid, sourceRevision: 0, origin: 'resolved', requiredZone: null,
        scope: { cardUuid: source.uuid }, effect: { type: 'CONTROL', controllerId: P2 },
      }),
    }]);

    expect(find(delta, 'continuousEffectPool[0]')).toMatchObject({ op: 'add' });
    expect(find(delta, 'battlefield[0].state.summoningSickness')).toMatchObject({ op: 'update', oldValue: false, value: true });
  });

  it('maps a removed World effect to removal of the world timestamp', () => {
    const source = cardInZone('world-source', P1, 'battlefield');
    source.state = { ...source.state, worldTimestamp: 4 };
    const room = createTestRoom();
    room.battlefield = [source];
    room.continuousEffectPool = [continuousEntry({
      id: 'world-effect', source: source.uuid, sourceRevision: 0, origin: 'resolved', requiredZone: null, timestamp: 3,
      scope: { cardUuid: source.uuid }, effect: { type: 'TYPE', addSuperTypes: ['World'] },
    })];

    const delta = run(room, [{ type: 'REMOVE_CONTINUOUS_EFFECT', id: 'world-effect' }]);

    expect(find(delta, 'continuousEffectPool[0]')).toMatchObject({ op: 'remove' });
    expect(find(delta, 'battlefield[0].state.worldTimestamp')).toMatchObject({ op: 'remove', oldValue: 4 });
  });

  it('maps source-based continuous effect removal, including dependent-only filtering', () => {
    const source = cardInZone('source', P1, 'battlefield');
    const battlefieldEntry = continuousEntry({ id: 'e-battlefield', source: source.uuid, requiredZone: 'battlefield', duration: 'WHILE_ON_BATTLEFIELD', effect: { type: 'TYPE', add: ['Creature'] } });
    const dependentEntry = continuousEntry({ id: 'e-dependent', source: source.uuid, requiredZone: null, origin: 'resolved', effect: { type: 'TYPE', add: ['Creature'] } });
    const room = createTestRoom();
    room.battlefield = [source];
    room.continuousEffectPool = [battlefieldEntry, dependentEntry];

    const allBySource = run(room, [{ type: 'REMOVE_CONTINUOUS_EFFECT', source: source.uuid }]);
    expect(allBySource.changes.filter(change => change.path.startsWith('continuousEffectPool[') && change.op === 'remove')).toHaveLength(2);

    const dependentOnly = run(room, [{ type: 'REMOVE_CONTINUOUS_EFFECT', source: source.uuid, dependentOnly: true }]);
    const removedPaths = dependentOnly.changes.filter(change => change.path.startsWith('continuousEffectPool[') && change.op === 'remove').map(change => change.path);
    expect(removedPaths).toEqual(['continuousEffectPool[0]']);
    expect(find(dependentOnly, 'continuousEffectPool[0]')?.oldValue).toMatchObject({ id: 'e-battlefield' });
  });

  it('clears end-of-turn pool entries when there are no replacement effects to rewrite', () => {
    const source = cardInZone('source', P1, 'battlefield');
    const room = createTestRoom();
    room.battlefield = [source];
    room.continuousEffectPool = [
      continuousEntry({ id: 'temporary', source: source.uuid, duration: 'END_OF_TURN', effect: { type: 'TYPE', add: ['Creature'] } }),
    ];

    const delta = run(room, [{ type: 'CLEAR_END_OF_TURN_EFFECTS' }]);

    expect(find(delta, 'continuousEffectPool[0]')).toMatchObject({ op: 'remove' });
    expect(find(delta, 'replacementEffects')).toBeUndefined();
  });

  it('maps cleanup of end-of-turn continuous and replacement effects', () => {
    const source = cardInZone('source', P1, 'battlefield');
    const room = createTestRoom();
    room.battlefield = [source];
    room.continuousEffectPool = [
      continuousEntry({ id: 'temporary', source: source.uuid, duration: 'END_OF_TURN', effect: { type: 'TYPE', add: ['Creature'] } }),
      continuousEntry({ id: 'permanent', source: source.uuid, duration: 'PERMANENT', effect: { type: 'TYPE', add: ['Creature'] } }),
    ];
    room.replacementEffects = [
      { id: 'temporary-rule', label: 'Temporary', operation: { type: 'prevent_damage', amount: 1 }, duration: 'end_of_turn' },
      { id: 'permanent-rule', label: 'Permanent', operation: { type: 'prevent_damage', amount: 1 }, duration: 'permanent' },
    ];

    const delta = run(room, [{ type: 'CLEAR_END_OF_TURN_EFFECTS' }]);

    expect(find(delta, 'continuousEffectPool[0]')).toMatchObject({ op: 'remove', oldValue: { id: 'temporary' } });
    expect((find(delta, 'replacementEffects')?.value as { id: string }[]).map(rule => rule.id)).toEqual(['permanent-rule']);
  });

  it('maps a move that creates the exile zone as a whole-zone addition', () => {
    const handCard = cardInZone('exiled', P1, 'hand');
    const room = createTestRoom();
    room.players[P1].hand = [handCard];
    delete (room.players[P1] as { exile?: CardInstance[] }).exile;

    const delta = run(room, [{ type: 'MOVE_CARD', cardUuid: handCard.uuid, playerId: P1, from: 'hand', to: 'exile' }]);

    expect(find(delta, `players.${P1}.hand[0]`)).toMatchObject({ op: 'remove' });
    expect(find(delta, `players.${P1}.exile`)).toMatchObject({ op: 'add' });
    expect((find(delta, `players.${P1}.exile`)?.value as CardInstance[]).map(card => card.uuid)).toEqual(['exiled']);
  });

  it('maps a move into an existing exile zone through the normal destination path', () => {
    const handCard = cardInZone('exiled', P1, 'hand');
    const room = createTestRoom();
    room.players[P1].hand = [handCard];
    room.players[P1].exile = [];

    const delta = run(room, [{ type: 'MOVE_CARD', cardUuid: handCard.uuid, playerId: P1, from: 'hand', to: 'exile' }]);

    expect(find(delta, `players.${P1}.exile[0]`)).toMatchObject({ op: 'add' });
  });

  it('maps a spell leaving the stack to the graveyard', () => {
    const source = cardInZone('spell-card', P1, 'stack');
    const room = createTestRoom();
    room.stack = [spell('spell-1', source)];

    const delta = run(room, [{ type: 'MOVE_CARD', cardUuid: source.uuid, playerId: P1, from: 'stack', to: 'graveyard' }]);

    expect(find(delta, 'stack[0]')).toMatchObject({ op: 'remove' });
    expect(find(delta, `players.${P1}.graveyard[0]`)).toMatchObject({ op: 'add' });
  });

  it('leaves unrelated stack source info untouched during a move', () => {
    const moved = cardInZone('moved', P1, 'hand');
    const stackSource = cardInZone('stack-source', P1, 'battlefield');
    const room = createTestRoom();
    room.players[P1].hand = [moved];
    room.battlefield = [stackSource];
    room.stack = [abilityObject('unrelated-stack', stackSource)];

    const delta = run(room, [{ type: 'MOVE_CARD', cardUuid: moved.uuid, playerId: P1, from: 'hand', to: 'graveyard' }]);

    expect(find(delta, 'stack[0].sourceInfo')).toBeUndefined();
    expect(find(delta, `players.${P1}.graveyard[0]`)).toMatchObject({ op: 'add' });
  });

  it('maps moving a source permanent to updated retained stack and delayed-trigger source info', () => {
    const source = cardInZone('source', P1, 'battlefield');
    const room = createTestRoom();
    room.battlefield = [source];
    room.stack = [abilityObject('trigger-1', source)];
    room.delayedTriggers = [delayedTrigger('delayed-1', source, room)];

    const delta = run(room, [{ type: 'MOVE_CARD', cardUuid: source.uuid, playerId: P1, from: 'battlefield', to: 'graveyard' }]);

    expect(find(delta, 'stack[0].sourceInfo')).toMatchObject({ op: 'update' });
    expect(find(delta, 'delayedTriggers')).toMatchObject({ op: 'update' });
  });

  it('maps stack removal for both spells and non-spell abilities', () => {
    const abilitySource = cardInZone('ability-source', P1, 'battlefield');
    const abilityRoom = createTestRoom();
    abilityRoom.battlefield = [abilitySource];
    abilityRoom.stack = [abilityObject('ability-1', abilitySource), abilityObject('ability-2', abilitySource)];
    const removedAbility = run(abilityRoom, [{ type: 'REMOVE_STACK', stackUuid: 'ability-1' }]);
    expect(removedAbility.changes).toContainEqual({ path: 'stack[0]', op: 'remove', oldValue: abilityObject('ability-1', abilitySource) });

    const spellSource = cardInZone('spell-source', P1, 'stack');
    const spellRoom = createTestRoom();
    spellRoom.stack = [spell('spell-1', spellSource)];
    const counteredSpell = run(spellRoom, [{ type: 'COUNTER_STACK', stackUuid: 'spell-1' }]);
    expect(counteredSpell.changes).toContainEqual({ path: 'stack[0]', op: 'remove', oldValue: spell('spell-1', spellSource) });
    expect(find(counteredSpell, `players.${P1}.graveyard[0]`)).toMatchObject({ op: 'add' });
  });

  it('maps stack push, pop, countered and fizzled paths', () => {
    const source = cardInZone('source', P1, 'battlefield');
    const pushRoom = createTestRoom();
    pushRoom.battlefield = [source];
    const pushed = run(pushRoom, [{ type: 'PUSH_STACK', stackObject: abilityObject('ability-1', source) }]);
    expect(find(pushed, 'stack[0]')).toMatchObject({ op: 'add' });

    const popRoom = createTestRoom();
    popRoom.battlefield = [source];
    popRoom.stack = [abilityObject('ability-1', source)];
    const popped = run(popRoom, [{ type: 'POP_STACK' }]);
    expect(find(popped, 'stack[0]')).toMatchObject({ op: 'remove' });

    const counteredRoom = createTestRoom();
    counteredRoom.battlefield = [source];
    counteredRoom.stack = [abilityObject('ability-1', source)];
    const countered = run(counteredRoom, [{ type: 'SET_COUNTERED', stackUuid: 'ability-1' }]);
    expect(find(countered, 'stack[0].countered')).toMatchObject({ op: 'update', value: true });

    const fizzledRoom = createTestRoom();
    fizzledRoom.battlefield = [source];
    fizzledRoom.stack = [abilityObject('ability-1', source)];
    const fizzled = run(fizzledRoom, [{ type: 'SET_FIZZLED', stackUuid: 'ability-1' }]);
    expect(find(fizzled, 'stack[0].fizzled')).toMatchObject({ op: 'update', value: true });
  });

  it('maps completing a blocker declaration to combat and declaration fields', () => {
    const room = createTestRoom();
    room.combatDeclarations = { attackers: true, blockers: false };
    const delta = run(room, [{ type: 'COMPLETE_BLOCKER_DECLARATION' }]);
    expect(find(delta, 'combat')).toBeDefined();
    expect(find(delta, 'combatDeclarations')?.value).toEqual({ attackers: true, blockers: true });
  });

  it('maps phase changes and expires end-of-turn delayed triggers at cleanup', () => {
    const source = cardInZone('source', P1, 'battlefield');
    const room = createTestRoom();
    room.battlefield = [source];
    const expiring = { ...delayedTrigger('expiring', source, room), lifetime: 'end_of_turn' as const };
    const lasting = delayedTrigger('lasting', source, room);
    room.delayedTriggers = [expiring, lasting];

    const delta = run(room, [{ type: 'SET_PHASE', phase: 'cleanupStep' }]);

    expect(find(delta, 'phase')).toMatchObject({ op: 'update', value: 'cleanupStep' });
    expect((find(delta, 'delayedTriggers')?.value as { id: string }[]).map(trigger => trigger.id)).toEqual(['lasting']);
  });

  it('maps a phase change without delayed triggers', () => {
    const room = createTestRoom();
    const delta = run(room, [{ type: 'SET_PHASE', phase: 'upkeepStep' }]);
    expect(find(delta, 'phase')?.value).toBe('upkeepStep');
    expect(find(delta, 'delayedTriggers')).toBeUndefined();
  });

  it('maps status, engine state and pending choice mutations', () => {
    const room = createTestRoom();
    expect(find(run(room, [{ type: 'SET_STATUS', status: 'RPS' }]), 'status')?.value).toBe('RPS');
    expect(find(run(room, [{ type: 'SET_ENGINE_STATE', state: 'resolving_stack' }]), 'engineState')?.value).toBe('resolving_stack');
    expect(find(run(room, [{ type: 'SET_PENDING_CHOICE', choice: null }]), 'pendingChoice')).toMatchObject({ op: 'update', value: null });
  });

  it('maps card observation recording and closing', () => {
    const source = cardInZone('source', P1, 'battlefield');
    const room = createTestRoom();
    room.battlefield = [source];
    const recorded = run(room, [{ type: 'RECORD_CARD_OBSERVATION', observation: observation(room, source), sequence: 1 }]);
    expect(find(recorded, 'cardObservations')?.value).toMatchObject({ sequence: 1 });

    const obs = observation(room, source);
    const closeRoom = createTestRoom();
    closeRoom.battlefield = [source];
    closeRoom.cardObservations = { sequence: 1, active: { [obs.id]: obs }, history: [] };
    const closed = run(closeRoom, [{ type: 'CLOSE_CARD_OBSERVATIONS', ownerStackUuid: obs.ownerStackUuid }]);
    expect((find(closed, 'cardObservations')?.value as { active: Record<string, unknown> }).active).toEqual({});
  });

  it('maps pending triggers and trigger queue replacement', () => {
    const room = createTestRoom();
    expect(find(run(room, [{ type: 'SET_PENDING_TRIGGERS', mutations: [] }]), 'pendingTriggers')?.value).toEqual([]);
    expect(find(run(room, [{ type: 'SET_TRIGGER_QUEUE', queue: null }]), 'triggerQueue')).toMatchObject({ op: 'update', value: null });
  });

  it('maps delayed trigger add and remove', () => {
    const source = cardInZone('source', P1, 'battlefield');
    const room = createTestRoom();
    room.battlefield = [source];
    const trigger = delayedTrigger('delayed-1', source, room);
    const added = run(room, [{ type: 'ADD_DELAYED_TRIGGER', registration: trigger }]);
    expect((find(added, 'delayedTriggers')?.value as { id: string }[]).map(item => item.id)).toEqual(['delayed-1']);

    const removeRoom = createTestRoom();
    removeRoom.battlefield = [source];
    removeRoom.delayedTriggers = [trigger];
    const removed = run(removeRoom, [{ type: 'REMOVE_DELAYED_TRIGGER', id: 'delayed-1' }]);
    expect(find(removed, 'delayedTriggers')?.value).toEqual([]);
  });

  it('maps turn history, ability use, land play and game-rule use', () => {
    const room = createTestRoom();
    expect(find(run(room, [{ type: 'SET_TURN_HISTORY', history: history(3) }]), 'turnHistory')?.value).toMatchObject({ turnNumber: 3 });
    expect((find(run(room, [{ type: 'RECORD_ABILITY_USE', key: 'counter' }]), 'turnHistory')?.value as TurnHistory).uses.counter).toBe(1);
    expect((find(run(room, [{ type: 'RECORD_LAND_PLAY', playerId: P1 }]), 'turnHistory')?.value as TurnHistory).landPlays?.[P1]).toBe(1);
    expect(find(run(room, [{ type: 'RECORD_GAME_RULE_USE', key: 'legend' }]), 'gameRuleUses')?.value).toMatchObject({ legend: 1 });
  });

  it('maps turn changes with and without advancing the turn number', () => {
    const room = createTestRoom();
    const simple = run(room, [{ type: 'SET_TURN', playerId: P2 }]);
    expect(find(simple, 'activeTurnPlayerId')?.value).toBe(P2);
    expect(find(simple, 'turnNumber')).toBeUndefined();

    const advance = run(room, [{ type: 'SET_TURN', playerId: P2, advance: true }]);
    expect(find(advance, 'turnNumber')).toMatchObject({ op: 'update', value: 2 });
    expect(find(advance, 'turnHistory')).toBeDefined();
  });

  it('maps priority, last-passed and RPS mutations', () => {
    const room = createTestRoom();
    expect(find(run(room, [{ type: 'SET_PRIORITY', playerId: null }]), 'priorityPlayerId')).toMatchObject({ op: 'update', value: null });
    expect(find(run(room, [{ type: 'SET_LAST_PASSED', playerId: P2 }]), 'lastPassedPlayerId')?.value).toBe(P2);
    expect(find(run(room, [{ type: 'SET_RPS_STATUS', status: 'waiting' }]), 'rpsState.status')?.value).toBe('waiting');
    expect(find(run(room, [{ type: 'SET_RPS_PLAYED_CARD', playerId: P1, card: 'rock' }]), `rpsState.playedCards.${P1}`)?.value).toBe('rock');
  });
});

describe('SyncService coverage — delta metadata, filtering and notifications', () => {
  let service: SyncService;
  let tmpDir: string;
  let emitted: Array<{ room: string; event: string; data: unknown }>;

  const mockIo = () => ({
    to: (room: string) => ({
      emit: (event: string, data: unknown) => { emitted.push({ room, event, data }); },
    }),
  }) as any;

  beforeEach(() => {
    emitted = [];
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sync-coverage-'));
    service = new SyncService(mockIo(), path.join(tmpDir, 'deltas.jsonl'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('assigns sequence numbers, command metadata and effect timestamps to built deltas', () => {
    const room = createTestRoom();
    const command = { commandId: 'cmd-1', action: 'pass_priority', playerId: P1 };
    const batches = [
      { batchId: 'b1', cause: { kind: 'engine' }, events: [], before: room, after: room, mutations: [] },
      { batchId: 'b2', command, cause: { kind: 'command' }, events: [], before: room, after: room, mutations: [] },
    ] as unknown as AppliedEventBatch[];
    const source = cardInZone('source', P1, 'battlefield');
    const effectRoom = { ...createTestRoom(), roomId: room.roomId };
    effectRoom.battlefield = [source];

    const first = service.buildDelta(room, [{ type: 'SET_MANA', playerId: P1, color: 'red', amount: 1 }], { action: 'first', playerId: P1, batches });
    const second = service.buildDelta(effectRoom, [{
      type: 'ADD_CONTINUOUS_EFFECT',
      entry: continuousEntry({ id: 'e', source: source.uuid, sourceRevision: 0, origin: 'resolved', requiredZone: null, scope: { cardUuid: source.uuid }, effect: { type: 'TYPE', add: ['Creature'] } }),
    }], { action: 'second', playerId: P1 });

    expect(first.seq).toBe(1);
    expect(second.seq).toBe(2);
    expect(first.commandId).toBe('cmd-1');
    expect(first.batches?.map(batch => batch.batchId)).toEqual(['b1', 'b2']);
    expect(second.changes.some(change => change.path === 'effectSequence')).toBe(true);

    const noOp = service.buildDelta(room, [{ type: 'TAP_CARD', cardUuid: 'absent' }], { action: 'no-op', playerId: P1 });
    expect(noOp.changes).toEqual([]);
    expect(noOp.seq).toBe(3);
  });

  it('reads nested paths and stops at missing intermediates', () => {
    const room = createTestRoom();
    expect(getAtPath(room, '')).toBe(room);
    expect(getAtPath(room, 'players.player1.life')).toBe(room.players.player1.life);
    expect(getAtPath(room, 'players.ghost.life')).toBeUndefined();
  });

  it('finds card state paths in every player zone and reports an absent card', () => {
    const room = createTestRoom();
    const onBoard = cardInZone('path-board', P1, 'battlefield');
    const inGrave = cardInZone('path-grave', P2, 'graveyard');
    room.battlefield = [onBoard];
    room.players.player2.graveyard = [inGrave];

    expect(cardStatePath(room, onBoard.uuid, 'damageTaken')).toBe('battlefield[0].state.damageTaken');
    expect(cardStatePath(room, inGrave.uuid, 'isTapped')).toBe('players.player2.graveyard[0].state.isTapped');
    expect(cardStatePath(room, 'path-absent', 'isTapped')).toBe('');
  });

  it('stops path lookup at a missing intermediate object', () => {
    const room = createTestRoom();
    const delta = service.buildDelta(room, [{ type: 'CHANGE_LIFE', playerId: 'ghost' as PlayerId, amount: -1 }], { action: 'test', playerId: P1 });
    expect(delta.changes.every(change => change.path === 'players.ghost.life')).toBe(true);
  });

  it('creates synthetic snapshot deltas with their own sequence', () => {
    const room = createTestRoom();
    const changes: DeltaChange[] = [{ path: 'status', op: 'update', value: 'playing' }];

    const delta = service.snapshot(room, changes);

    expect(delta).toMatchObject({ roomId: room.roomId, seq: 1, action: 'snapshot', changes });
    expect(service.currentSeq(room.roomId)).toBe(1);
    expect(service.currentSeq('unknown-room')).toBe(0);
  });

  it('projects immediate resolution notifications with visible and hidden sources', () => {
    const room = createTestRoom();
    const visibleSource = cardInZone('visible-source', P1, 'battlefield');
    const hiddenSource = realCard('broken-fireball', P2, 'hand');
    room.battlefield = [visibleSource];
    room.players[P2].hand = [hiddenSource];

    const visibleStack = { ...abilityObject('visible-stack', visibleSource), immediate: true };
    const hiddenStack = { ...abilityObject('hidden-stack', hiddenSource), immediate: true };
    const batch = {
      batchId: 'batch', cause: { kind: 'engine' }, before: room, after: room, mutations: [],
      events: [
        { eventId: 'ACTION_RESOLVED', eventUuid: 'visible-event', batchId: 'batch', roomId: room.roomId, payload: { stackObj: visibleStack, effects: [] } },
        { eventId: 'ACTION_RESOLVED', eventUuid: 'hidden-event', batchId: 'batch', roomId: room.roomId, payload: { stackObj: hiddenStack, effects: [] } },
      ],
    } as unknown as AppliedEventBatch;

    const delta = service.buildDelta(room, [], { action: 'resolve', playerId: P1, batches: [batch] });
    const filtered = service.filterForPlayer(delta, P1, room);

    expect(filtered.notifications).toHaveLength(2);
    expect(filtered.notifications?.[0].summary).toContain('Resolved immediately:');
    expect(filtered.notifications?.[0].summary).toContain('visible-source');
    expect(filtered.notifications?.[1].summary).toBe('Resolved immediately: Hidden source');
  });

  it('projects card reveal notifications with visible and hidden sources', () => {
    const room = createTestRoom();
    const visibleSource = cardInZone('visible-source', P1, 'battlefield');
    const hiddenSource = realCard('broken-fireball', P2, 'hand');
    const revealed = realCard('red-wolf', P1, 'library');
    room.battlefield = [visibleSource];
    room.players[P2].hand = [hiddenSource];

    const batch = {
      batchId: 'batch', cause: { kind: 'engine' }, before: room, after: room, mutations: [],
      events: [
        { eventId: 'CARD_REVEALED', eventUuid: 'visible-reveal', batchId: 'batch', roomId: room.roomId,
          payload: { revealedCard: revealed, sourceInfo: captureSourceInformation(room, visibleSource) } },
        { eventId: 'CARD_REVEALED', eventUuid: 'hidden-reveal', batchId: 'batch', roomId: room.roomId,
          payload: { revealedCard: revealed, sourceInfo: captureSourceInformation(room, hiddenSource) } },
      ],
    } as unknown as AppliedEventBatch;

    const delta = service.buildDelta(room, [], { action: 'reveal', playerId: P1, batches: [batch] });
    const filtered = service.filterForPlayer(delta, P1, room);

    expect(filtered.notifications?.[0].summary).toContain('Revealed:');
    expect(filtered.notifications?.[0].summary).toContain('visible-source');
    expect(filtered.notifications?.[1].summary).toContain('Hidden source');
  });
});

describe('SyncService coverage — broadcast, logging, replay and sequences', () => {
  let service: SyncService;
  let tmpDir: string;
  let emitted: Array<{ room: string; event: string; data: unknown }>;

  const mockIo = () => ({
    to: (room: string) => ({
      emit: (event: string, data: unknown) => { emitted.push({ room, event, data }); },
    }),
  }) as any;

  const run = (room: GameRoom, mutations: GameMutation[], extra: { action?: string; playerId?: PlayerId; batches?: AppliedEventBatch[] } = {}) =>
    service.buildDelta(room, mutations, { action: extra.action ?? 'test', playerId: extra.playerId ?? P1, batches: extra.batches });

  beforeEach(() => {
    emitted = [];
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sync-coverage-'));
    service = new SyncService(mockIo(), path.join(tmpDir, 'deltas.jsonl'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('broadcasts to both resolved sockets and skips a missing second player', () => {
    const room = createTestRoom();
    const delta = run(room, [{ type: 'SET_MANA', playerId: P1, color: 'red', amount: 1 }]);
    service.broadcast(delta, room, pid => `socket:${pid}`);

    expect(emitted.map(entry => entry.room)).toEqual([`socket:${P1}`, `socket:${P2}`]);
    expect(emitted.map(entry => entry.event)).toEqual(['stateDelta', 'stateDelta']);

    emitted = [];
    const single = { ...createTestRoom(), player2Id: null } as GameRoom;
    service.broadcast(delta, single, pid => `socket:${pid}`);
    expect(emitted.map(entry => entry.room)).toEqual([`socket:${P1}`]);
  });

  it('logs published deltas and, when enabled, contextual event details', () => {
    const infoSpy = vi.spyOn(serverLogger, 'info');
    const debugSpy = vi.spyOn(GameLogger.prototype, 'debug');
    const contextSpy = vi.spyOn(serverLogger, 'withContext');
    const room = createTestRoom();
    const batches = [{
      batchId: 'logged-batch', cause: { kind: 'engine' }, events: [], before: room, after: room, mutations: [],
    }] as unknown as AppliedEventBatch[];
    const delta = run(room, [{ type: 'SET_MANA', playerId: P1, color: 'red', amount: 1 }], { batches });

    const original = gameConfig.logging.appliedEvents;
    gameConfig.logging.appliedEvents = true;
    try {
      service.broadcast(delta, room, pid => pid);
    } finally {
      gameConfig.logging.appliedEvents = original;
    }

    expect(infoSpy).toHaveBeenCalledWith('delta:published', 'State sent to players', expect.objectContaining({ roomId: room.roomId, seq: 1 }));
    expect(contextSpy).toHaveBeenCalled();
    expect(debugSpy).toHaveBeenCalledWith('delta:details', undefined, expect.objectContaining({ changes: delta.changes.length }));
  });

  it('suppresses the published log when action logging is disabled', () => {
    const infoSpy = vi.spyOn(serverLogger, 'info');
    const room = createTestRoom();
    const delta = run(room, [{ type: 'SET_MANA', playerId: P1, color: 'red', amount: 1 }]);

    const original = gameConfig.logging.actions;
    gameConfig.logging.actions = false;
    try {
      service.broadcast(delta, room, pid => pid);
    } finally {
      gameConfig.logging.actions = original;
    }

    expect(infoSpy).not.toHaveBeenCalledWith('delta:published', expect.anything(), expect.anything());
  });

  it('writes JSONL into a missing nested directory', () => {
    const logPath = path.join(tmpDir, 'nested', 'deeper', 'deltas.jsonl');
    const nested = new SyncService(mockIo(), logPath);
    const room = createTestRoom();
    const delta = nested.buildDelta(room, [{ type: 'SET_MANA', playerId: P1, color: 'red', amount: 1 }], { action: 'nested', playerId: P1 });

    nested.broadcast(delta, room, pid => pid);

    expect(fs.existsSync(logPath)).toBe(true);
    expect(fs.readFileSync(logPath, 'utf-8')).toContain('"action":"nested"');
  });

  it('replays filtered records, skips malformed lines and honours fromSeq', () => {
    const room = createTestRoom();
    const first = run(room, [{ type: 'SET_MANA', playerId: P1, color: 'red', amount: 1 }], { action: 'first' });
    const second = run(room, [{ type: 'SET_MANA', playerId: P1, color: 'blue', amount: 2 }], { action: 'second' });
    const otherRoom = { ...createTestRoom(), roomId: 'other-room' };
    const other = run(otherRoom, [{ type: 'SET_MANA', playerId: P1, color: 'green', amount: 3 }], { action: 'other' });
    service.broadcast(first, room, pid => pid);
    service.broadcast(second, room, pid => pid);
    service.appendToLog(other);
    fs.appendFileSync(path.join(tmpDir, 'deltas.jsonl'), 'not-json\n');

    expect(service.replay(room.roomId).map(delta => delta.action)).toEqual(['first', 'second']);
    expect(service.replay(room.roomId, second.seq).map(delta => delta.action)).toEqual(['second']);
    expect(service.replay(room.roomId, second.seq + 1)).toEqual([]);
  });

  it('returns empty replays without a log path or log file', () => {
    const memoryOnly = new SyncService(mockIo());
    expect(memoryOnly.replay('room')).toEqual([]);

    const missing = new SyncService(mockIo(), path.join(tmpDir, 'missing.jsonl'));
    expect(missing.replay('room')).toEqual([]);
  });

  it('skips appendToLog when no log path is configured', () => {
    const memoryOnly = new SyncService(mockIo());
    const room = createTestRoom();
    const delta = memoryOnly.buildDelta(room, [{ type: 'SET_MANA', playerId: P1, color: 'red', amount: 1 }], { action: 'memory', playerId: P1 });
    expect(() => memoryOnly.appendToLog(delta)).not.toThrow();
  });
});
