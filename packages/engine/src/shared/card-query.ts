import type { CardInstance, ManaColor } from '../types/card.types';
import type { CardFilter, CardZoneQuery, NumberBounds, RelativePlayer } from '../types/card-query.types';
import type { GameRoom } from '../types/game.room.types';
import { isHostedBy } from './card-identity';

export interface CardFilterView {
  name: string;
  cardTypes: readonly string[];
  subTypes?: readonly string[];
  colors?: readonly ManaColor[];
  controllerId: string;
  power?: number;
  toughness?: number;
  castRequirements: CardInstance['blueprint']['castRequirements'];
}

/** Whether a card's controller satisfies a `self`/`opponent`/`any` relation. */
export function relativePlayerMatches(
  actual: string,
  relation: RelativePlayer | undefined,
  playerId?: string,
): boolean {
  return (
    !relation || relation === 'any' || (!!playerId && (relation === 'self' ? actual === playerId : actual !== playerId))
  );
}
const inBounds = (value: number | undefined, bounds: NumberBounds | undefined) =>
  !bounds ||
  (typeof value === 'number' &&
    Number.isFinite(value) &&
    (bounds.min === undefined || value >= bounds.min) &&
    (bounds.max === undefined || value <= bounds.max));

/** Unannounced/dynamic costs have no fixed mana value in this query contract. */
export function fixedManaValue(value: CardFilterView): number | undefined {
  const amounts = Object.values(value.castRequirements.cost?.mana ?? {});
  return amounts.every((amount) => typeof amount === 'number' && Number.isFinite(amount))
    ? (amounts as number[]).reduce((total, amount) => total + amount, 0)
    : undefined;
}

/** Callers supply the effective characteristics appropriate to their evaluation layer. */
export function matchesCardFilter(
  card: CardInstance,
  value: CardFilterView,
  filter: CardFilter,
  playerId?: string,
): boolean {
  if (filter.ids?.length && !filter.ids.includes(card.blueprint.id)) return false;
  if (filter.cardTypes?.length && !filter.cardTypes.some((type) => value.cardTypes.includes(type))) return false;
  if (filter.subTypes?.length && !filter.subTypes.some((type) => value.subTypes?.includes(type))) return false;
  if (filter.colors?.length && !filter.colors.some((color) => value.colors?.includes(color))) return false;
  if ((filter.names?.length && !filter.names.includes(value.name)) || filter.excludedNames?.includes(value.name))
    return false;
  if (filter.nameContains !== undefined && !value.name.includes(filter.nameContains)) return false;
  if (
    !relativePlayerMatches(value.controllerId, filter.controller, playerId) ||
    !relativePlayerMatches(card.state.ownerId, filter.owner, playerId)
  )
    return false;
  if (
    !inBounds(value.power, filter.power) ||
    !inBounds(value.toughness, filter.toughness) ||
    !inBounds(filter.manaValue ? fixedManaValue(value) : undefined, filter.manaValue)
  )
    return false;
  if (filter.tapped !== undefined && card.state.isTapped !== filter.tapped) return false;
  if (filter.summonKind && card.state.summonKind !== filter.summonKind) return false;
  if (filter.counter && !inBounds(card.state.counters[filter.counter.type] ?? 0, filter.counter)) return false;
  if (filter.allOf && !filter.allOf.every((child) => matchesCardFilter(card, value, child, playerId))) return false;
  if (filter.anyOf && !filter.anyOf.some((child) => matchesCardFilter(card, value, child, playerId))) return false;
  if (filter.not && matchesCardFilter(card, value, filter.not, playerId)) return false;
  return true;
}

/** Server-state collection only: callers separately authorize and project hidden information. */
export function collectCards(
  room: GameRoom,
  query: CardZoneQuery = {},
  playerId?: string,
  controllerOf: (card: CardInstance) => string = (card) => card.state.controllerId,
): CardInstance[] {
  const includes = (zone: NonNullable<CardZoneQuery['zones']>[number]) => !query.zones || query.zones.includes(zone);
  const admitted = (id: string) => relativePlayerMatches(id, query.zonePlayer, playerId);
  const cards: CardInstance[] = [];
  if (!query.host && includes('battlefield')) cards.push(...room.battlefield.filter((card) => admitted(controllerOf(card))));
  if (!query.host && includes('stack'))
    cards.push(
      ...room.stack
        .filter((object) => object.type === 'spell' && admitted(object.controllerId))
        .map((object) => object.source),
    );
  for (const player of Object.values(room.players))
    if (admitted(player.id)) {
      if (!query.host) {
        if (includes('hand')) cards.push(...player.hand);
        if (includes('graveyard')) cards.push(...player.graveyard);
        if (includes('library')) cards.push(...player.deck);
        if (includes('exile')) cards.push(...(player.exile ?? []));
      }
      if (includes('hosted') && player.hosted) {
        const host = query.host;
        cards.push(...(host ? player.hosted.filter(card => isHostedBy(card, host)) : player.hosted));
      }
    }

  // Keep the first occurrence of each uuid. Battlefield and stack are collected
  // before the player zones, so a card caught mid-transition (present in both a
  // live zone and a stale one) resolves as the live object rather than the
  // leftover copy. Callers key characteristic maps by object identity, so the
  // surviving object has to be the one they will look up.
  const unique = new Map<string, CardInstance>();

  for (const card of cards) if (!unique.has(card.uuid)) unique.set(card.uuid, card);

  return [...unique.values()];
}
