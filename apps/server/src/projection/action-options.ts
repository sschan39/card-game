import type { ActionOption } from '@card-game/protocol';
import { publicAbilityId } from './wire-identifiers';

/** Future engine option metadata is private unless explicitly added to the wire contract. */
export function projectActionOptions(options: readonly ActionOption[], roomId: string, viewerId: string): ActionOption[] {
  return options.map(option => ({
    actionId: option.actionId, label: option.actionId === 'activate_ability' ? option.label.split('@')[0] : option.label,
    ...(option.description !== undefined ? { description: option.description } : {}),
    ...(option.disabled !== undefined ? { disabled: option.disabled } : {}),
    ...(option.disabledReason !== undefined ? { disabledReason: option.disabledReason } : {}),
    ...(option.hidden !== undefined ? { hidden: option.hidden } : {}),
    ...(option.data ? { data: Object.fromEntries(Object.entries(option.data).filter(([key, value]) =>
      (key === 'abilityId' || key === 'manaColor') && typeof value === 'string' ||
      (key === 'abilityIndex' || key === 'zoneRevision') && typeof value === 'number' && Number.isSafeInteger(value)).map(([key, value]) =>
        [key, key === 'abilityId' ? publicAbilityId(roomId, viewerId, value as string) : value])) } : {}),
  }));
}
