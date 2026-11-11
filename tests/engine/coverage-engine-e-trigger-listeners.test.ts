import { describe, expect, it } from 'vitest';
import { collectTriggerCandidates } from '@engine/trigger-listeners';
import type { TriggerEventDefinition } from '@engine/trigger-events';
import type { TriggerEventContext } from '@engine/trigger-event-context';
import type { GameEvent } from '@engine/event-bus';
import type { CardInstance, TriggeredAbility } from '@shared/card.types';
import { creature } from '../helpers/combat-fixture';

const drawEffect = { action: 'DRAW', params: { amount: 1 }, tags: [], targeting: { type: 'self' as const, required: false } };

const revealCard = (uuid: string, power?: number, controllerId = 'player1'): CardInstance => {
  const card = creature(uuid, controllerId);
  const ability: TriggeredAbility = {
    id: `${uuid}-trigger`,
    type: 'triggered',
    castSpeed: 'instant',
    triggerCondition: 'ON_REVEAL',
    effect: drawEffect,
  };
  card.blueprint = { ...card.blueprint, abilities: [ability], power, toughness: power };
  return card;
};

const subjectDefinition: TriggerEventDefinition = {
  triggerEvent: 'ON_REVEAL',
  watcherState: 'after',
  subject: 'observation',
  implicit: 'subject',
};

const revealEvent = (subject: CardInstance) =>
  ({ eventId: 'CARD_REVEALED', payload: { card: subject, revealedCard: subject } }) as unknown as GameEvent;

const revealContext = (subject: CardInstance): TriggerEventContext => ({
  event: revealEvent(subject) as unknown as TriggerEventContext['event'],
  snapshots: {},
});

describe('trigger listeners: implicit subject admission', () => {
  it('admits a revealed subject that is not on the battlefield and falls back to printed stats', () => {
    const subject = revealCard('revealed-subject', undefined);
    const boardCard = revealCard('board-watcher', 3);

    const candidates = collectTriggerCandidates(
      revealEvent(subject),
      subjectDefinition,
      revealContext(subject),
      { battlefield: [boardCard] },
    );

    const subjectCandidate = candidates.find((candidate) => candidate.source.uuid === 'revealed-subject');
    expect(subjectCandidate).toMatchObject({
      controllerId: 'player1',
      ability: expect.objectContaining({ triggerCondition: 'ON_REVEAL' }),
      sourceInfo: expect.objectContaining({ power: 0, toughness: 0 }),
    });
    expect(subjectCandidate?.sourceInfo?.card.state.zone).toBe('battlefield');
    expect(candidates).toHaveLength(1);
  });

  it('admits a revealed subject without a watcher room through the implicit subject arm', () => {
    const subject = revealCard('lone-subject', 2);

    const candidates = collectTriggerCandidates(
      revealEvent(subject),
      subjectDefinition,
      revealContext(subject),
      { battlefield: [] },
    );

    expect(candidates).toHaveLength(1);
    expect(candidates[0].source.uuid).toBe('lone-subject');
    expect(candidates[0].sourceInfo?.power).toBe(2);
  });

  it('admits an on-battlefield watcher through the implicit battlefield arm', () => {
    const boardCard = revealCard('board-source', 4);
    const definition: TriggerEventDefinition = { ...subjectDefinition, implicit: 'battlefield' };

    const candidates = collectTriggerCandidates(revealEvent(boardCard), definition, revealContext(boardCard), {
      battlefield: [boardCard],
    });

    expect(candidates.some((candidate) => candidate.source.uuid === 'board-source')).toBe(true);
  });
});

