import { describe, it, expect } from 'vitest';
import { gameReducer, reduceDamageBatch } from '@engine/game-reducer';
import { createTestRoom } from '../helpers/test-room-factory';
import { creature } from '../helpers/combat-fixture';
import { instantiateCard } from '@library/card-factory';
import { captureSourceInformation } from '@engine/source-information';
import { newTurnHistory } from '@engine/turn-history';
import type { GameRoom } from '@shared/game.room.types';
import type { CardInstance } from '@shared/card.types';
import type { GameMutation } from '@shared/game-mutation.types';
import type { StackObject, CombatDeclaration } from '@shared/effect.types';
import type { DamageAssignment } from '@shared/damage.types';
import type { CardObservation, ObservationState } from '@shared/card-observation.types';
import type { DelayedTrigger } from '@shared/trigger.types';

function zoneCard(uuid: string, playerId = 'player1', zone: 'hand' | 'graveyard' | 'library' | 'exile' = 'hand'): CardInstance {
  const card = creature(uuid, playerId);
  card.state = { ...card.state, zone };
  return card;
}

function tokenCard(uuid: string, playerId = 'player1', zone: 'hand' | 'graveyard' | 'library' | 'exile' | 'stack' = 'hand'): CardInstance {
  const token = { ...zoneCard(uuid, playerId, zone === 'stack' ? 'hand' : zone), isToken: true };

  return zone === 'stack' ? { ...token, state: { ...token.state, zone: 'stack' } } : token;
}

function stackObject(uuid: string, source: CardInstance, type: 'spell' | 'activated' = 'spell'): StackObject {
  return { uuid, type, controllerId: source.state.controllerId, source, effects: [], countered: false } as unknown as StackObject;
}

function combatDeclaration(uuid: string, attacker: CardInstance, blockers: CardInstance[] = []): CombatDeclaration {
  return { uuid, attacker, attackerPower: attacker.blueprint.power ?? 0, blockers };
}

function delayedTrigger(id: string, source: CardInstance, room: GameRoom, lifetime: DelayedTrigger['lifetime'] = 'end_of_turn'): DelayedTrigger {
  return {
    id,
    source,
    sourceInfo: captureSourceInformation(room, source),
    controllerId: source.state.controllerId,
    ability: {} as DelayedTrigger['ability'],
    lifetime,
  };
}

function observation(id: string, ownerStackUuid: string, card: CardInstance, room: GameRoom): CardObservation {
  return {
    id,
    ownerStackUuid,
    resultName: 'Look',
    controllerId: 'player1',
    zoneOwnerId: 'player1',
    sourceInfo: captureSourceInformation(room, card),
    emptyAudience: { faces: [], count: ['player1'], order: [] },
    members: [],
    turnNumber: 1,
  };
}

function observations(active: Record<string, CardObservation>): ObservationState {
  return { sequence: 0, active, history: [] };
}

function damageFrom(room: GameRoom, source: CardInstance, recipient: DamageAssignment['recipient'], amount = 2): DamageAssignment {
  return { source: captureSourceInformation(room, source), recipient, amount, combat: false };
}

describe('game-reducer coverage: card lookup and blockers', () => {
  it('keeps live battlefield blockers and ignores unknown blocker ids', () => {
    const attacker = creature('attacker', 'player2');
    const blocker = creature('blocker', 'player1');
    const room = createTestRoom({ battlefield: [attacker, blocker], combat: [combatDeclaration('combat-1', attacker)] });

    const next = gameReducer(room, { type: 'ASSIGN_BLOCKERS', attackerUuid: 'attacker', blockerUuids: ['blocker', 'ghost'] });

    expect(next.combat[0].blockers.map(card => card.uuid)).toEqual(['blocker']);
    expect(next.combat[0].blocked).toBe(true);
  });

  it('looks blockers up in the stack, hand, graveyard and deck, then reconciles them away', () => {
    const attacker = creature('attacker', 'player1');
    const stackBlocker = tokenCard('stack-blocker', 'player1', 'stack');
    const handBlocker = zoneCard('hand-blocker', 'player1');
    const graveBlocker = zoneCard('grave-blocker', 'player2', 'graveyard');
    const deckBlocker = zoneCard('deck-blocker', 'player2', 'library');
    const room = createTestRoom({
      battlefield: [attacker],
      stack: [stackObject('spell-1', stackBlocker)],
      combat: [combatDeclaration('combat-1', attacker)],
    });
    room.players.player1.hand.push(handBlocker);
    room.players.player2.graveyard.push(graveBlocker);
    room.players.player2.deck.push(deckBlocker);

    const next = gameReducer(room, {
      type: 'ASSIGN_BLOCKERS',
      attackerUuid: 'attacker',
      blockerUuids: ['stack-blocker', 'hand-blocker', 'grave-blocker', 'deck-blocker', 'missing-blocker'],
    });

    // Every candidate was found in a non-battlefield zone (or missing), so the
    // combat reconciliation removes the illegal blocker snapshots.
    expect(next.combat).toHaveLength(1);
    expect(next.combat[0].blockers).toEqual([]);
    expect(next.combat[0].blocked).toBe(true);
  });

  it('leaves the declaration untouched when the attacker uuid does not match', () => {
    const attacker = creature('attacker', 'player1');
    const other = creature('other', 'player1');
    const room = createTestRoom({ battlefield: [attacker, other], combat: [combatDeclaration('combat-1', attacker)] });

    const next = gameReducer(room, { type: 'ASSIGN_BLOCKERS', attackerUuid: 'other', blockerUuids: [] });

    expect(next).toBe(room);
  });
});

describe('game-reducer coverage: damage batch reduction', () => {
  it('does not create a new room when no proposed assignment is valid', () => {
    const room = createTestRoom();

    expect(reduceDamageBatch(room, [])).toBe(room);
    expect(reduceDamageBatch(room, [damageFrom(room, creature('source', 'player1'), { kind: 'player', playerId: 'ghost' })])).toBe(room);
  });

  it('plans damage results when none are supplied', () => {
    const source = creature('source', 'player1');
    const room = createTestRoom({ battlefield: [source] });

    const next = reduceDamageBatch(room, [damageFrom(room, source, { kind: 'player', playerId: 'player2' }, 3)]);

    expect(next.players.player2.life).toBe(17);
    expect(room.players.player2.life).toBe(20);
  });

  it('applies explicit results instead of planning them', () => {
    const source = creature('source', 'player1');
    const room = createTestRoom({ battlefield: [source] });
    const results: GameMutation[] = [{ type: 'CHANGE_LIFE', playerId: 'player2', amount: -7 }];

    const next = reduceDamageBatch(room, [damageFrom(room, source, { kind: 'player', playerId: 'player2' })], results);

    expect(next.players.player2.life).toBe(13);
    expect(next.players.player1.life).toBe(20);
  });
});

