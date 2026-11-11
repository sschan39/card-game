import { CardCharacteristicService } from './card-characteristic-service';
import { fixedManaValue, matchesCardFilter } from '../shared/card-query';
import type { GameRoom } from '../types/game.room.types';
import type { GameMutation } from '../types/game-mutation.types';
import type { MaterialPaymentCost } from '../types/effect.types';

type MaterialOption = { id: string; label: string; weight: number; value: { cardUuid: string; zoneRevision: number } };

/** Eligible controlled battlefield objects for the declared material operation. */
export function materialPaymentOptions(room: GameRoom, playerId: string, cost: MaterialPaymentCost): MaterialOption[] {
  return room.battlefield.flatMap(card => {
    const value = CardCharacteristicService.resolve(room, card);
    if (
      value.controllerId !== playerId ||
      (!('count' in cost) && value.keywords.some(keyword => keyword.toLowerCase() === 'indestructible')) ||
      !matchesCardFilter(card, value, cost.filter, playerId)
    ) return [];

    const manaValue = 'count' in cost ? 0 : fixedManaValue(value);
    if (manaValue === undefined) return [];

    return [{
      id: card.uuid,
      label: 'count' in cost ? value.name : `${value.name} (mana value ${manaValue})`,
      weight: manaValue,
      value: { cardUuid: card.uuid, zoneRevision: card.state.zoneRevision ?? 0 },
    }];
  });
}

/** Test the same material requirement for option previews and the picker. */
export function canAffordMaterials(room: GameRoom, playerId: string, cost: MaterialPaymentCost,
  options = materialPaymentOptions(room, playerId, cost)): boolean {
  return 'count' in cost
    ? options.length >= cost.count
    : options.reduce((total, option) => total + option.weight, 0) > cost.manaValueGreaterThan;
}

/** Validate exact incarnations and propose the declared operation once per distinct material. */
export function planMaterialPayment(room: GameRoom, playerId: string, cost: MaterialPaymentCost, selected: unknown):
  { success: true; mutations: GameMutation[] } | { success: false; reason: string } {
  const reject = (reason: string) => ({ success: false as const, reason });
  if (!Array.isArray(selected) || !selected.length || selected.length > room.battlefield.length) {
    return reject('Choose one or more ritual materials');
  }

  const available = new Map(materialPaymentOptions(room, playerId, cost).map(option => [option.id, option]));
  const mutations: GameMutation[] = [];
  let total = 0;
  for (const entry of selected) {
    const option = available.get(entry?.cardUuid);
    if (!option || option.value.zoneRevision !== entry.zoneRevision) return reject('Invalid ritual material');
    available.delete(option.id);
    total += option.weight;
    if ('count' in cost) {
      const card = room.battlefield.find(card => card.uuid === option.id)!;
      mutations.push({ type: 'MOVE_CARD', ...option.value, playerId: card.state.ownerId,
        from: 'battlefield', to: 'exile', requiredPayment: true });
    } else {
      mutations.push({ type: 'DESTROY_CARD', ...option.value, requiredPayment: true });
    }
  }

  if ('count' in cost) {
    if (selected.length !== cost.count) return reject(`Choose exactly ${cost.count} exile materials`);
  } else if (total <= cost.manaValueGreaterThan) {
    return reject(`Material mana value must be greater than ${cost.manaValueGreaterThan}`);
  }

  return { success: true, mutations };
}
