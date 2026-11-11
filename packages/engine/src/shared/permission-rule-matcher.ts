import type { CardCharacteristics, PermissionRule } from '../types/continuous-effect.types';

/** Whether a permission applies to this actor and source. */
export function permissionRuleMatches(rule: CardCharacteristics['permissions'][number], playerId: string,
  action: PermissionRule['action'], abilityId?: string, sourceCardTypes?: readonly string[]): boolean {
  return rule.action === action &&
    (rule.players !== 'self' || playerId === rule.sourceControllerId) &&
    (rule.players !== 'opponent' || (!!rule.sourceControllerId && playerId !== rule.sourceControllerId)) &&
    (!rule.abilityIds?.length || (abilityId !== undefined && rule.abilityIds.includes(abilityId))) &&
    (!rule.sourceCardTypes || rule.sourceCardTypes.some(type => sourceCardTypes?.includes(type)));
}