describe('game-reducer coverage: terminal states', () => {
  it('rejects mutations once the game is over or has an outcome', () => {
    const finished = createTestRoom({ status: 'gameOver' });
    const decided = createTestRoom({ outcome: { type: 'draw', losses: [] } });

    expect(gameReducer(finished, { type: 'SET_LIFE', playerId: 'player1', amount: 1 })).toBe(finished);
    expect(gameReducer(decided, { type: 'SET_LIFE', playerId: 'player1', amount: 1 })).toBe(decided);
  });

  it('closes every active observation when the game ends', () => {
    const source = creature('source', 'player1');
    const base = createTestRoom({ battlefield: [source] });
    const room: GameRoom = { ...base, cardObservations: observations({ look: observation('look', 'stack-1', source, base) }) };

    const next = gameReducer(room, { type: 'END_GAME', outcome: { type: 'win', winnerId: 'player1', losses: [] } });

    expect(next.status).toBe('gameOver');
    expect(next.engineState).toBe('game_over');
    expect(next.outcome).toEqual({ type: 'win', winnerId: 'player1', losses: [] });
    expect(next.stack).toEqual([]);
    expect(next.priorityPlayerId).toBeNull();
    expect(next.lastPassedPlayerId).toBeNull();
    expect(next.pendingChoice).toBeNull();
    expect(next.pendingTriggers).toEqual([]);
    expect(next.triggerQueue).toBeNull();
    expect(next.cardObservations?.active).toEqual({});
    expect(next.cardObservations?.sequence).toBe(0);
  });
});

describe('game-reducer coverage: characteristic recalculation', () => {
  it('grants summoning sickness when a continuous effect changes control', () => {
    const card = creature('steered', 'player1');
    const room = createTestRoom({ battlefield: [card] });

    const next = gameReducer(room, {
      type: 'ADD_CONTINUOUS_EFFECT',
      entry: { id: 'control', source: 'steered', duration: 'PERMANENT', layer: 2, scope: { cardUuid: 'steered' }, effect: { type: 'CONTROL', controllerId: 'player2' } },
    });

    expect(next.battlefield[0].state.summoningSickness).toBe(true);
    expect(room.battlefield[0].state.summoningSickness).toBe(false);

    const removed = gameReducer(next, { type: 'REMOVE_CONTINUOUS_EFFECT', id: 'control' });

    expect(removed.battlefield[0].state.summoningSickness).toBe(true);
  });

  it('stamps, keeps, clears and restamps the world timestamp as the World supertype changes', () => {
    const card = creature('world-card', 'player1');
    const room = createTestRoom({ battlefield: [card] });
    const grant = (id: string): GameMutation => ({
      type: 'ADD_CONTINUOUS_EFFECT',
      entry: {
        id,
        source: 'world-card',
        duration: 'PERMANENT',
        layer: 4,
        scope: { cardUuid: 'world-card' },
        effect: { type: 'TYPE', addSuperTypes: ['World'] },
      },
    });

    const gained = gameReducer(room, grant('world-1'));
    const stamped = gained.battlefield[0].state.worldTimestamp;

    expect(stamped).toBeTypeOf('number');
    expect(gained.effectTimestamp).toBe(stamped);
    expect(room.battlefield[0].state.worldTimestamp).toBeUndefined();

    const secondGrant = gameReducer(gained, grant('world-2'));

    expect(secondGrant.battlefield[0].state.worldTimestamp).toBe(stamped);

    const oneLeft = gameReducer(secondGrant, { type: 'REMOVE_CONTINUOUS_EFFECT', id: 'world-1' });

    expect(oneLeft.battlefield[0].state.worldTimestamp).toBe(stamped);

    const lost = gameReducer(oneLeft, { type: 'REMOVE_CONTINUOUS_EFFECT', id: 'world-2' });

    expect(lost.battlefield[0].state.worldTimestamp).toBeUndefined();
    expect(lost.effectTimestamp).toBeGreaterThanOrEqual(stamped!);

    const regained = gameReducer(lost, grant('world-3'));

    expect(regained.battlefield[0].state.worldTimestamp).toBeGreaterThan(stamped!);
  });

  it('closes observations for stack objects that depart', () => {
    const base = createTestRoom();
    const first = tokenCard('stack-one', 'player1', 'stack');
    const second = zoneCard('stack-two', 'player1');
    const room: GameRoom = {
      ...base,
      stack: [stackObject('stack-1', first), stackObject('stack-2', second)],
      cardObservations: observations({
        one: observation('one', 'stack-1', first, base),
        two: observation('two', 'stack-2', first, base),
      }),
    };

    const next = gameReducer(room, { type: 'POP_STACK' });

    expect(next.stack.map(object => object.uuid)).toEqual(['stack-1']);
    expect(Object.keys(next.cardObservations!.active)).toEqual(['one']);
  });

  it('tracks and clears causal attribution for damaged and departing permanents', () => {
    const source = creature('source', 'player1');
    const victim = creature('victim', 'player2', 2, 4);
    const room = createTestRoom({ battlefield: [source, victim] });

    const damaged = gameReducer(room, { type: 'MARK_DAMAGE', cardUuid: 'victim', zoneRevision: 0, amount: 2 });

    expect(damaged.battlefield[1].state.damageTaken).toBe(2);
    const record = damaged.causalState?.['victim:0'];

    expect(record).toBeDefined();
    expect(record!.history).toEqual([expect.objectContaining({ kind: 'damage', amount: 2 })]);
    expect(record!.contributors.map(cause => cause.id)).toContain('rule:MARK_DAMAGE');

    const moved = gameReducer(damaged, { type: 'MOVE_CARD', cardUuid: 'victim', playerId: 'player2', from: 'battlefield', to: 'graveyard' });

    expect(moved.causalState).toEqual({});
    expect(moved.players.player2.graveyard.map(card => card.uuid)).toEqual(['victim']);
  });
});

