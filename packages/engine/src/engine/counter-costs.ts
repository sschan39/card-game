import type { CardInstance } from '../types/card.types';
import type { CounterAllocation, CounterPayments, CounterRemovalCost } from '../types/counter-cost.types';
import type { GameRoom } from '../types/game.room.types';
import type { GameMutation } from '../types/game-mutation.types';
import type { ChoiceAnswer, ChoiceOption } from '../types/choice.types';
import { validCounterRemoval } from '../shared/counter-cost-validation';
import { matchesCardFilter } from '../shared/card-query';
import { attachedToCard, sameCardObject } from '../shared/card-identity';
import { CardCharacteristicService } from './card-characteristic-service';
import { PaymentFlow } from './payment-flow';

interface Resource {
  card: CardInstance;
  counterType: string;
  available: number;
}
type CounterPlan =
  | { success: true; mutations: GameMutation[]; payments: CounterPayments }
  | { success: false; reason: string };
const reject = (reason: string): CounterPlan => ({ success: false, reason });
const resourceKey = (card: CardInstance, type: string) =>
  JSON.stringify([card.uuid, card.state.zoneRevision ?? 0, type]);
const refKey = (ref: { cardUuid: string; zoneRevision: number }) => `${ref.cardUuid}:${ref.zoneRevision}`;
const own = (value: object, key: string) => Object.prototype.hasOwnProperty.call(value, key);

function fixedCounterCostCard(
  room: GameRoom,
  source: CardInstance,
  from: 'source' | 'attached_host',
): CardInstance | undefined {
  const liveSource = room.battlefield.find(card => sameCardObject(card, source));
  return from === 'source' ? liveSource : room.battlefield.find(card => attachedToCard(liveSource, card));
}

/** Current controlled incarnations satisfying one payment clause; payments are not targets. */
export function counterCostCards(
  room: GameRoom,
  playerId: string,
  source: CardInstance,
  cost: CounterRemovalCost,
): CardInstance[] {
  if (cost.from !== 'battlefield') {
    const card = fixedCounterCostCard(room, source, cost.from);
    return card && CardCharacteristicService.resolveController(room, card) === playerId ? [card] : [];
  }
  return room.battlefield.filter(card => {
    const value = CardCharacteristicService.resolve(room, card);
    return value.controllerId === playerId && matchesCardFilter(card, value, cost.filter ?? {}, playerId);
  });
}

function readPayments(input: unknown, costs: CounterRemovalCost[]): CounterPayments | undefined {
  if (input === undefined) return {};
  if (!input || typeof input !== 'object' || Array.isArray(input)) return;
  const result: CounterPayments = {};
  for (const [key, cards] of Object.entries(input)) {
    const index = Number(key);
    if (String(index) !== key || !Number.isInteger(index) || !costs[index]) return;
    if (!Array.isArray(cards) || cards.length === 0) return;
    const seen = new Set<string>();
    for (const card of cards) {
      if (!card || typeof card !== 'object' || Array.isArray(card)) return;
      if (Object.keys(card).some((field) => !['cardUuid', 'zoneRevision', 'amount'].includes(field))) return;
      if (typeof card.cardUuid !== 'string' || !card.cardUuid) return;
      if (!Number.isSafeInteger(card.zoneRevision) || card.zoneRevision < 0) return;
      if (!Number.isSafeInteger(card.amount) || card.amount <= 0 || seen.has(refKey(card))) return;
      seen.add(refKey(card));
    }
    result[key] = cards;
  }
  return result;
}

