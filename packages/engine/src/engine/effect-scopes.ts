import type { CardInstance } from '../types/card.types';
import type { CardCharacteristics, EffectScope } from '../types/continuous-effect.types';
import { matchesCardFilter } from '../shared/card-query';
import { attachedToCard } from '../shared/card-identity';
export { validEffectScope } from '../shared/effect-scope-validation';

/** Broad characteristic scopes default to the battlefield; object/zone scopes are explicit. */
export function characteristicScope(scope: EffectScope): EffectScope {
  // A scope that names no zone, card, object list, or self-reference is a broad
  // characteristic filter, which only ever applies on the battlefield.
  return !scope.zones && !scope.cardUuid && !scope.objects && !scope.self
    ? { ...scope, zones: ['battlefield'] }
    : scope;
}

/** True when a card falls inside an effect's scope. */
export function scopeMatches(scope: EffectScope, card: CardInstance, value: CardCharacteristics,
  source: CardInstance | undefined, controller: string | undefined): boolean {
  if (scope.attachedToSource && !attachedToCard(source, card)) return false;

  // Guard: "self" requires the same card object, not just the same UUID.
  if (
    scope.self &&
    (!source || card.uuid !== source.uuid || card.state.zone !== source.state.zone
      || (card.state.zoneRevision ?? 0) !== (source.state.zoneRevision ?? 0))
  ) {
    return false;
  }

  // Guard: explicit object identity filters.
  if (scope.cardUuid && card.uuid !== scope.cardUuid) return false;
  if (scope.zoneRevision !== undefined && (card.state.zoneRevision ?? 0) !== scope.zoneRevision) return false;
  if (
    scope.objects &&
    !scope.objects.some((o) => o.cardUuid === card.uuid && o.zoneRevision === (card.state.zoneRevision ?? 0))
  ) {
    return false;
  }

  // Guard: zone filter, then the shared characteristic/controller filters.
  if (scope.zones && !scope.zones.includes(card.state.zone)) return false;
  return matchesCardFilter(card, value, scope, controller);
}
