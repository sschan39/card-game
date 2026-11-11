import { describe, expect, it } from 'vitest';
import { createTriggerEventContext } from '@engine/trigger-event-context';
import { gameReducer } from '@engine/game-reducer';
import { captureSourceInformation } from '@engine/source-information';
import type { GameEvent } from '@shared/game-event.types';
import type { GameMutation } from '@shared/game-mutation.types';
import { createTestRoom } from '../helpers/test-room-factory';
import { creature } from '../helpers/combat-fixture';

const event = (eventId: string, payload: Record<string, unknown>): GameEvent => ({
  eventId,
  roomId: 'room',
  payload,
  eventUuid: 'event-1',
  batchId: 'batch-1',
  commandId: 'command-1',
} as unknown as GameEvent);

/** A room pair around a battlefield-to-graveyard move of card `a`. */
function transition() {
  const before = createTestRoom();
  const moving = creature('a', 'player1', 2, 4);
  before.battlefield = [moving];
  const after = gameReducer(before, {
    type: 'MOVE_CARD',
    cardUuid: 'a',
    playerId: 'player1',
    from: 'battlefield',
    to: 'graveyard',
    reason: 'destroy',
  } as GameMutation);
  return { before, after, moving, arrived: after.players.player1.graveyard[0] };
}

