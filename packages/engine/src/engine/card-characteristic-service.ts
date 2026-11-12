import { fixedManaValue } from '../shared/card-query';
import type { GameRoom } from '../types/game.room.types';
import type { CardInstance, CardBlueprint } from '../types/card.types';
import { resolveCharacteristics, resolveRoomCharacteristics, type AppliedCharacteristicObserver } from './characteristic-layers';

interface ResolutionScope {
  room: GameRoom;
  values: Map<CardInstance, Map<number, ReturnType<typeof resolveCharacteristics>>>;
  boards: Map<number, ReturnType<typeof resolveRoomCharacteristics>>;
  observe?: AppliedCharacteristicObserver;
}
let resolutionScope: ResolutionScope | undefined;

/** Synchronous read-only scopes never outlive the supplied room evaluation. */
export function withCharacteristicCache<T>(room: GameRoom, evaluate: () => T, observe?: AppliedCharacteristicObserver): T {
  const previous = resolutionScope;
  resolutionScope = { room, values: new Map(), boards: new Map(), observe };

  try {
    return evaluate();
  } finally {
    // Always restore, even if the evaluation throws.
    resolutionScope = previous;
  }
}

/** Resolve a card's characteristics, memoizing per room and layer when a scope is active. */
function resolve(room: GameRoom, card: CardInstance, throughLayer = 80) {
  // No active scope (or a different room): resolve directly, uncached.
  if (resolutionScope?.room !== room) return resolveCharacteristics(room, card, throughLayer);

  // The whole board for this layer is computed once and shared.
  let board = resolutionScope.boards.get(throughLayer);
  if (!board) {
    board = resolveRoomCharacteristics(room, throughLayer, throughLayer === 80 ? resolutionScope.observe : undefined);
    resolutionScope.boards.set(throughLayer, board);
  }

  const current = board.get(card);
  if (current) return current;

  // Fall back to a per-card cache keyed by layer.
  let values = resolutionScope.values.get(card);
  if (!values) {
    values = new Map();
    resolutionScope.values.set(card, values);
  }

  let value = values.get(throughLayer);
  if (!value) {
    value = resolveCharacteristics(room, card, throughLayer);
    values.set(throughLayer, value);
  }

  return value;
}

/** Shared read-only facade. Printed blueprints and card state remain unchanged. */
export const CardCharacteristicService = {
  resolveBlueprint: (room: GameRoom, card: CardInstance): CardBlueprint => ({ ...card.blueprint, ...resolve(room, card) }),
  resolveCopiableBlueprint: (room: GameRoom, card: CardInstance): CardBlueprint => ({ ...card.blueprint, ...resolve(room, card, 1) }),
  resolve,
  castManaSubstitution: (room: GameRoom, card: CardInstance, playerId: string) => {
    const substitution = resolve(room, card).manaSubstitution;
    return substitution?.playerId === playerId ? substitution : undefined;
  },
  resolveManaCost: (room: GameRoom, card: CardInstance) => structuredClone(resolve(room, card).castRequirements.cost?.mana ?? {}),
  resolveManaValue: (room: GameRoom, card: CardInstance) => fixedManaValue(resolve(room, card)),
  resolvePower: (room: GameRoom, card: CardInstance) => resolve(room, card).power,
  resolveToughness: (room: GameRoom, card: CardInstance) => resolve(room, card).toughness,
  resolveKeywords: (room: GameRoom, card: CardInstance) => resolve(room, card).keywords,
  resolveTypes: (room: GameRoom, card: CardInstance) => resolve(room, card).cardTypes,
  resolveSubTypes: (room: GameRoom, card: CardInstance) => resolve(room, card).subTypes,
  resolveColors: (room: GameRoom, card: CardInstance) => resolve(room, card).colors,
  resolveAbilities: (room: GameRoom, card: CardInstance) => resolve(room, card).abilities,
  resolveController: (room: GameRoom, card: CardInstance) => resolve(room, card).controllerId,
};