describe('game-reducer coverage: library, observation and replacement effects', () => {
  it('creates a token from a canonical token definition', () => {
    const room = createTestRoom();

    const next = gameReducer(room, { type: 'CREATE_TOKEN', tokenId: 'token-angel-1-1', cardUuid: 'token-1', playerId: 'player1', sequence: 1 });

    expect(next.tokenSequence).toBe(1);
    expect(next.battlefield).toHaveLength(1);
    expect(next.battlefield[0].uuid).toBe('token-1');
    expect(next.battlefield[0].isToken).toBe(true);
    expect(room.battlefield).toEqual([]);
  });

  it('records a monotonic observation and closes it on request', () => {
    const source = creature('source', 'player1');
    const room = createTestRoom({ battlefield: [source] });

    const recorded = gameReducer(room, {
      type: 'RECORD_CARD_OBSERVATION',
      observation: observation('look', 'stack-1', source, room),
      sequence: 1,
    });

    expect(recorded.cardObservations?.sequence).toBe(1);
    expect(recorded.cardObservations?.active.look.ownerStackUuid).toBe('stack-1');
    expect(recorded.cardObservations?.history).toHaveLength(1);

    const other: CardObservation = { ...observation('other', 'stack-2', source, room) };
    const withTwo: GameRoom = {
      ...recorded,
      cardObservations: { ...recorded.cardObservations!, active: { ...recorded.cardObservations!.active, other } },
    };
    const closed = gameReducer(withTwo, { type: 'CLOSE_CARD_OBSERVATIONS', ownerStackUuid: 'stack-1' });

    expect(Object.keys(closed.cardObservations!.active)).toEqual(['other']);
  });

  it('commits a prepared library shuffle and reorder', () => {
    const lower = zoneCard('lower', 'player1', 'library');
    const upper = zoneCard('upper', 'player1', 'library');
    const room = createTestRoom();
    room.players.player1.deck = [lower, upper];

    const shuffled = gameReducer(room, {
      type: 'SHUFFLE_LIBRARY',
      playerId: 'player1',
      order: [
        { cardUuid: 'upper', zoneRevision: 0 },
        { cardUuid: 'lower', zoneRevision: 0 },
      ],
    });

    expect(shuffled.players.player1.deck.map(card => card.uuid)).toEqual(['upper', 'lower']);

    const reordered = gameReducer(shuffled, {
      type: 'REORDER_LIBRARY',
      playerId: 'player1',
      order: [
        { cardUuid: 'lower', zoneRevision: 0 },
        { cardUuid: 'upper', zoneRevision: 0 },
      ],
    });

    expect(reordered.players.player1.deck.map(card => card.uuid)).toEqual(['lower', 'upper']);
  });

  it('registers replacement effects, avoiding duplicate and colliding ids', () => {
    const room = createTestRoom();

    const first = gameReducer(room, {
      type: 'ADD_REPLACEMENT_EFFECT',
      effect: { label: 'Shield', operation: { type: 'prevent_damage' }, duration: 'permanent' },
    });

    expect(first.replacementSequence).toBe(1);
    expect(first.replacementEffects).toHaveLength(1);
    expect(first.replacementEffects![0].id).toBe(`replacement:${room.roomId}:1`);
    expect(first.replacementEffects![0].expiresTurn).toBeUndefined();

    // An explicit id is registered only once.
    expect(gameReducer(first, {
      type: 'ADD_REPLACEMENT_EFFECT',
      effect: { id: first.replacementEffects![0].id, label: 'Again', operation: { type: 'prevent_damage' } },
    })).toBe(first);

    // A generated id collides with an existing rule and skips forward.
    const colliding: GameRoom = {
      ...room,
      replacementSequence: 1,
      replacementEffects: [{ id: `replacement:${room.roomId}:2`, label: 'Existing', operation: { type: 'prevent_damage' } }],
    };
    const skipped = gameReducer(colliding, {
      type: 'ADD_REPLACEMENT_EFFECT',
      effect: { label: 'New', operation: { type: 'prevent_damage' } },
    });

    expect(skipped.replacementSequence).toBe(3);
    expect(skipped.replacementEffects?.map(rule => rule.id)).toEqual([
      `replacement:${room.roomId}:2`,
      `replacement:${room.roomId}:3`,
    ]);
  });

  it('stamps end-of-turn replacement effects with the current turn unless one is supplied', () => {
    const bare = createTestRoom();
    const undecidedTurn = gameReducer(bare, {
      type: 'ADD_REPLACEMENT_EFFECT',
      effect: { label: 'Shield', operation: { type: 'prevent_damage' }, duration: 'end_of_turn' },
    });

    expect(undecidedTurn.replacementEffects![0].expiresTurn).toBe(1);

    const active = createTestRoom({ turnNumber: 5 });
    const stamped = gameReducer(active, {
      type: 'ADD_REPLACEMENT_EFFECT',
      effect: { label: 'Shield', operation: { type: 'prevent_damage' }, duration: 'end_of_turn' },
    });

    expect(stamped.replacementEffects![0].expiresTurn).toBe(5);

    const explicit = gameReducer(active, {
      type: 'ADD_REPLACEMENT_EFFECT',
      effect: { label: 'Shield', operation: { type: 'prevent_damage' }, duration: 'end_of_turn', expiresTurn: 9 },
    });

    expect(explicit.replacementEffects![0].expiresTurn).toBe(9);
  });

  it('removes replacement effects by id, tolerating an absent pool', () => {
    const room = createTestRoom();

    expect(gameReducer(room, { type: 'REMOVE_REPLACEMENT_EFFECT', id: 'missing' }).replacementEffects).toEqual([]);

    const populated: GameRoom = {
      ...room,
      replacementEffects: [
        { id: 'keep', label: 'Keep', operation: { type: 'prevent_damage' } },
        { id: 'drop', label: 'Drop', operation: { type: 'prevent_damage' } },
      ],
    };

    expect(gameReducer(populated, { type: 'REMOVE_REPLACEMENT_EFFECT', id: 'drop' }).replacementEffects?.map(rule => rule.id)).toEqual(['keep']);
  });

  it('sets replacement rule lists and combat damage state directly', () => {
    const room = createTestRoom();
    const effects = [{ id: 'rule', label: 'Rule', operation: { type: 'prevent_damage' as const } }];
    const withRules = gameReducer(room, { type: 'SET_REPLACEMENT_EFFECTS', effects });

    expect(withRules.replacementEffects).toBe(effects);

    const damageState = { passes: [], passIndex: 0, completed: false, requests: [], allocations: {} };
    const withDamage = gameReducer(withRules, { type: 'SET_COMBAT_DAMAGE', state: damageState });

    expect(withDamage.combatDamage).toBe(damageState);
    expect(gameReducer(withDamage, { type: 'SET_COMBAT_DAMAGE', state: null }).combatDamage).toBeNull();
  });
});

