import { CARD_ZONES, type CardZone } from '../types/card.types';
import { validCardFilter } from './card-filter-validation';
import type { EffectScope } from '../types/continuous-effect.types';
import { validCardResultSource } from './card-collections';

/** Query arguments use the same scope contract as continuous effects. */
export function validEffectScope(value: unknown): value is EffectScope {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const strings = (list: unknown): list is string[] => Array.isArray(list) && list.every(item => typeof item === 'string');
  const revision = (n: unknown) => typeof n === 'number' && Number.isSafeInteger(n) && n >= 0;
  return Object.entries(value).every(([key, item]) => {
    switch (key) {
      case 'from': return validCardResultSource(item);
      case 'self': case 'attachedToSource': return typeof item === 'boolean';
      case 'storedUnderSource': return item === true;
      case 'cardUuid': return typeof item === 'string' && !!item;
      case 'zoneRevision': return revision(item);
      case 'zones': return strings(item) && item.every(zone => CARD_ZONES.includes(zone as CardZone));
      case 'objects': return Array.isArray(item) && item.every(object => object && typeof object === 'object'
        && Object.keys(object).length === 2 && typeof object.cardUuid === 'string' && !!object.cardUuid && revision(object.zoneRevision));
      default: return validCardFilter({ [key]: item });
    }
  });
}
