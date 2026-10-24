import type { CardInstance } from '../types/card.types';
import type { GameRoom } from '../types/game.room.types';
import { CardCharacteristicService } from '../engine/card-characteristic-service';

/** Shared by announcement validators and existing client/server option queries. */
export function actionPermission(room: GameRoom, playerId: string, card: CardInstance,
  action: 'cast' | 'activate', abilityId?: string): { allowed: boolean; instant: boolean } {
  const value = CardCharacteristicService.resolve(room, card);
  const rules = value.permissions.filter(rule => rule.action === action &&
    (rule.players !== 'self' || playerId === rule.sourceControllerId) &&
    (rule.players !== 'opponent' || (!!rule.sourceControllerId && playerId !== rule.sourceControllerId)) &&
    (!rule.abilityIds?.length || (abilityId !== undefined && rule.abilityIds.includes(abilityId))));
  return { allowed: !rules.some(rule => rule.mode === 'prohibit'), instant: rules.some(rule => rule.mode === 'instant') ||
    (action === 'cast' && value.keywords.some(keyword => keyword.toLowerCase() === 'flash')) };
}