describe('game-reducer coverage: CEASE_CARD token zones', () => {
  it('ceases only the matching token spell on the stack', () => {
    const matching = tokenCard('cease-me', 'player1', 'stack');
    matching.state.zoneRevision = undefined as unknown as number;
    const otherRevision = tokenCard('cease-me', 'player1', 'stack');
    otherRevision.state.zoneRevision = 5;
    const notToken = zoneCard('cease-me', 'player1');
    notToken.state.zoneRevision = 0;
    const wrongUuidToken = tokenCard('different-token', 'player1', 'stack');
    const abilityToken = tokenCard('cease-me', 'player1', 'stack');

    const room = createTestRoom({
      stack: [
        stackObject('ability', abilityToken, 'activated'),
        stackObject('not-token', notToken),
        stackObject('wrong-uuid', wrongUuidToken),
        stackObject('stale-revision', otherRevision),
        stackObject('exactly-matching', matching),
      ],
    });

    const next = gameReducer(room, { type: 'CEASE_CARD', cardUuid: 'cease-me', zoneRevision: 0, playerId: 'player1', zone: 'stack' });

    expect(next.stack.map(object => object.uuid)).toEqual(['ability', 'not-token', 'wrong-uuid', 'stale-revision']);
  });

  it('ceases tokens held in hand, graveyard, deck and exile', () => {
    const handToken = tokenCard('hand-token', 'player1');
    handToken.state.zoneRevision = undefined as unknown as number;
    const graveyardToken = tokenCard('graveyard-token', 'player2', 'graveyard');
    const deckToken = tokenCard('deck-token', 'player1', 'library');
    const exileToken = tokenCard('exile-token', 'player2', 'exile');
    const hand = zoneCard('plain-hand', 'player1');
    const room = createTestRoom();
    room.players.player1.hand = [handToken, hand];
    room.players.player2.graveyard = [graveyardToken];
    room.players.player1.deck = [deckToken];
    room.players.player2.exile = [exileToken];

    const afterHand = gameReducer(room, { type: 'CEASE_CARD', cardUuid: 'hand-token', zoneRevision: 0, playerId: 'player1', zone: 'hand' });

    expect(afterHand.players.player1.hand.map(card => card.uuid)).toEqual(['plain-hand']);

    const afterGraveyard = gameReducer(afterHand, { type: 'CEASE_CARD', cardUuid: 'graveyard-token', zoneRevision: 0, playerId: 'player2', zone: 'graveyard' });

    expect(afterGraveyard.players.player2.graveyard).toEqual([]);

    const afterDeck = gameReducer(afterGraveyard, { type: 'CEASE_CARD', cardUuid: 'deck-token', zoneRevision: 0, playerId: 'player1', zone: 'library' });

    expect(afterDeck.players.player1.deck).toEqual([]);

    const afterExile = gameReducer(afterDeck, { type: 'CEASE_CARD', cardUuid: 'exile-token', zoneRevision: 0, playerId: 'player2', zone: 'exile' });

    expect(afterExile.players.player2.exile).toEqual([]);
  });

  it('rejects a cease that does not name an exact token incarnation', () => {
    const room = createTestRoom();
    room.players.player1.hand = [zoneCard('plain', 'player1')];

    // Battlefield is not a per-player zone.
    expect(gameReducer(room, { type: 'CEASE_CARD', cardUuid: 'plain', zoneRevision: 0, playerId: 'player1', zone: 'battlefield' })).toBe(room);
    // Unknown player.
    expect(gameReducer(room, { type: 'CEASE_CARD', cardUuid: 'plain', zoneRevision: 0, playerId: 'ghost', zone: 'hand' })).toBe(room);

    const token = tokenCard('tricky', 'player1');
    token.state.zoneRevision = 4;
    room.players.player1.hand = [token, tokenCard('other-token', 'player1')];

    // The uuid is missing, so the guarded lookup rejects the cease.
    expect(gameReducer(room, { type: 'CEASE_CARD', cardUuid: 'absent', zoneRevision: 4, playerId: 'player1', zone: 'hand' })).toBe(room);
    // Stale revision.
    expect(gameReducer(room, { type: 'CEASE_CARD', cardUuid: 'tricky', zoneRevision: 7, playerId: 'player1', zone: 'hand' })).toBe(room);
    // Non-token card in the zone.
    room.players.player1.hand = [zoneCard('not-a-token', 'player1')];
    expect(gameReducer(room, { type: 'CEASE_CARD', cardUuid: 'not-a-token', zoneRevision: 0, playerId: 'player1', zone: 'hand' })).toBe(room);
  });
});

