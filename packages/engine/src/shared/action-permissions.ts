import type { CardCharacteristics, PermissionRule } from '../types/continuous-effect.types';
import type { CardInstance } from '../types/card.types';
import type { GameRoom } from '../types/game.room.types';
import { CardCharacteristicService } from '../engine/card-characteristic-service';
import { permissionRuleMatches } from './permission-rule-matcher';

/** Shared by announcement validators and existing client/server option queries. */
export function actionPermission(room: GameRoom, playerId: string, card: CardInstance,
  action: PermissionRule['action'], abilityId?: string): { allowed: boolean; instant: boolean } {
  return effectiveActionPermission(CardCharacteristicService.resolve(room, card), playerId, action, abilityId);
}

/** Apply the same permission rules when characteristics have already been resolved. */
export function effectiveActionPermission(value: CardCharacteristics, playerId: string,
  action: PermissionRule['action'], abilityId?: string, sourceCardTypes?: readonly string[]): { allowed: boolean; instant: boolean } {
  const rules = value.permissions.filter(rule => permissionRuleMatches(rule, playerId, action, abilityId, sourceCardTypes));
  return { allowed: !rules.some(rule => rule.mode === 'prohibit'), instant: rules.some(rule => rule.mode === 'instant') ||
    (action === 'cast' && value.keywords.some(keyword => keyword.toLowerCase() === 'flash')) };
}

/** Check effect immunity independently of whether the instruction chooses targets. */
export function effectCanAffect(room: GameRoom, playerId: string, recipient: CardInstance, source?: CardInstance): boolean {
  const value = CardCharacteristicService.resolve(room, recipient);
  const sourceTypes = source && value.permissions.some(rule => rule.action === 'affect' && rule.sourceCardTypes)
    ? source.lastKnownCharacteristics?.cardTypes ?? CardCharacteristicService.resolve(room, source).cardTypes
    : undefined;
  return effectiveActionPermission(value, playerId, 'affect', undefined, sourceTypes).allowed;
}
