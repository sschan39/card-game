import { MANA_COLORS, type CardInstance } from '../types/card.types';
import type { CardCharacteristics, EffectScope } from '../types/continuous-effect.types';

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

/** Broad characteristic scopes default to the battlefield; object/zone scopes are explicit. */
export function characteristicScope(scope: EffectScope): EffectScope {
  return !scope.zones && !scope.cardUuid && !scope.objects && !scope.self ? { ...scope, zones: ['battlefield'] } : scope;
}

export function scopeMatches(scope: EffectScope, card: CardInstance, value: CardCharacteristics,
  source: CardInstance | undefined, controller: string | undefined): boolean {
  if (scope.attachedToSource && (!source || source.state.zone !== 'battlefield' || card.state.zone !== 'battlefield'
    || source.state.attachedTo !== card.uuid || source.state.attachedToRevision !== (card.state.zoneRevision ?? 0))) return false;
  if (scope.self && (!source || card.uuid !== source.uuid || card.state.zone !== source.state.zone
    || (card.state.zoneRevision ?? 0) !== (source.state.zoneRevision ?? 0))) return false;
  if (scope.cardUuid && card.uuid !== scope.cardUuid) return false;
  if (scope.zoneRevision !== undefined && (card.state.zoneRevision ?? 0) !== scope.zoneRevision) return false;
  if (scope.objects && !scope.objects.some(o => o.cardUuid === card.uuid && o.zoneRevision === (card.state.zoneRevision ?? 0))) return false;
  if (scope.zones?.length && !scope.zones.includes(card.state.zone)) return false;
  if (scope.cardTypes?.length && !scope.cardTypes.some(t => value.cardTypes.includes(t))) return false;
  if (scope.subTypes?.length && !scope.subTypes.some(t => value.subTypes.includes(t))) return false;
  if (scope.colors?.length && !scope.colors.some(t => value.colors.includes(t))) return false;
  if (scope.controller === 'self' && value.controllerId !== controller) return false;
  if (scope.controller === 'opponent' && (!controller || value.controllerId === controller)) return false;
  return true;
}