describe('game-reducer coverage: attachments', () => {
  it('attaches a legal equipment to a creature host', () => {
    const gear = creature('gear', 'player1');
    gear.blueprint = { ...gear.blueprint, cardTypes: ['Artifact'], subTypes: ['Equipment'] };
    const host = creature('host', 'player1');
    const room = createTestRoom({ battlefield: [gear, host] });

    const next = gameReducer(room, { type: 'ATTACH_CARD', cardUuid: 'gear', zoneRevision: 0, hostUuid: 'host', hostRevision: 0, controllerId: 'player1' });

    expect(next.battlefield[0].state.attachedTo).toBe('host');
    expect(next.battlefield[0].state.attachedToRevision).toBe(0);
    expect(next.battlefield[0].state.attachedToPlayerId).toBeNull();
    expect(room.battlefield[0].state.attachedTo).toBeUndefined();

    const detached = gameReducer(next, { type: 'UNATTACH_CARD', cardUuid: 'gear' });

    expect(detached.battlefield[0].state.attachedTo).toBeNull();
    expect(detached.battlefield[0].state.attachedToRevision).toBeUndefined();
  });

  it('rejects an illegal attachment without touching the room', () => {
    const plain = creature('plain', 'player1');
    const host = creature('host', 'player1');
    const room = createTestRoom({ battlefield: [plain, host] });

    expect(gameReducer(room, { type: 'ATTACH_CARD', cardUuid: 'plain', zoneRevision: 0, hostUuid: 'host', hostRevision: 0, controllerId: 'player1' })).toBe(room);

    const gear = creature('gear', 'player1');
    gear.blueprint = { ...gear.blueprint, cardTypes: ['Artifact'], subTypes: ['Equipment'] };
    const selfRoom = createTestRoom({ battlefield: [gear] });

    expect(gameReducer(selfRoom, { type: 'ATTACH_CARD', cardUuid: 'gear', zoneRevision: 0, hostUuid: 'gear', hostRevision: 0, controllerId: 'player1' })).toBe(selfRoom);
  });

  it('sets a battle protector', () => {
    const card = creature('protector', 'player1');
    const room = createTestRoom({ battlefield: [card] });

    expect(gameReducer(room, { type: 'SET_BATTLE_PROTECTOR', cardUuid: 'protector', playerId: 'player2' }).battlefield[0].state.protectorId).toBe('player2');
  });
});

describe('game-reducer coverage: damage and life mutations', () => {
  it('applies a valid damage batch atomically', () => {
    const source = creature('source', 'player1');
    const victim = creature('victim', 'player2', 2, 5);
    const room = createTestRoom({ battlefield: [source, victim] });

    const next = gameReducer(room, {
      type: 'APPLY_DAMAGE_BATCH',
      assignments: [damageFrom(room, source, { kind: 'permanent', cardUuid: 'victim', zoneRevision: 0 }, 2)],
    });

    expect(next.battlefield[1].state.damageTaken).toBe(2);
    expect(room.battlefield[1].state.damageTaken).toBe(0);
  });

  it('rejects a damage batch without any valid assignment', () => {
    const source = creature('source', 'player1');
    const room = createTestRoom({ battlefield: [source] });

    expect(gameReducer(room, {
      type: 'APPLY_DAMAGE_BATCH',
      assignments: [damageFrom(room, source, { kind: 'permanent', cardUuid: 'absent', zoneRevision: 0 })],
    })).toBe(room);
  });

  it('changes and guards life totals', () => {
    const room = createTestRoom();

    expect(gameReducer(room, { type: 'CHANGE_LIFE', playerId: 'player2', amount: -3 }).players.player2.life).toBe(17);
    expect(gameReducer(room, { type: 'CHANGE_LIFE', playerId: 'ghost', amount: -3 })).toBe(room);
  });

  it('records failed draws and draws cards until the library is empty', () => {
    const room = createTestRoom();
    const drawn = zoneCard('drawn', 'player1', 'library');
    room.players.player1.hand = [];
    room.players.player1.deck = [drawn];

    expect(gameReducer(room, { type: 'SET_FAILED_DRAW', playerId: 'player1', value: true }).players.player1.failedDraw).toBe(true);
    expect(gameReducer(room, { type: 'SET_FAILED_DRAW', playerId: 'ghost', value: true })).toBe(room);

    const next = gameReducer(room, { type: 'DRAW_CARDS', playerId: 'player1', amount: 2 });

    expect(next.players.player1.hand.map(card => card.uuid)).toEqual(['drawn']);
    expect(next.players.player1.deck).toEqual([]);
    expect(next.players.player1.failedDraw).toBe(true);

    expect(gameReducer(room, { type: 'DRAW_CARDS', playerId: 'ghost', amount: 1 })).toBe(room);
  });

  it('marks damage only on the matching incarnation', () => {
    const victim = creature('victim', 'player2', 2, 5);
    const legacy = creature('legacy', 'player2', 2, 5);
    delete (legacy.state as { zoneRevision?: number }).zoneRevision;
    const room = createTestRoom({ battlefield: [victim, legacy] });

    expect(gameReducer(room, { type: 'MARK_DAMAGE', cardUuid: 'victim', zoneRevision: 0, amount: 3 }).battlefield[0].state.damageTaken).toBe(3);
    expect(gameReducer(room, { type: 'MARK_DAMAGE', cardUuid: 'legacy', zoneRevision: 0, amount: 1 }).battlefield[1].state.damageTaken).toBe(1);
    expect(gameReducer(room, { type: 'MARK_DAMAGE', cardUuid: 'victim', zoneRevision: 9, amount: 3 })).toBe(room);
  });

  it('sets deathtouch damage and clears damage during cleanup', () => {
    const flagged = creature('flagged', 'player2', 2, 5);
    flagged.state.deathtouchDamage = true;
    flagged.state.damageTaken = 2;
    const untouched = creature('plain', 'player1', 2, 5);
    const room = createTestRoom({ battlefield: [flagged, untouched] });

    const touched = gameReducer(room, { type: 'SET_DEATHTOUCH_DAMAGE', cardUuid: 'flagged', value: false });

    expect(touched.battlefield[0].state.deathtouchDamage).toBe(false);

    const cleared = gameReducer(touched, { type: 'CLEAR_DAMAGE' });

    expect(cleared.battlefield[0].state.damageTaken).toBe(0);
    expect(cleared.battlefield[0].state.deathtouchDamage).toBe(false);
    expect(cleared.battlefield[1].state.damageTaken).toBe(0);
    expect(cleared.battlefield[1].state.deathtouchDamage).toBeUndefined();
  });
});

