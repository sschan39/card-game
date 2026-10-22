import { MANA_COLORS } from '../types/card.types';
import type { EffectScope } from '../types/continuous-effect.types';

/** Query arguments use the same scope contract as continuous effects. */
export function validEffectScope(value: unknown): value is EffectScope {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const strings = (list: unknown): list is string[] => Array.isArray(list) && list.every(item => typeof item === 'string');
  const revision = (n: unknown) => typeof n === 'number' && Number.isSafeInteger(n) && n >= 0;
  return Object.entries(value).every(([key, item]) => {
    switch (key) {
      case 'self': case 'attachedToSource': return typeof item === 'boolean';
      case 'cardUuid': return typeof item === 'string' && !!item;
      case 'zoneRevision': return revision(item);
      case 'controller': return ['self', 'opponent', 'any'].includes(item as string);
      case 'zones': return strings(item) && item.every(zone => ['library', 'hand', 'battlefield', 'graveyard', 'exile', 'stack'].includes(zone));
      case 'colors': return strings(item) && item.every(color => MANA_COLORS.includes(color as typeof MANA_COLORS[number]));
      case 'cardTypes': case 'subTypes': return strings(item);
      case 'objects': return Array.isArray(item) && item.every(object => object && typeof object === 'object'
        && Object.keys(object).length === 2 && typeof object.cardUuid === 'string' && !!object.cardUuid && revision(object.zoneRevision));
      default: return false;
    }
  });
}
