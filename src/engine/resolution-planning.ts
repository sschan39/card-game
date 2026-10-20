import { CardCharacteristicService } from './card-characteristic-service';
import type { CardInstance, CardSnapshot } from '../types/card.types';
import type { GameRoom } from '../types/game.room.types';
import type { EffectDefinition, StackEffect, StackObject, TargetPointer } from '../types/effect.types';
import { structuralTargetLegal, isExplicitTargeting, findTargetCard } from '../shared/target-legality';
import { matchesTargetFilter } from '../shared/target-utils';
import { ModifierRegistry } from './modifier-registry';
import { resolveSourceInformation } from './source-information';
import { readRulePath } from './rule-conditions';
import { evaluateNumericValue, hasNumericExpression } from './numeric-values';
import { createBoardNumericContext } from './numeric-characteristics';
import { roomCards } from './continuous-effect-state';

/**
 * Convert card definition effects into StackEffects with auto-filled self-targets.
 * Used by both playCardHandler (onCastEffects) and TriggerManager (onEnterEffects).
 */
export function buildStackEffects(
  definitions: EffectDefinition[] | undefined,
  controllerId: string,
  source?: CardInstance
): StackEffect[] {
  if (!definitions) return [];
  return definitions.map(def => {
    const targets: TargetPointer[] = [];
    if (def.targeting.type === 'self') {
      targets.push(def.targeting.subject === 'source' && source
        ? { targetType: 'permanent', cardUuid: source.uuid, zoneRevision: source.state.zoneRevision ?? 0 }
        : { targetType: 'player', playerId: controllerId });
    } else if (def.targeting.all) {
      // "All matching permanents" — expanded into concrete cardUuid targets
      // at resolve time by expandTargets(). The filter fields are carried here.
      targets.push({
        targetType: def.targeting.type,
        all: true,
        cardTypes: def.targeting.cardTypes,
        subTypes: def.targeting.subTypes,
        controller: def.targeting.controller,
      });
    }
    // For effects requiring explicit targets, targets are filled by server-prompted targeting (future)
    return {
      targetGroup: def.targetGroup,
      recordOutcome: def.recordOutcome,
      requiresOutcome: def.requiresOutcome,
      choice: def.choice,
      action: def.action,
      params: def.params,
      tags: def.tags || [],
      targets,
      targeting: def.targeting,
    };
  });
}

/**
 * Resolve targets at resolve time. Handles two kinds of targets:
 *
 * 1. **Filter-based** (`all: true`): carries filter fields (cardTypes,
 *    subTypes, controller). Scans room.battlefield for matching permanents
 *    and expands into one concrete TargetPointer per match. Used for
 *    anthem/AOE effects whose targets are determined at resolve time.
 * 2. **Concrete** (has cardUuid/playerId/stackUuid): re-validated — removed
 *    if no longer legal (e.g., a creature bounced back to hand after cast).
 *
 * Validation rules:
 * - 'permanent' / 'card' targets: must exist on the battlefield (by cardUuid)
 * - 'player' targets: must exist in room.players
 * - 'stack' targets: must still be on the stack (by stackUuid)
 * - 'self' targets: always valid (controller always exists)
 *
 * Returns a new StackEffect with the resolved targets. If all targets are
 * removed and the effect required targets, the effect is marked with an empty
 * targets array — the EffectRegistry handler will simply do nothing.
 */
export function revalidateTargets(
  room: GameRoom,
  effect: StackEffect,
  controllerId: string,
  source?: CardInstance
): StackEffect {
  const resolvedTargets: TargetPointer[] = [];

  for (const target of effect.targets) {
    // Filter-based "all" target → expand to concrete matches
    if (target.all) {
      if (target.targetType === 'player') {
        for (const playerId of Object.keys(room.players)) if ((target.controller !== 'self' || playerId === controllerId) && (target.controller !== 'opponent' || playerId !== controllerId)) resolvedTargets.push({ targetType: 'player', playerId });
        continue;
      }
      const matches = room.battlefield.filter(card => matchesTargetFilter(card,
        { ...effect.targeting, ...target, type: 'permanent', required: false }, controllerId, room));
      for (const card of matches) {
        resolvedTargets.push({ targetType: 'permanent', cardUuid: card.uuid });
      }
      continue;
    }

    // Concrete target → validate it is still legal
    const valid = isExplicitTargeting(effect.targeting)
      ? structuralTargetLegal(room, controllerId, target, effect.targeting) && (!source || ModifierRegistry.canTarget(room, controllerId, source, [target]))
      : (() => {
      switch (target.targetType) {
        case 'permanent':
        case 'card': {
          if (!target.cardUuid) return false;
          const card = findTargetCard(room, target);
          return !!card && card.state.zone === (target.zone ?? 'battlefield') && (target.zoneRevision === undefined || target.zoneRevision === (card.state.zoneRevision ?? 0));
        }
        case 'player': {
          if (!target.playerId) return false;
          return target.playerId in room.players;
        }
        case 'stack': {
          if (!target.stackUuid) return false;
          return room.stack.some(s => s.uuid === target.stackUuid);
        }
        case 'self': {
          // Self always resolves to the controller — always valid
          return true;
        }
        default:
          return false;
      }
    })();

    if (valid) resolvedTargets.push(target);
  }

  // CR 114.5 fizzle: if the effect required targets and all were dropped,
  // the effect fizzles (empty targets). The EffectRegistry handler will do
  // nothing. If not required, it resolves with the remaining legal targets.
  // The `fizzled` flag is surfaced to the UI via STACK_ITEM_RESOLVED so it
  // can render the fizzle (e.g. "target is no longer legal").
  if (isExplicitTargeting(effect.targeting) && effect.targets.length > 0 && resolvedTargets.length === 0) {
    return {
      ...effect,
      targets: [],
      fizzled: true,
    };
  }

  return {
    ...effect,
    targets: resolvedTargets,
  };
}