describe('game-reducer coverage: destruction and regeneration', () => {
  it('destroys a permanent into its owner graveyard', () => {
    const victim = creature('victim', 'player2', 2, 4);
    delete (victim.state as { zoneRevision?: number }).zoneRevision;
    const room = createTestRoom({ battlefield: [victim] });

    const next = gameReducer(room, { type: 'DESTROY_CARD', cardUuid: 'victim', zoneRevision: 0 });

    expect(next.battlefield).toEqual([]);
    expect(next.players.player2.graveyard.map(card => card.uuid)).toEqual(['victim']);
  });

  it('does not destroy an indestructible permanent', () => {
    const victim = creature('victim', 'player2', 2, 4, ['Indestructible']);
    const room = createTestRoom({ battlefield: [victim] });

    expect(gameReducer(room, { type: 'DESTROY_CARD', cardUuid: 'victim', zoneRevision: 0 })).toBe(room);
  });

  it('ignores destruction of a stale or missing incarnation', () => {
    const victim = creature('victim', 'player2', 2, 4);
    const room = createTestRoom({ battlefield: [victim] });

    expect(gameReducer(room, { type: 'DESTROY_CARD', cardUuid: 'victim', zoneRevision: 3 })).toBe(room);
    expect(gameReducer(room, { type: 'SACRIFICE_CARD', cardUuid: 'absent', zoneRevision: 0 })).toBe(room);
  });

  it('sacrifices an indestructible permanent', () => {
    const victim = creature('victim', 'player1', 2, 4, ['Indestructible']);
    const room = createTestRoom({ battlefield: [victim] });

    const next = gameReducer(room, { type: 'SACRIFICE_CARD', cardUuid: 'victim', zoneRevision: 0 });

    expect(next.battlefield).toEqual([]);
    expect(next.players.player1.graveyard.map(card => card.uuid)).toEqual(['victim']);
  });

  it('regenerates a permanent and removes it from combat', () => {
    const regenerated = creature('regen', 'player1', 2, 4);
    regenerated.state.damageTaken = 3;
    regenerated.state.deathtouchDamage = true;
    const other = creature('other', 'player1', 2, 4);
    const room = createTestRoom({
      battlefield: [regenerated, other],
      combat: [
        { uuid: 'combat-1', attacker: regenerated, attackerPower: 2, blockers: [regenerated, other] },
        { uuid: 'combat-2', attacker: other, attackerPower: 2, blockers: [regenerated] },
      ],
    });

    const next = gameReducer(room, { type: 'REGENERATE_CARD', cardUuid: 'regen', zoneRevision: 0 });

    expect(next.battlefield[0].state.isTapped).toBe(true);
    expect(next.battlefield[0].state.damageTaken).toBe(0);
    expect(next.battlefield[0].state.deathtouchDamage).toBe(false);
    expect(next.combat.map(declaration => declaration.uuid)).toEqual(['combat-2']);
    expect(next.combat[0].blockers).toEqual([]);
  });

  it('does not regenerate a permanent that already left the battlefield', () => {
    const room = createTestRoom();

    expect(gameReducer(room, { type: 'REGENERATE_CARD', cardUuid: 'absent', zoneRevision: 0 })).toBe(room);
  });

  it('regenerates a legacy permanent whose incarnation has no revision', () => {
    const legacy = creature('legacy', 'player1');
    delete (legacy.state as { zoneRevision?: number }).zoneRevision;
    const room = createTestRoom({ battlefield: [legacy] });

    const next = gameReducer(room, { type: 'REGENERATE_CARD', cardUuid: 'legacy', zoneRevision: 0 });

    expect(next.battlefield[0].state.isTapped).toBe(true);
  });
});

describe('game-reducer coverage: counters and continuous effects', () => {
  it('does not add a capped counter that would not change the card', () => {
    const card = creature('capped', 'player1');
    const room = createTestRoom({ battlefield: [card] });

    expect(gameReducer(room, { type: 'ADD_COUNTER', cardUuid: 'capped', counterType: 'frost-gear', amount: 0 })).toBe(room);
  });

  it('removes counters from a type the card does not have', () => {
    const card = creature('bare', 'player1');
    const room = createTestRoom({ battlefield: [card] });

    const next = gameReducer(room, { type: 'REMOVE_COUNTER', cardUuid: 'bare', counterType: 'frost-gear', amount: 2 });

    expect(next.battlefield[0].state.counters['frost-gear']).toBe(0);
  });

  it('registers a continuous effect once per explicit id', () => {
    const room = createTestRoom();
    const entry = { id: 'effect-1', source: 'card', duration: 'PERMANENT' as const, layer: 7, scope: {}, effect: { type: 'STAT_DELTA' as const, power: 1 } };

    const next = gameReducer(room, { type: 'ADD_CONTINUOUS_EFFECT', entry });

    expect(next.continuousEffectPool).toHaveLength(1);
    expect(gameReducer(next, { type: 'ADD_CONTINUOUS_EFFECT', entry })).toBe(next);
  });

  it('removes continuous effects by id, source and dependent-only source', () => {
    const room = createTestRoom();
    room.continuousEffectPool = [
      { id: 'dependent', source: 'card-x', duration: 'PERMANENT', layer: 7, scope: {}, requiredZone: null, effect: { type: 'STAT_DELTA', power: 1 } },
      { id: 'battlefield', source: 'card-x', duration: 'PERMANENT', layer: 7, scope: {}, requiredZone: 'battlefield', effect: { type: 'STAT_DELTA', power: 1 } },
      { id: 'unrelated', source: 'card-y', duration: 'PERMANENT', layer: 7, scope: {}, effect: { type: 'STAT_DELTA', power: 1 } },
    ];

    const dependentOnly = gameReducer(room, { type: 'REMOVE_CONTINUOUS_EFFECT', source: 'card-x', dependentOnly: true });

    // Dependent-only removal keeps zone-independent grants and drops the
    // source's zone-bound entries.
    expect(dependentOnly.continuousEffectPool.map(entry => entry.id)).toEqual(['dependent', 'unrelated']);

    const bySource = gameReducer(dependentOnly, { type: 'REMOVE_CONTINUOUS_EFFECT', source: 'card-x' });

    expect(bySource.continuousEffectPool.map(entry => entry.id)).toEqual(['unrelated']);

    const byId = gameReducer(bySource, { type: 'REMOVE_CONTINUOUS_EFFECT', id: 'unrelated' });

    expect(byId.continuousEffectPool).toEqual([]);
  });

  it('clears end-of-turn effects from the pool and replacement list', () => {
    const room = createTestRoom();
    room.continuousEffectPool = [
      { source: 'card-a', duration: 'END_OF_TURN', layer: 7, scope: {}, effect: { type: 'STAT_DELTA', power: 1 } },
      { source: 'card-b', duration: 'PERMANENT', layer: 7, scope: {}, effect: { type: 'STAT_DELTA', power: 1 } },
    ];
    room.replacementEffects = [
      { id: 'eot', label: 'End of turn', operation: { type: 'prevent_damage' }, duration: 'end_of_turn' },
      { id: 'permanent', label: 'Permanent', operation: { type: 'prevent_damage' }, duration: 'permanent' },
    ];

    const next = gameReducer(room, { type: 'CLEAR_END_OF_TURN_EFFECTS' });

    expect(next.continuousEffectPool.map(entry => entry.source)).toEqual(['card-b']);
    expect(next.replacementEffects?.map(rule => rule.id)).toEqual(['permanent']);
  });

  it('keeps the replacement list absent when cleanup has nothing to clear', () => {
    const room = createTestRoom();

    expect(gameReducer(room, { type: 'CLEAR_END_OF_TURN_EFFECTS' }).replacementEffects).toBeUndefined();
  });
});

