import { effectCanAffect } from '../shared/action-permissions';
import { CardCharacteristicService } from './card-characteristic-service';
import type { CardInstance, CardSnapshot } from '../types/card.types';
import type { GameRoom } from '../types/game.room.types';
import type { EffectDefinition, StackEffect, StackObject, TargetPointer } from '../types/effect.types';
import { structuralTargetLegal, isExplicitTargeting, findTargetCard } from '../shared/target-legality';
import { matchesTargetFilter } from '../shared/target-utils';
import { PermissionRegistry } from './permission-registry';
import { resolveSourceInformation } from './source-information';
import { readRulePath, conditionMatches } from './rule-conditions';
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
  // Guard: a card with no effects contributes nothing.
  if (!definitions) return [];

  return definitions.map((def, index) => {
    const targets: TargetPointer[] = [];
    // Granted instructions can omit targeting just like printed instructions.
    const targeting = def.targeting ?? { type: 'self', required: false };

    if (targeting.type === 'self' && targeting.subject !== 'event_card') {
      // A self-target is either the source permanent or its controller.
      targets.push(targeting.subject === 'source' && source
        ? {
            targetType: source.state.zone === 'battlefield' ? 'permanent' : 'card',
            cardUuid: source.uuid,
            zone: source.state.zone,
            zoneRevision: source.state.zoneRevision ?? 0,
          }
        : { targetType: 'player', playerId: controllerId });
    } else if (targeting.all) {
      // "All matching permanents" — expanded into concrete cardUuid targets
      // at resolve time by expandTargets(). The filter fields are carried here.
      targets.push({
        targetType: targeting.type,
        all: true,
        cardTypes: targeting.cardTypes,
        subTypes: targeting.subTypes,
        controller: targeting.controller,
      });
    }

    // For effects requiring explicit targets, targets are filled by server-prompted targeting (future)
    return {
      ...(def.recordResult ? { recordResult: def.recordResult } : {}),
      ...(def.condition ? { condition: def.condition } : {}),
      instructionId: def.instructionId ?? String(index),
      onKill: def.onKill,
      targetGroup: def.targetGroup,
      recordOutcome: def.recordOutcome,
      requiresOutcome: def.requiresOutcome,
      choice: def.choice,
      action: def.action,
      params: def.params ?? {},
      tags: def.tags || [],
      targets,
      targeting,
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
        // Every player, narrowed by the self/opponent controller filter.
        for (const playerId of Object.keys(room.players)) if ((target.controller !== 'self' || playerId === controllerId) && (target.controller !== 'opponent' || playerId !== controllerId)) resolvedTargets.push({ targetType: 'player', playerId });

        continue;
      }

      const matches = room.battlefield.filter(card => matchesTargetFilter(card,
        { ...effect.targeting, ...target, type: 'permanent', required: false }, controllerId, room));

      for (const card of matches) {
        if (effectCanAffect(room, controllerId, card, source))
          resolvedTargets.push({ targetType: 'permanent', cardUuid: card.uuid });
      }

      continue;
    }

    // Concrete target → validate it is still legal
    const valid = isExplicitTargeting(effect.targeting)
      ? structuralTargetLegal(room, controllerId, target, effect.targeting) && (!source || PermissionRegistry.canTarget(room, controllerId, source, [target]))
      : (() => {
        switch (target.targetType) {
          case 'permanent':
          case 'card': {
            if (!target.cardUuid) return false;

            const card = findTargetCard(room, target);

            return !!card && card.state.zone === (target.zone ?? 'battlefield') &&
              (target.zoneRevision === undefined || target.zoneRevision === (card.state.zoneRevision ?? 0)) &&
              effectCanAffect(room, controllerId, card, source);
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
  const { numeric, exactTarget } = resolutionNumericContext(room, stackObj, effect);

  for (const [key, value] of Object.entries(effect.params)) {
    // Numeric expressions are evaluated against the board context.
    if (hasNumericExpression(value)) {
      const result = evaluateNumericValue(value, numeric);
      dynamic[key] = result.ok ? result.value : undefined;

      continue;
    }

    // Guard: only 'DYNAMIC:' markers are resolved here.
    if (typeof value !== 'string' || !value.startsWith('DYNAMIC:')) continue;
    const path = value.slice('DYNAMIC:'.length);

    // Event fields come from the triggering event of a triggered ability.
    if (path.startsWith('event.') && stackObj.type === 'triggered') {
      const eventValue = readRulePath({ event: stackObj.triggeringEvent }, path);
      const result = typeof eventValue === 'number' ? evaluateNumericValue({ numeric: { kind: 'query', id: 'field', args: { path } } }, numeric) : undefined;
      dynamic[key] = result ? result.ok ? result.value : undefined : eventValue;

      continue;
    }
    if (['source.power', 'source.toughness', 'target.power', 'target.toughness'].includes(path)) {
      // A target that has left the battlefield has no characteristics to read.
      const result = path.startsWith('target.') && exactTarget?.state.zone !== 'battlefield'
        ? undefined
        : evaluateNumericValue({ numeric: { kind: 'query', id: 'field', args: { path } } }, numeric);
      dynamic[key] = result?.ok ? result.value : undefined;
    }
  }
  return dynamic;
}

/** Conditions and parameter expressions see the same resolution-local query sources. */
export function resolutionNumericContext(room: GameRoom, stackObj: StackObject, effect: StackEffect) {
  let sourceInfo: CardSnapshot | undefined;
  const firstTarget = effect.targets[0];
  const target = firstTarget?.cardUuid ? findTargetCard(room, firstTarget) : undefined;
  const exactTarget = target && (firstTarget.zoneRevision === undefined || firstTarget.zoneRevision === (target.state.zoneRevision ?? 0)) ? target : undefined;
  const numeric = createBoardNumericContext({ cards: roomCards(room), characteristics: card => CardCharacteristicService.resolve(room, card),
    controllerId: stackObj.controllerId, source: stackObj.source, target: exactTarget, defaultCountZones: ['battlefield'], results: stackObj.resolutionResults });
  numeric.bindings = stackObj.type === 'triggered' ? undefined : stackObj.numericBindings;
  const fields = {
    get source() {
      sourceInfo ??= resolveSourceInformation(room, stackObj);
      return { ...sourceInfo.card, ...sourceInfo.card.lastKnownCharacteristics, power: sourceInfo.power, toughness: sourceInfo.toughness };
    },
    get target() { return exactTarget ? { ...exactTarget, ...CardCharacteristicService.resolve(room, exactTarget) } : undefined; },
    controller: room.players[stackObj.controllerId], event: stackObj.type === 'triggered' ? stackObj.triggeringEvent : undefined,
    room: {
      phase: room.phase, turnNumber: room.turnNumber ?? 1, activeTurnPlayerId: room.activeTurnPlayerId,
      get attackerIds() { return room.combat.map(declaration => declaration.attacker.uuid); },
    },
    history: { ...room.turnHistory, own: room.turnHistory?.playerCounts[stackObj.controllerId] },
  };
  numeric.readField = path => readRulePath(fields, path);
  return { numeric, exactTarget, fields };
}

/** Whether an instruction's authored condition still holds at resolution time. */
export function instructionConditionMatches(room: GameRoom, object: StackObject, effect: StackEffect): boolean {
  if (!effect.condition) return true;
  const { numeric, fields } = resolutionNumericContext(room, object, effect);
  return conditionMatches(effect.condition, fields, numeric);
}
