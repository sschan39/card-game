import type { CardInstance } from '../../types/card.types';
import type { CardFilter } from '../../types/card-query.types';
import type { CardCharacteristics } from '../../types/continuous-effect.types';
import type { GameRoom } from '../../types/game.room.types';
import type { GameMutation } from '../../types/game-mutation.types';
import { fixedManaValue, matchesCardFilter } from '../../shared/card-query';

/** The workbook's Scorch targets are creatures and non-equipment artifacts. */
export const scorchTargetFilter: CardFilter = {
  anyOf: [
    { cardTypes: ['Creature'] },
    { cardTypes: ['Artifact'], not: { subTypes: ['Equipment'] } },
  ],
};

/** Creatures use effective attack plus max life. Relics use effective mana value. */
export function planScorchDestruction(room: GameRoom, card: CardInstance, value: CardCharacteristics): GameMutation | undefined {
  const counters = card.state.counters.scorch ?? 0;
  if (!room.setup?.scorch || counters <= 0 || !matchesCardFilter(card, value, scorchTargetFilter)) return;
  if (value.keywords.some(keyword => keyword.toLowerCase() === 'indestructible')) return;

  const threshold = value.cardTypes.includes('Creature')
    ? value.power + value.toughness
    : fixedManaValue(value);
  if (threshold === undefined || counters < threshold) return;
  return { type: 'DESTROY_CARD', cardUuid: card.uuid, zoneRevision: card.state.zoneRevision ?? 0 };
}