describe('game-reducer coverage: stack operations', () => {
  it('rejects an unknown zone move without touching the room', () => {
    const room = createTestRoom();

    expect(gameReducer(room, { type: 'MOVE_CARD', cardUuid: 'absent', playerId: 'player1', from: 'hand', to: 'battlefield' })).toBe(room);
  });

  it('removes only abilities from the stack', () => {
    const source = creature('source', 'player1');
    const room = createTestRoom({ battlefield: [source], stack: [stackObject('spell-1', source), stackObject('ability-1', source, 'activated')] });

    expect(gameReducer(room, { type: 'REMOVE_STACK', stackUuid: 'missing' })).toBe(room);
    expect(gameReducer(room, { type: 'REMOVE_STACK', stackUuid: 'spell-1' })).toBe(room);
    expect(gameReducer(room, { type: 'REMOVE_STACK', stackUuid: 'ability-1' }).stack.map(object => object.uuid)).toEqual(['spell-1']);
  });

  it('counters spells into the graveyard and abilities off the stack', () => {
    const spellCard = creature('spell-card', 'player1');
    spellCard.state.zone = 'stack';
    const abilitySource = creature('ability-source', 'player1');
    const abilityRoom = createTestRoom({ battlefield: [abilitySource], stack: [stackObject('ability-1', abilitySource, 'activated')] });

    expect(gameReducer(abilityRoom, { type: 'COUNTER_STACK', stackUuid: 'missing' })).toBe(abilityRoom);
    expect(gameReducer(abilityRoom, { type: 'COUNTER_STACK', stackUuid: 'ability-1' }).stack).toEqual([]);

    const spellRoom = createTestRoom({ stack: [stackObject('spell-1', spellCard)] });
    const countered = gameReducer(spellRoom, { type: 'COUNTER_STACK', stackUuid: 'spell-1' });

    expect(countered.stack).toEqual([]);
    expect(countered.players.player1.graveyard.map(card => card.uuid)).toEqual(['spell-card']);
    expect(countered.players.player1.graveyard[0].state.zone).toBe('graveyard');
  });

  it('marks unknown stack objects countered as a no-op', () => {
    const room = createTestRoom();

    expect(gameReducer(room, { type: 'SET_COUNTERED', stackUuid: 'missing' })).toBe(room);
  });

  it('marks a stack object fizzled', () => {
    const source = creature('source', 'player1');
    const room = createTestRoom({ stack: [stackObject('spell-1', source)] });

    expect(gameReducer(room, { type: 'SET_FIZZLED', stackUuid: 'missing' })).toBe(room);
    expect(gameReducer(room, { type: 'SET_FIZZLED', stackUuid: 'spell-1' }).stack[0].fizzled).toBe(true);
  });

  it('completes the blocker declaration step', () => {
    const room = createTestRoom();

    expect(gameReducer(room, { type: 'COMPLETE_BLOCKER_DECLARATION' }).combatDeclarations).toEqual({ attackers: true, blockers: true });

    const declared: GameRoom = { ...room, combatDeclarations: { attackers: false, blockers: false } };

    expect(gameReducer(declared, { type: 'COMPLETE_BLOCKER_DECLARATION' }).combatDeclarations).toEqual({ attackers: false, blockers: true });
  });
});

describe('game-reducer coverage: delayed triggers and turn history', () => {
  it('adds delayed triggers once per explicit id', () => {
    const source = creature('source', 'player1');
    const room = createTestRoom({ battlefield: [source] });

    const added = gameReducer(room, { type: 'ADD_DELAYED_TRIGGER', registration: delayedTrigger('trigger-1', source, room) });

    expect(added.delayedTriggers?.map(trigger => trigger.id)).toEqual(['trigger-1']);
    expect(gameReducer(added, { type: 'ADD_DELAYED_TRIGGER', registration: delayedTrigger('trigger-1', source, room) })).toBe(added);

    const unnamed = gameReducer(added, { type: 'ADD_DELAYED_TRIGGER', registration: delayedTrigger('', source, room) });

    expect(unnamed.delayedTriggers?.map(trigger => trigger.id)).toEqual(['trigger-1', '']);
  });

  it('removes delayed triggers by id, tolerating an absent list', () => {
    const source = creature('source', 'player1');
    const room = createTestRoom({ battlefield: [source] });

    expect(gameReducer(room, { type: 'REMOVE_DELAYED_TRIGGER', id: 'trigger-1' }).delayedTriggers).toEqual([]);

    const added = gameReducer(room, { type: 'ADD_DELAYED_TRIGGER', registration: delayedTrigger('trigger-1', source, room) });
    const withTwo = gameReducer(added, { type: 'ADD_DELAYED_TRIGGER', registration: delayedTrigger('trigger-2', source, room) });

    expect(gameReducer(withTwo, { type: 'REMOVE_DELAYED_TRIGGER', id: 'trigger-1' }).delayedTriggers?.map(trigger => trigger.id)).toEqual(['trigger-2']);
  });

  it('replaces turn history and records rule uses', () => {
    const room = createTestRoom();
    const history = newTurnHistory(4);

    expect(gameReducer(room, { type: 'SET_TURN_HISTORY', history }).turnHistory).toBe(history);

    const first = gameReducer(room, { type: 'RECORD_GAME_RULE_USE', key: 'extra-land' });

    expect(first.gameRuleUses).toEqual({ 'extra-land': 1 });

    const second = gameReducer(first, { type: 'RECORD_GAME_RULE_USE', key: 'extra-land' });

    expect(second.gameRuleUses).toEqual({ 'extra-land': 2 });
  });

  it('records land plays against the current turn and ignores stale turns', () => {
    const stale = createTestRoom({ turnNumber: 3 });

    expect(gameReducer(stale, { type: 'RECORD_LAND_PLAY', playerId: 'player1', turnNumber: 2 })).toBe(stale);

    const first = gameReducer(createTestRoom(), { type: 'RECORD_LAND_PLAY', playerId: 'player1' });

    expect(first.turnHistory?.turnNumber).toBe(1);
    expect(first.turnHistory?.landPlays).toEqual({ player1: 1 });

    const second = gameReducer(first, { type: 'RECORD_LAND_PLAY', playerId: 'player1', turnNumber: 1 });

    expect(second.turnHistory?.landPlays).toEqual({ player1: 2 });

    const active = gameReducer(createTestRoom({ turnNumber: 2 }), { type: 'RECORD_LAND_PLAY', playerId: 'player2', turnNumber: 2 });

    expect(active.turnHistory?.turnNumber).toBe(2);
    expect(active.turnHistory?.landPlays).toEqual({ player2: 1 });
  });

  it('records ability uses against the current turn and ignores stale turns', () => {
    const stale = createTestRoom({ turnNumber: 4 });

    expect(gameReducer(stale, { type: 'RECORD_ABILITY_USE', key: 'ping', turnNumber: 3 })).toBe(stale);

    const first = gameReducer(createTestRoom(), { type: 'RECORD_ABILITY_USE', key: 'ping', turnNumber: 1 });

    expect(first.turnHistory?.uses).toEqual({ ping: 1 });

    const second = gameReducer(first, { type: 'RECORD_ABILITY_USE', key: 'ping' });

    expect(second.turnHistory?.uses).toEqual({ ping: 2 });

    const active = gameReducer(createTestRoom({ turnNumber: 2 }), { type: 'RECORD_ABILITY_USE', key: 'ping', turnNumber: 2 });

    expect(active.turnHistory?.turnNumber).toBe(2);
  });
});