describe('createTriggerEventContext', () => {
  it('snapshots the departure through the room pair', () => {
    const { before, after, moving } = transition();
    const context = createTriggerEventContext(
      event('CARD_DISCARDED_FROM_HAND', { card: moving, playerId: 'player1', controllerId: 'player1' }),
      { before, after },
    );
    expect(context.snapshots.before?.card.state.zone).toBe('battlefield');
    expect(context.snapshots.after?.card.state.zone).toBe('graveyard');
    expect(context.event.subject).toEqual({
      before: {
        cardUuid: 'a',
        zone: 'battlefield',
        zoneRevision: 0,
        ownerId: 'player1',
        controllerId: 'player1',
      },
      after: {
        cardUuid: 'a',
        zone: 'graveyard',
        zoneRevision: 1,
        ownerId: 'player1',
        controllerId: 'player1',
      },
    });
    expect(context.event).toMatchObject({ eventId: 'CARD_DISCARDED_FROM_HAND', eventUuid: 'event-1', batchId: 'batch-1', commandId: 'command-1' });
  });

  it('snapshots an arrival from the preceding incarnation', () => {
    const { before, after, arrived } = transition();
    const context = createTriggerEventContext(
      event('PERMANENT_ENTERED', { card: arrived, controllerId: 'player1' }),
      { before, after },
    );
    expect(context.snapshots.before?.card.state.zone).toBe('battlefield');
    expect(context.snapshots.after?.card.state.zone).toBe('graveyard');
  });

  it('keeps a retained snapshot instead of recapturing the event card', () => {
    const { before, after, moving } = transition();
    const retained = captureSourceInformation(before, moving);
    const context = createTriggerEventContext(
      event('PERMANENT_LEFT', { card: moving, snapshot: retained, controllerId: 'player1' }),
      { before, after },
    );
    expect(context.snapshots.before).toEqual(retained);
  });

  it('falls back to printed characteristics without any room', () => {
    const { moving } = transition();
    const printed = createTriggerEventContext(
      event('CARD_DISCARDED_FROM_HAND', { card: moving, playerId: 'player1', controllerId: 'player1' }),
      {},
    );
    // Without any room the departure is described from printed characteristics.
    expect(printed.snapshots.before).toMatchObject({ power: 2, toughness: 4 });
    expect(printed.snapshots.after).toBeUndefined();
    expect(printed.watcherRoom).toBeUndefined();

    // An arrival is only described when the card is present in the after window.
    const arrival = createTriggerEventContext(event('PERMANENT_ENTERED', { card: moving, controllerId: 'player1' }), { room: createTestRoom() });
    expect(arrival.snapshots.before).toBeUndefined();
    expect(arrival.snapshots.after).toBeUndefined();

    const noRooms = createTriggerEventContext(event('PERMANENT_ENTERED', { card: moving, controllerId: 'player1' }), {});
    expect(noRooms.snapshots.after).toMatchObject({ power: 2, toughness: 4 });
  });

  it('prefers last known characteristics when no room is available', () => {
    const card = creature('printed', 'player1', 3, 5);
    delete (card.blueprint as { power?: number }).power;
    card.lastKnownCharacteristics = { power: 7, toughness: 9 } as never;
    const context = createTriggerEventContext(event('CARD_DRAWN', { card, playerId: 'player1', controllerId: 'player1' }), {});
    expect(context.snapshots.after).toMatchObject({ power: 7, toughness: 9 });

    // Neither last known nor printed values resolve to zero.
    const blank = creature('blank', 'player1');
    delete (blank.blueprint as { power?: number }).power;
    delete (blank.blueprint as { toughness?: number }).toughness;
    const zeroed = createTriggerEventContext(event('CARD_DRAWN', { card: blank, playerId: 'player1', controllerId: 'player1' }), {});
    expect(zeroed.snapshots.after).toMatchObject({ power: 0, toughness: 0 });
  });

  it('describes a revealed card from the retained snapshot or the room', () => {
    const room = createTestRoom();
    const card = creature('revealed', 'player1', 1, 1);
    room.players.player1.hand = [card];
    const retained = captureSourceInformation(room, card);
    expect(createTriggerEventContext(event('CARD_REVEALED', { revealedSnapshot: retained, revealedCard: card }), { room }).snapshots).toEqual({
      before: retained,
      after: retained,
    });
    expect(createTriggerEventContext(event('CARD_REVEALED', { revealedCard: card }), { room }).snapshots.before?.card.uuid).toBe('revealed');
    expect(createTriggerEventContext(event('CARD_REVEALED', {}), { room }).snapshots).toEqual({ before: undefined, after: undefined });
  });

  it('ignores events whose payload names no card', () => {
    const context = createTriggerEventContext(event('LIBRARY_SHUFFLED', { playerId: 'player1', controllerId: 'player1' }), { room: createTestRoom() });
    expect(context.snapshots).toEqual({ before: undefined, after: undefined });
    expect(context.event.subject).toEqual({ before: undefined, after: undefined });
  });

  it('treats a missing zone revision as the first incarnation', () => {
    const bare = () => {
      const room = createTestRoom();
      const card = creature('bare', 'player1', 2, 4);
      delete (card.state as { zoneRevision?: number }).zoneRevision;
      room.battlefield = [card];
      return { room, card };
    };
    const before = bare();
    const after = bare();
    const context = createTriggerEventContext(event('DAMAGE_TAKEN', { card: before.card, controllerId: 'player1', amount: 1 }), {
      before: before.room,
      after: after.room,
    });
    expect(context.event.subject?.before?.zoneRevision).toBe(0);
    expect(context.event.subject?.after?.zoneRevision).toBe(0);
    expect(context.snapshots.before?.card.uuid).toBe('bare');
    expect(context.snapshots.after?.card.uuid).toBe('bare');

    // An adjacent-incarnation search also treats a missing revision as zero.
    const arrival = createTriggerEventContext(event('PERMANENT_ENTERED', { card: before.card, controllerId: 'player1' }), {
      before: before.room,
      after: after.room,
    });
    expect(arrival.snapshots.before).toBeUndefined();
    const departure = createTriggerEventContext(event('CARD_DISCARDED_FROM_HAND', { card: before.card, playerId: 'player1' }), {
      before: before.room,
      after: after.room,
    });
    expect(departure.snapshots.after).toBeUndefined();
  });

  it('uses the current incarnation for events without a transition', () => {    const room = createTestRoom();
    const card = creature('seen', 'player1', 2, 4);
    room.battlefield = [card];
    const context = createTriggerEventContext(event('DAMAGE_TAKEN', { card, controllerId: 'player1', amount: 1 }), { room });
    expect(context.snapshots.before?.card.uuid).toBe('seen');
    expect(context.snapshots.after?.card.uuid).toBe('seen');
    // An unknown event has no declared window, so the after room is preferred.
    expect(createTriggerEventContext(event('UNKNOWN_EVENT', { card }), { room }).watcherRoom).toBe(room);
  });

  it('selects the watcher and condition rooms from the event window', () => {
    const { before, after, moving, arrived } = transition();
    const departure = createTriggerEventContext(event('PERMANENT_LEFT', { card: moving, controllerId: 'player1' }), { before, after, room: createTestRoom() });
    expect(departure.watcherRoom).toBe(before);
    expect(departure.conditionRoom).toBe(after);

    // Without a "before" window the current room stands in for the watcher.
    const room = createTestRoom();
    expect(createTriggerEventContext(event('PERMANENT_LEFT', { card: moving, controllerId: 'player1' }), { room }).watcherRoom).toBe(room);

    const arrival = createTriggerEventContext(event('PERMANENT_ENTERED', { card: arrived, controllerId: 'player1' }), { before, after });
    expect(arrival.watcherRoom).toBe(after);
    expect(arrival.conditionRoom).toBe(after);
  });
});