/** Validate fixed selections and solve remaining clauses against one shared counter inventory. */
export function planCounterCosts(
  room: GameRoom,
  playerId: string,
  source: CardInstance,
  costs: CounterRemovalCost[] = [],
  input?: unknown,
  chooseMissing = false,
): CounterPlan {
  if (!Array.isArray(costs) || costs.length > 16 || !costs.every(validCounterRemoval)) {
    return reject('Invalid counter removal cost');
  }
  // Validate player selections before building the shared inventory.
  const payments = readPayments(input, costs);
  if (!payments) return reject('Invalid counter payment selections');
  const resources = new Map<string, Resource>();
  const candidates = costs.map((cost) => counterCostCards(room, playerId, source, cost));
  costs.forEach((cost, index) =>
    candidates[index].forEach((card) => {
      const key = resourceKey(card, cost.counterType);
      resources.set(key, {
        card,
        counterType: cost.counterType,
        available: card.state.counters[cost.counterType] ?? 0,
      });
    }),
  );
  if ([...resources.values()].some((resource) => !Number.isSafeInteger(resource.available) || resource.available < 0)) {
    return reject('Invalid counter inventory');
  }
  // Reserve explicit selections first; every remaining clause sees the same reduced inventory.
  const reserved = new Map<string, number>();
  for (const [key, entries] of Object.entries(payments)) {
    const cost = costs[Number(key)];
    let total = 0;
    for (const entry of entries) {
      const card = candidates[Number(key)].find(
        (candidate) =>
          refKey(entry) ===
          refKey({
            cardUuid: candidate.uuid,
            zoneRevision: candidate.state.zoneRevision ?? 0,
          }),
      );
      if (!card) return reject('Counter payment source is stale or ineligible');
      const resource = resourceKey(card, cost.counterType);
      reserved.set(resource, (reserved.get(resource) ?? 0) + entry.amount);
      total += entry.amount;
      if (!Number.isSafeInteger(total)) return reject('Counter payment exceeds the safe range');
    }
    if (total !== cost.amount) return reject('Pay the exact required number of counters');
  }
  for (const [key, amount] of reserved) {
    const resource = resources.get(key)!;
    if (amount > resource.available) return reject('Not enough counters to pay the complete cost');
    resource.available -= amount;
  }
  if (!chooseMissing && costs.some((cost, index) => cost.from === 'battlefield' && !own(payments, String(index)))) {
    return reject('Choose counter payment sources');
  }
  // Solve overlapping filters together so a broad clause cannot steal the only narrow match.
  const flow = new PaymentFlow();
  const start = flow.addNode(),
    end = flow.addNode();
  const nodes = new Map<string, number>();
  for (const [key, resource] of resources) {
    const node = flow.addNode();
    nodes.set(key, node);
    flow.connect(node, end, resource.available);
  }
  const edges: { index: number; card: CardInstance; edge: ReturnType<PaymentFlow['connect']> }[] = [];
  let total = 0;
  for (let index = 0; index < costs.length; index++) {
    if (own(payments, String(index))) continue;
    const cost = costs[index],
      node = flow.addNode();
    total += cost.amount;
    if (!Number.isSafeInteger(total)) return reject('Combined counter cost exceeds the safe range');
    flow.connect(start, node, cost.amount);
    for (const card of candidates[index]) {
      const key = resourceKey(card, cost.counterType);
      edges.push({ index, card, edge: flow.connect(node, nodes.get(key)!, cost.amount) });
    }
  }
  if (!flow.pay(start, end, total)) return reject('Not enough counters to pay the complete cost');
  for (const { index, card, edge } of edges) {
    const amount = edge.capacity - edge.remaining;
    if (!amount) continue;
    (payments[index] ??= []).push({ cardUuid: card.uuid, zoneRevision: card.state.zoneRevision ?? 0, amount });
  }
  // Coalesce the validated plan into exact, replacement-proof payment debits.
  const debits = new Map<string, { card: CardInstance; counterType: string; amount: number }>();
  for (const [index, entries] of Object.entries(payments))
    for (const entry of entries) {
      const cost = costs[Number(index)];
      const card = candidates[Number(index)].find((candidate) => candidate.uuid === entry.cardUuid)!;
      const key = resourceKey(card, cost.counterType);
      const previous = debits.get(key)?.amount ?? 0;
      debits.set(key, { card, counterType: cost.counterType, amount: previous + entry.amount });
    }
  const mutations: GameMutation[] = [...debits.values()].map(({ card, counterType, amount }) => ({
    type: 'REMOVE_COUNTER',
    cardUuid: card.uuid,
    counterType,
    amount,
    replacementProcessed: true,
  }));
  return { success: true, mutations, payments };
}

/** Public choice options retain exact incarnations and display available counter amounts. */
export function counterPaymentOptions(
  room: GameRoom,
  playerId: string,
  source: CardInstance,
  cost: CounterRemovalCost,
  reservations?: { costs: CounterRemovalCost[]; payments: unknown; index: number },
): ChoiceOption[] {
  return counterCostCards(room, playerId, source, cost).flatMap((card) => {
    let available = card.state.counters[cost.counterType] ?? 0;
    const selected = (reservations?.payments ?? {}) as CounterPayments;
    for (let index = 0; index < (reservations?.costs.length ?? 0); index++) {
      const other = reservations!.costs[index];
      if (index === reservations!.index || other.counterType !== cost.counterType) continue;
      if (other.from !== 'battlefield') {
        if (fixedCounterCostCard(room, source, other.from)?.uuid === card.uuid) available -= other.amount;
      } else {
        available -= (selected[index] ?? [])
          .filter((entry) => entry.cardUuid === card.uuid)
          .reduce((sum, entry) => sum + entry.amount, 0);
      }
    }
    if (available <= 0) return [];
    const reference = { cardUuid: card.uuid, zoneRevision: card.state.zoneRevision ?? 0 };
    return [
      {
        id: refKey(reference),
        value: reference,
        limit: available,
        label: `${CardCharacteristicService.resolve(room, card).name} — ${available} ${cost.counterType} counters`,
      },
    ];
  });
}

/** Convert a room-owned distribution answer into explicit payment references. */
export function counterPaymentAnswer(answer: ChoiceAnswer): CounterAllocation[] {
  return answer.values.map((value) => {
    const reference = value as { cardUuid: string; zoneRevision: number };
    return { ...reference, amount: answer.allocations?.[refKey(reference)] ?? 0 };
  });
}