/**
 * Compute dynamic parameter values at resolve time.
 *
 * Dynamic markers in params are strings prefixed with 'DYNAMIC:':
 * - 'DYNAMIC:source.power' → stackObj.source.power (current power at resolve time)
 * - 'DYNAMIC:source.toughness' → stackObj.source.toughness
 * - 'DYNAMIC:target.power' → first target's current power
 *
 * Non-dynamic params are left as-is. The result is merged into effect.dynamicParams
 * so EffectRegistry handlers can use `effect.dynamicParams?.power ?? effect.params.power`.
 */
export function buildDynamicParams(
  room: GameRoom,
  stackObj: StackObject,
  effect: StackEffect
): Record<string, unknown> {
  const dynamic: Record<string, unknown> = {};
  let sourceInfo: CardSnapshot | undefined;
  const firstTarget = effect.targets[0];
  const target = firstTarget?.cardUuid ? findTargetCard(room, firstTarget) : undefined;
  const exactTarget = target && (firstTarget.zoneRevision === undefined || firstTarget.zoneRevision === (target.state.zoneRevision ?? 0)) ? target : undefined;
  const numeric = createBoardNumericContext({ cards: roomCards(room), characteristics: card => CardCharacteristicService.resolve(room, card),
    controllerId: stackObj.controllerId, source: stackObj.source, target: exactTarget, defaultCountZones: ['battlefield'] });
  numeric.bindings = stackObj.type === 'triggered' ? undefined : stackObj.numericBindings;
  numeric.readField = path => {
    if (path.startsWith('source.')) {
      sourceInfo ??= resolveSourceInformation(room, stackObj);
      return readRulePath({ source: { ...sourceInfo.card, power: sourceInfo.power, toughness: sourceInfo.toughness } }, path);
    }
    if (path.startsWith('target.')) return exactTarget ? readRulePath({ target: { ...exactTarget, ...CardCharacteristicService.resolve(room, exactTarget) } }, path) : undefined;
    return readRulePath({ controller: room.players[stackObj.controllerId], event: stackObj.type === 'triggered' ? stackObj.triggeringEvent : undefined,
      history: { ...room.turnHistory, own: room.turnHistory?.playerCounts[stackObj.controllerId] } }, path);
  };

  for (const [key, value] of Object.entries(effect.params)) {
    if (hasNumericExpression(value)) {
      const result = evaluateNumericValue(value, numeric);
      dynamic[key] = result.ok ? result.value : undefined;
      continue;
    }
    if (typeof value !== 'string' || !value.startsWith('DYNAMIC:')) continue;

    const path = value.slice('DYNAMIC:'.length);
    if (path.startsWith('event.') && stackObj.type === 'triggered') {
      const eventValue = readRulePath({ event: stackObj.triggeringEvent }, path);
      const result = typeof eventValue === 'number' ? evaluateNumericValue({ numeric: { kind: 'query', id: 'field', args: { path } } }, numeric) : undefined;
      dynamic[key] = result ? result.ok ? result.value : undefined : eventValue;
      continue;
    }

    if (['source.power', 'source.toughness', 'target.power', 'target.toughness'].includes(path)) {
      const result = path.startsWith('target.') && exactTarget?.state.zone !== 'battlefield' ? undefined
        : evaluateNumericValue({ numeric: { kind: 'query', id: 'field', args: { path } } }, numeric);
      dynamic[key] = result?.ok ? result.value : undefined;
    }
  }

  return dynamic;
}
