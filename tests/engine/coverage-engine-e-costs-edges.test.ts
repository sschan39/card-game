import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import type { ActivatedAbility, CardBlueprint, CardInstance, CardState, CardZone } from '@shared/card.types';
import type { GameRoom } from '@shared/game.room.types';
import type { CounterRemovalCost } from '@shared/counter-cost.types';
import type { TurnHistory } from '@shared/trigger.types';
import { createTestRoom } from '../helpers/test-room-factory';
import { planManaActivation } from '@engine/action-costs';
import { counterPaymentOptions, planCounterCosts } from '@engine/counter-costs';
import { emptyEventCounts, newTurnHistory, recordRuleEvent } from '@engine/turn-history';
import { instructionParameterSchemas } from '../../packages/engine/src/rules/schema/instructions';

let uuid = 0;

const blueprintOf = (overrides: Partial<CardBlueprint> = {}): CardBlueprint => ({
  id: 'test-card',
  name: 'Test Card',
  cardTypes: ['Artifact'],
  subTypes: [],
  superTypes: [],
  keywords: [],
  castRequirements: { allowedZones: ['battlefield'], speed: 'instant' },
  rulesText: '',
  power: 1,
  toughness: 1,
  abilities: [],
  ...overrides,
});

function makeCard(
  options: {
    zone?: CardZone;
    controllerId?: string;
    blueprint?: Partial<CardBlueprint>;
    state?: Partial<CardState>;
  } = {},
): CardInstance {
  const zone = options.zone ?? 'battlefield';
  const controllerId = options.controllerId ?? 'player1';
  uuid += 1;
  return {
    uuid: `card-${uuid}`,
    blueprint: blueprintOf({ ...options.blueprint }),
    state: {
      zone,
      ownerId: controllerId,
      controllerId,
      isTapped: false,
      damageTaken: 0,
      counters: {},
      attackedThisTurn: false,
      summoningSickness: false,
      zoneRevision: 0,
      ...options.state,
    },
  };
}

const roomWith = (overrides: Partial<GameRoom> = {}): GameRoom => createTestRoom(overrides);

const fieldCost = (amount: number): CounterRemovalCost => ({ from: 'battlefield', counterType: 'charge', amount });

describe('counter payment bounds', () => {
  it('rejects a selection whose per-clause total leaves the safe integer range', () => {
    const a = makeCard({ state: { counters: { charge: Number.MAX_SAFE_INTEGER } } });
    const b = makeCard({ state: { counters: { charge: Number.MAX_SAFE_INTEGER } } });
    const room = roomWith({ battlefield: [a, b] });

    const plan = planCounterCosts(room, 'player1', a, [fieldCost(2)], {
      0: [
        { cardUuid: a.uuid, zoneRevision: 0, amount: Number.MAX_SAFE_INTEGER },
        { cardUuid: b.uuid, zoneRevision: 0, amount: Number.MAX_SAFE_INTEGER },
      ],
    });

    expect(plan).toEqual({ success: false, reason: 'Counter payment exceeds the safe range' });
  });

  it('shows full availability when no reservation was recorded for another clause', () => {
    const source = makeCard({ state: { counters: { charge: 2 } } });
    const room = roomWith({ battlefield: [source] });

    const options = counterPaymentOptions(room, 'player1', source, fieldCost(1), {
      costs: [fieldCost(1)],
      payments: undefined,
      index: 1,
    });

    expect(options).toEqual([
      { id: `${source.uuid}:0`, value: { cardUuid: source.uuid, zoneRevision: 0 }, limit: 2, label: 'Test Card — 2 charge counters' },
    ]);
  });

  it('offers a card without a recorded zone revision under revision zero', () => {
    const source = makeCard({ state: { counters: { charge: 1 }, zoneRevision: undefined } });
    const room = roomWith({ battlefield: [source] });

    const options = counterPaymentOptions(room, 'player1', source, fieldCost(1));

    expect(options).toEqual([
      { id: `${source.uuid}:0`, value: { cardUuid: source.uuid, zoneRevision: 0 }, limit: 1, label: 'Test Card — 1 charge counters' },
    ]);
  });
});

describe('mana activation identity', () => {
  it('records an activation for an unidentified mana ability under the empty ability id', () => {
    const ability = {
      id: undefined,
      type: 'activated',
      castSpeed: 'instant',
      cost: { tap: true },
      effect: {
        action: 'ADD_MANA',
        params: { color: 'red', amount: 1 },
        tags: [],
        targeting: { type: 'self', required: false },
      },
    } as unknown as ActivatedAbility;
    const source = makeCard({ blueprint: { abilities: [ability] } });
    const room = roomWith({ battlefield: [source] });

    const plan = planManaActivation(room, 'player1', { cardUuid: source.uuid });

    expect(plan.success).toBe(true);
    if (plan.success) {
      expect(plan.mutations.map((mutation) => mutation.type)).toContain('ADD_MANA');
      expect(plan.mutations.some((mutation) => mutation.type === 'RECORD_ABILITY_USE')).toBe(true);
    }
  });
});

describe('turn history fallbacks', () => {
  it('counts an event against a history that was stripped of its counters', () => {
    const stripped = { ...newTurnHistory(4), counts: {}, playerCounts: { player1: {} } } as TurnHistory;

    const recorded = recordRuleEvent(stripped, {
      eventId: 'CARD_DRAWN',
      payload: { playerId: 'player1' },
    });

    expect(recorded.counts.CARD_DRAWN).toBe(1);
    expect(recorded.playerCounts.player1.CARD_DRAWN).toBe(1);
    expect(recorded.events).toHaveLength(1);
    // Untouched tracked ids still start from zero.
    expect(emptyEventCounts().DAMAGE_TAKEN).toBe(0);
  });
});

describe('instruction parameter schemas', () => {
  it('builds the authored schemas with a default nested instruction schema', () => {
    const schemas = instructionParameterSchemas(z.unknown(), () => z.unknown());

    expect(schemas.GRANT_STATS.safeParse({ power: 1 }).success).toBe(true);
    const emptyStats = schemas.GRANT_STATS.safeParse({});
    expect(emptyStats.success).toBe(false);
    if (!emptyStats.success) expect(emptyStats.error.issues[0].message).toBe('Stat change requires a value');

    expect(schemas.MOVE_ZONE.safeParse({ destination: 'library', libraryPlacement: 'top' }).success).toBe(true);
    const misplaced = schemas.MOVE_ZONE.safeParse({ destination: 'graveyard', libraryPlacement: 'top' });
    expect(misplaced.success).toBe(false);
    if (!misplaced.success) expect(misplaced.error.issues[0].message).toContain('Library placement requires a library destination');

    expect(schemas.DRAW.safeParse({ amount: 2 }).success).toBe(true);
  });
});
