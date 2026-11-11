import { describe, expect, it } from 'vitest';
import { instantiateCard } from '@library/card-factory';
import type { CardBlueprint } from '@shared/card.types';
import type { GameRoom } from '@shared/game.room.types';
import { buildChoiceView, optionId } from '@server/projection/choice-view';
import { isPublicPermanent, visibleTargetCards } from '@server/projection/reveal-policy';
import { buildTargetGroups } from '@server/projection/target-groups';
import { createTestRoom } from '../helpers/test-room-factory';
import { creature } from '../helpers/combat-fixture';

function ownedHandCard(ownerId: string, uuid?: string) {
  const card = instantiateCard('empire-servant');
  card.state = { ...card.state, zone: 'hand', ownerId, controllerId: ownerId };
  return uuid ? { ...card, uuid } : card;
}

describe('choice projection edge cases', () => {
  it('projects a numeric choice without an upper bound and hides it from the other player', () => {
    const room = createTestRoom();
    room.pendingChoice = {
      id: 'numeric-choice',
      playerId: 'player1',
      kind: 'number',
      prompt: 'Choose any number',
      range: { min: 1 },
      continuation: { type: 'action', actionId: 'choose', data: {}, field: 'numericBindings' },
    };
    const view = buildChoiceView(room, 'player1');
    expect(view).toMatchObject({ kind: 'number', cancellable: true, range: { min: 1 } });
    expect(view).not.toHaveProperty('range.max');
    expect(buildChoiceView(room, 'player2')).toEqual({ kind: 'waiting', playerId: 'player1' });
  });

  it('keeps weighted distribution limits and the minimum weight on the wire', () => {
    const room = createTestRoom();
    room.pendingChoice = {
      id: 'weighted-choice',
      playerId: 'player1',
      kind: 'distribution',
      prompt: 'Distribute counters',
      min: 0,
      max: 2,
      total: 2,
      weightGreaterThan: 0,
      options: [{ id: 'first', label: 'first', value: null, weight: 2, limit: 2 }],
      continuation: { type: 'action', actionId: 'choose', data: {}, field: 'distributions' },
    };
    const view = buildChoiceView(room, 'player1');
    if (view?.kind !== 'distribution') throw new Error('Expected a distribution choice');
    expect(view).toMatchObject({ total: 2, weightGreaterThan: 0 });
    expect(view.options[0]).toMatchObject({ weight: 2, limit: 2 });
  });

  it('labels combat recipients by viewer and keeps a permanent target without a zone revision', () => {
    const room = createTestRoom();
    const permanent = creature('coverage-permanent', 'player2');
    permanent.state = { ...permanent.state, zoneRevision: undefined };
    room.battlefield = [permanent];
    room.pendingChoice = {
      id: 'combat-choice',
      playerId: 'player1',
      kind: 'distribution',
      prompt: 'Assign combat damage',
      min: 1,
      max: 2,
      total: 2,
      options: [
        { id: 'themselves', label: 'player', value: { kind: 'player', playerId: 'player1' } },
        { id: 'permanent', label: 'permanent', value: { kind: 'permanent', cardUuid: 'coverage-permanent', zoneRevision: 0 } },
      ],
      continuation: { type: 'combat', sourceUuid: 'coverage-permanent', passIndex: 0 },
    };
    const view = buildChoiceView(room, 'player1');
    if (view?.kind !== 'distribution') throw new Error('Expected a distribution choice');
    expect(view.options.map(option => option.label).sort()).toEqual(['You', 'coverage-permanent']);
    expect(view.sourceLabel).toBe('coverage-permanent');
  });

  it('names a publicly visible searched card and hides a private one behind an opaque option handle', () => {
    const room = createTestRoom();
    const hidden = ownedHandCard('player2'), revealed = ownedHandCard('player2');
    revealed.state = { ...revealed.state, visibility: 'public', visibilityZone: 'hand' };
    room.players.player2.hand = [hidden, revealed];
    room.pendingChoice = {
      id: 'search-choice',
      playerId: 'player1',
      kind: 'search',
      prompt: 'Choose a card',
      min: 0,
      max: 1,
      options: [
        { id: 'hidden', label: hidden.uuid, value: { cardUuid: hidden.uuid } },
        { id: 'revealed', label: revealed.uuid, value: { cardUuid: revealed.uuid } },
      ],
      continuation: { type: 'action', actionId: 'choose', data: {}, field: 'discardUuids' },
    };
    const view = buildChoiceView(room, 'player1');
    if (view?.kind !== 'search') throw new Error('Expected a search choice');
    const labelFor = (option: string) =>
      view.options.find(candidate => candidate.id === optionId(room, 'search-choice', 'player1', option))?.label;
    expect(labelFor('hidden')).toBe('Hidden card');
    expect(labelFor('revealed')).toBe(revealed.blueprint.name);
  });
});

describe('reveal policy public permanents', () => {
  it('reports only current battlefield incarnations as public permanents', () => {
    const room = createTestRoom();
    const onBoard = creature('public-permanent', 'player1'), inHand = ownedHandCard('player2');
    room.battlefield = [onBoard];
    room.players.player2.hand = [inHand];
    expect(isPublicPermanent(room, 'public-permanent')).toBe(true);
    expect(isPublicPermanent(room, inHand.uuid)).toBe(false);
    const visible = visibleTargetCards(room, 'player1').map(card => card.uuid);
    expect(visible).toContain('public-permanent');
    expect(visible).toContain(room.players.player1.hand[0].uuid);
    expect(visible).not.toContain(inHand.uuid);
  });
});

describe('target group projection sources', () => {
  const blueprint: CardBlueprint = {
    id: 'coverage-source',
    name: 'Coverage Source',
    cardTypes: ['Spell'],
    keywords: [],
    rulesText: '',
    castRequirements: { allowedZones: ['hand'], speed: 'instant', cost: {} },
    abilities: [],
  };
  function roomWith(source: CardBlueprint): { room: GameRoom; card: ReturnType<typeof ownedHandCard> } {
    const room = createTestRoom();
    const card = ownedHandCard('player1');
    card.blueprint = source;
    room.players.player1.hand = [card];
    return { room, card };
  }

  it('never reports casting targets for a spell that declares no cast effects', () => {
    const { room, card } = roomWith(blueprint);
    expect(buildTargetGroups(room, 'player1', card)).toEqual({ cast_spell: [] });
  });

  it('skips a resolution branch that would introduce new targets after announcement', () => {
    const { room, card } = roomWith({
      ...blueprint,
      onCastEffects: [
        {
          action: 'SET_DAMAGE',
          params: { amount: 1 },
          targeting: { type: 'self', required: false },
          choice: {
            kind: 'options',
            options: [
              {
                id: 'branch',
                label: 'Branch',
                effects: [
                  { action: 'TAP', params: {}, targeting: { type: 'permanent', required: true, maxTargets: 1 } },
                ],
              },
            ],
          },
        },
      ],
    });
    expect(buildTargetGroups(room, 'player1', card)).toEqual({});
  });
});
