import { describe, expect, it } from 'vitest';
import { createTestRoom, fillTestLibraries } from '../helpers/test-room-factory';
import { instantiateCard } from '@library/card-factory';
import { buildPlayerView } from '@server/projection/view-builder';
import { projectViewDelta } from '@server/projection/delta-projector';
import { decodeChoiceAnswer } from '@server/projection/choice-view';
import { PROTOCOL_VERSION } from '@card-game/protocol/version';
import { gameReducer } from '@engine/game-reducer';
import { decodeAbilityId } from '@server/projection/wire-identifiers';
import { creature } from '../helpers/combat-fixture';

describe('player projection boundary', () => {
  it('keeps server-generated ability provenance opaque and decodes advertised actions', () => {
    let room = createTestRoom(); fillTestLibraries(room);
    const hidden = room.players.player2.deck[0], host = creature('host', 'player1'); room.battlefield = [host];
    room = gameReducer(room, { type: 'ADD_CONTINUOUS_EFFECT', entry: { id: 'effect:' + hidden.uuid, source: 'global', requiredZone: null, duration: 'PERMANENT', layer: 6,
      scope: { cardUuid: host.uuid }, effect: { type: 'ABILITY', add: [{ id: 'granted', type: 'activated', cost: {}, castSpeed: 'instant',
        effect: { action: 'DRAW', params: { amount: 1 }, targeting: { type: 'player', required: true } } }] } } });
    const view = buildPlayerView(room, 'player1'), option = view.battlefield[0].actions.find(option => option.actionId === 'activate_ability')!;
    expect(option.data?.abilityId).toMatch(/^ability:/);
    expect(JSON.stringify(view)).not.toContain(hidden.uuid);
    const decoded = decodeAbilityId(room, 'player1', { cardUuid: host.uuid, ...option.data });
    expect(decoded.abilityId).toContain(hidden.uuid);
    expect(view.battlefield[0].targetGroups['activate_ability:' + option.data?.abilityId]).toHaveLength(1);
  });

  it('hides an opponent RPS play until the round has resolved', () => {
    const room = createTestRoom(); room.rpsState = { status: 'pending', playedCards: { player2: 'rock' } };
    expect(buildPlayerView(room, 'player1').rpsState.playedCards).toEqual({});
    expect(buildPlayerView(room, 'player2').rpsState.playedCards).toEqual({ player2: 'rock' });
    room.rpsState.status = 'resolved'; expect(buildPlayerView(room, 'player1').rpsState.playedCards.player2).toBe('rock');
  });
  it('exposes only owned hands, public counts and display fields, never raw blueprints or decks', () => {
    const room = createTestRoom(); fillTestLibraries(room);
    const hidden = instantiateCard('choice-practice'); hidden.state.ownerId = 'player2'; hidden.state.controllerId = 'player2'; hidden.state.zone = 'hand';
    room.players.player2.hand = [hidden];
    const view = buildPlayerView(room, 'player1');
    const wire = JSON.stringify(view);
    expect(view.protocolVersion).toBe(PROTOCOL_VERSION);
    expect(view.players.player1.hand[0].uuid).toBe(room.players.player1.hand[0].uuid);
    expect(view.players.player1.hand[0].name).toBe(room.players.player1.hand[0].blueprint.name);
    expect(view.players.player2.hand).toEqual([]);
    expect(view.players.player2.handCount).toBe(1);
    expect(view.players.player1.deckCount).toBe(8);
    for (const card of [...room.players.player1.deck, ...room.players.player2.deck, hidden]) expect(wire).not.toContain(card.uuid);
    for (const key of ['blueprint', 'continuousEffectPool', 'replacementEffects', 'developmentDeck', 'pendingTriggers']) expect(wire).not.toContain('"' + key + '"');
    expect(view.players.player1).not.toHaveProperty('deck');
    expect(() => buildPlayerView(room, 'outsider')).toThrow();
  });

  it('does not retain object references to authoritative state', () => {
    const room = createTestRoom(); const original = room.players.player1.hand[0].state.isTapped;
    const view = buildPlayerView(room, 'player1'); view.players.player1.hand[0].state.isTapped = !original;
    expect(room.players.player1.hand[0].state.isTapped).toBe(original);
  });

  it('does not copy future nested fields, private attachment references or internal event payloads', () => {
    const room = createTestRoom(); fillTestLibraries(room);
    const secret = room.players.player2.deck[0].uuid, card = room.players.player1.hand[0];
    Object.assign(room, { futureSecret: secret }); Object.assign(card, { futureSecret: secret });
    Object.assign(card.state, { futureSecret: secret, attachedTo: secret, protectorId: secret });
    room.stack = [{ type: 'spell', uuid: 'public-spell', controllerId: 'player1', source: card, effects: [], countered: false }];
    Object.assign(room.stack[0], { triggeringEvent: { payload: { card: room.players.player2.deck[0] } }, futureSecret: secret });
    expect(JSON.stringify(buildPlayerView(room, 'player1'))).not.toContain(secret);
  });

  it('projects effective displays and server-checked target candidates without private zone references', () => {
    let room = createTestRoom(); fillTestLibraries(room);
    const source = room.players.player1.hand[0], own = creature('own', 'player1'), warded = creature('warded', 'player2', 2, 4, ['Hexproof']);
    source.blueprint = { ...source.blueprint, cardTypes: ['Instant'], onCastEffects: [{ action: 'DESTROY', params: {}, targeting: { type: 'permanent', required: true, cardTypes: ['Creature'] } }] };
    room.battlefield = [own, warded];
    room = gameReducer(room, { type: 'ADD_CONTINUOUS_EFFECT', entry: { source: 'global', requiredZone: null, duration: 'PERMANENT', layer: 7,
      scope: { cardUuid: own.uuid }, effect: { type: 'STAT_DELTA', power: 3 } } });
    const view = buildPlayerView(room, 'player1'), groups = view.players.player1.hand[0].targetGroups.cast_spell;
    expect(view.battlefield.find(card => card.uuid === own.uuid)?.power).toBe(5);
    expect(groups[0].legalTargets.some(target => target.cardUuid === own.uuid)).toBe(true);
    expect(groups[0].legalTargets.some(target => target.cardUuid === warded.uuid)).toBe(false);
    expect(groups[0].legalTargets.every(target => target.zoneRevision === 0)).toBe(true);
    for (const player of Object.values(room.players)) for (const card of player.deck) expect(JSON.stringify(groups)).not.toContain(card.uuid);
  });

  it('projects before and after states instead of forwarding hidden old values or raw paths', () => {
    const before = createTestRoom(); fillTestLibraries(before);
    const after = structuredClone(before); after.players.player2.hand.push(after.players.player2.deck.pop()!);
    const delta = projectViewDelta(before, after, 'player1', { seq: 1, timestamp: 1 });
    const wire = JSON.stringify(delta);
    for (const card of before.players.player2.deck) expect(wire).not.toContain(card.uuid);
    expect(delta.changes.some(change => change.path === 'players')).toBe(true);
    expect(delta.protocolVersion).toBe(PROTOCOL_VERSION);
  });

  it('reveals only the owner choice labels and opaque options, preserving answer decoding', () => {
    const room = createTestRoom(); fillTestLibraries(room);
    const card = room.players.player1.deck[0];
    room.pendingChoice = { id: 'search-choice', playerId: 'player1', kind: 'search', prompt: 'Choose a card', min: 0, max: 1,
      options: [{ id: card.uuid, label: card.uuid, value: { cardUuid: card.uuid, card } }],
      continuation: { type: 'action', actionId: 'cast_spell', field: 'discardUuids', data: { privateSecret: card.uuid } } };
    const own = buildPlayerView(room, 'player1').pendingChoice!;
    expect(own.kind).toBe('search'); if (own.kind === 'waiting' || own.kind === 'number') throw Error('Expected list choice');
    expect(own.options[0].id).not.toBe(card.uuid);
    expect(own.options[0].label).toBe(card.blueprint.name);
    expect(JSON.stringify(own)).not.toContain(card.uuid);
    expect(own).not.toHaveProperty('continuation'); expect(own.options[0]).not.toHaveProperty('value');
    expect(buildPlayerView(room, 'player2').pendingChoice).toEqual({ kind: 'waiting', playerId: 'player1' });
    expect(decodeChoiceAnswer(room, 'player1', { choiceId: own.id, choices: [own.options[0].id] }).choices).toEqual([card.uuid]);
    expect(() => decodeChoiceAnswer(room, 'player1', { choiceId: own.id, choices: [card.uuid] })).toThrow();
  });
});