describe('game-reducer coverage: players, phases and turn taps', () => {
  it('replaces player zones for a known player only', () => {
    const room = createTestRoom();
    const deck = [zoneCard('deck-card', 'player1', 'library')];
    const hand = [zoneCard('hand-card', 'player1')];

    const next = gameReducer(room, { type: 'SET_PLAYER_ZONES', playerId: 'player1', deck, hand });

    expect(next.players.player1.deck).toBe(deck);
    expect(next.players.player1.hand).toBe(hand);
    expect(gameReducer(room, { type: 'SET_PLAYER_ZONES', playerId: 'ghost', deck, hand })).toBe(room);
  });

  it('accumulates mana for a color the pool does not yet track', () => {
    const room = createTestRoom();
    room.players.player1.mana = { red: 1 } as never;

    const next = gameReducer(room, { type: 'ADD_MANA', playerId: 'player1', color: 'blue', amount: 2 });

    expect(next.players.player1.mana.blue).toBe(2);
    expect(next.players.player1.mana.red).toBe(1);
  });

  it('records an attack flag', () => {
    const card = creature('attacker-flag', 'player1');
    const room = createTestRoom({ battlefield: [card] });

    expect(gameReducer(room, { type: 'SET_ATTACKED_THIS_TURN', cardUuid: 'attacker-flag', value: true }).battlefield[0].state.attackedThisTurn).toBe(true);
  });

  it('clears end-of-turn delayed triggers at cleanup while keeping longer lifetimes', () => {
    const source = creature('source', 'player1');
    const room = createTestRoom({
      battlefield: [source],
      delayedTriggers: [delayedTrigger('eot', source, createTestRoom(), 'end_of_turn'), delayedTrigger('permanent', source, createTestRoom(), 'permanent')],
    });

    const next = gameReducer(room, { type: 'SET_PHASE', phase: 'cleanupStep' });

    expect(next.phase).toBe('cleanupStep');
    expect(next.delayedTriggers?.map(trigger => trigger.id)).toEqual(['permanent']);

    const bare = gameReducer(createTestRoom(), { type: 'SET_PHASE', phase: 'cleanupStep' });

    expect(bare.delayedTriggers).toBeUndefined();
  });

  it('records pending choices, triggers and the trigger queue', () => {
    const room = createTestRoom();
    const choice = { id: 'choice-1', playerId: 'player1', options: [], total: 0, continuation: { type: 'priority' } };

    expect(gameReducer(room, { type: 'SET_PENDING_CHOICE', choice: choice as never }).pendingChoice).toBe(choice);
    expect(gameReducer(room, { type: 'SET_PENDING_CHOICE', choice: null }).pendingChoice).toBeNull();

    const pending: GameMutation[] = [{ type: 'SET_LIFE', playerId: 'player1', amount: 3 }];

    expect(gameReducer(room, { type: 'SET_PENDING_TRIGGERS', mutations: pending }).pendingTriggers).toBe(pending);

    const queue = { entries: [], resumePriority: 'player1' };

    expect(gameReducer(room, { type: 'SET_TRIGGER_QUEUE', queue }).triggerQueue).toBe(queue);
    expect(gameReducer(room, { type: 'SET_TRIGGER_QUEUE', queue: null }).triggerQueue).toBeNull();
  });

  it('sets engine state and advances the turn with fresh history', () => {
    const room = createTestRoom({ turnNumber: 2 });

    expect(gameReducer(room, { type: 'SET_ENGINE_STATE', state: 'resolving_stack' }).engineState).toBe('resolving_stack');

    const advanced = gameReducer(room, { type: 'SET_TURN', playerId: 'player2', advance: true });

    expect(advanced.activeTurnPlayerId).toBe('player2');
    expect(advanced.turnNumber).toBe(3);
    expect(advanced.turnHistory?.turnNumber).toBe(3);

    const bare = gameReducer(createTestRoom(), { type: 'SET_TURN', playerId: 'player2', advance: true });

    expect(bare.turnNumber).toBe(2);
    expect(bare.turnHistory?.turnNumber).toBe(2);
  });

  it('ignores unknown mutation types', () => {
    const room = createTestRoom();

    expect(gameReducer(room, { type: 'NOT_A_MUTATION' } as unknown as GameMutation)).toBe(room);
  });
});
