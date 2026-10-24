import type { CardInstance } from '../types/card.types';
import type { CardCharacteristics, EffectScope } from '../types/continuous-effect.types';
export { validEffectScope } from '../shared/effect-scope-validation';

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
