import { fixedManaValue } from '../shared/card-query';
import type { GameRoom } from '../types/game.room.types';
import type { CardInstance, CardBlueprint } from '../types/card.types';
import { resolveCharacteristics, resolveRoomCharacteristics, type AppliedCharacteristicObserver } from './characteristic-layers';

interface ResolutionScope {
  room: GameRoom;
  values: WeakMap<GameRoom, Map<CardInstance, Map<number, ReturnType<typeof resolveCharacteristics>>>>;
  boards: Map<number, ReturnType<typeof resolveRoomCharacteristics>>;
  /** Boards for rooms derived from `room` by a reducer step, keyed by room identity. */
  derived: WeakMap<GameRoom, Map<number, ReturnType<typeof resolveRoomCharacteristics>>>;
  observe?: AppliedCharacteristicObserver;
}
let resolutionScope: ResolutionScope | undefined;

/** Synchronous read-only scopes never outlive the supplied room evaluation. */
export function withCharacteristicCache<T>(room: GameRoom, evaluate: () => T, observe?: AppliedCharacteristicObserver): T {
  const previous = resolutionScope;
  if (previous?.room === room && !observe) return evaluate();

  resolutionScope = { room, values: new WeakMap(), boards: new Map(), derived: new WeakMap(), observe };

  try {
    return evaluate();
  } finally {
    // Always restore, even if the evaluation throws.
    resolutionScope = previous;
  }
}

/**
 * Read the cached board for a room.
 *
 * A reducer step derives a new room object from the scoped one. Those derived
 * rooms are cached separately, keyed by identity, so a preview or replay inside
 * a scope evaluates each intermediate board once instead of once per card.
 */
function boardFor(scope: ResolutionScope, room: GameRoom, throughLayer: number) {
  if (room === scope.room) return scope.boards.get(throughLayer);

  return scope.derived.get(room)?.get(throughLayer);
}

/** Store a board against the room it was computed for. */
function storeBoard(scope: ResolutionScope, room: GameRoom, throughLayer: number,
  board: ReturnType<typeof resolveRoomCharacteristics>): void {
  if (room === scope.room) {
    scope.boards.set(throughLayer, board);
    return;
  }

  let boards = scope.derived.get(room);
  if (!boards) {
    boards = new Map();
    scope.derived.set(room, boards);
  }

  boards.set(throughLayer, board);
}

/** Resolve a card's characteristics, memoizing per room and layer when a scope is active. */
function resolve(room: GameRoom, card: CardInstance, throughLayer = 80) {
  const scope = resolutionScope;

  // No active scope: resolve directly, uncached.
  if (!scope) return resolveCharacteristics(room, card, throughLayer);

  // The whole board for this layer is computed once and shared.
  let board = boardFor(scope, room, throughLayer);
  if (!board) {
    const observe = room === scope.room && throughLayer === 80 ? scope.observe : undefined;
    board = resolveRoomCharacteristics(room, throughLayer, observe);
    storeBoard(scope, room, throughLayer, board);
  }

  const current = board.get(card);
  if (current) return current;

  // The same retained card can resolve differently in two room snapshots.
  let roomValues = scope.values.get(room);
  if (!roomValues) {
    roomValues = new Map();
    scope.values.set(room, roomValues);
  }
  let values = roomValues.get(card);
  if (!values) {
    values = new Map();
    roomValues.set(card, values);
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
