// src/engine/effect-resolver.ts
import { EffectRegistry } from './effect-registry';
import type { ResolutionEffectResult, ResolutionReport } from '../types/game-event.types';
import { gameReducer } from './game-reducer';
import { CardCharacteristicService } from './card-characteristic-service';
import type { GameMutation } from '../types/game-mutation.types';
import type { GameRoom } from '../types/game.room.types';
import type { StackObject, StackEffect, EffectDefinition, TargetPointer } from '../types/effect.types';
import type { CardInstance, CardSnapshot } from '../types/card.types';
import { structuralTargetLegal, isExplicitTargeting, findTargetCard } from '../shared/target-legality';
import { ModifierRegistry } from './modifier-registry';
import { resolutionChoice } from './resolution-choices';
import type { PendingChoice, ResolutionContinuation } from '../types/choice.types';
import { choiceCanComplete } from './choices';
import { resolveSourceInformation } from './source-information';
import { conditionMatches, createRuleContext, readRulePath } from './rule-conditions';
import { planProposedMutations } from './proposed-events';

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
      const matches = room.battlefield.filter(card => {
        if (target.cardTypes && target.cardTypes.length > 0) {
          const hasType = target.cardTypes.some(t => CardCharacteristicService.resolveTypes(room, card).includes(t));
          if (!hasType) return false;
        }
        if (target.subTypes && target.subTypes.length > 0) {
          const hasSubtype = target.subTypes.some(s => CardCharacteristicService.resolveSubTypes(room, card).includes(s));
          if (!hasSubtype) return false;
        }
        if (target.controller === 'self' && CardCharacteristicService.resolveController(room, card) !== controllerId) return false;
        if (target.controller === 'opponent' && CardCharacteristicService.resolveController(room, card) === controllerId) return false;
        return true;
      });
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

  for (const [key, value] of Object.entries(effect.params)) {
    if (typeof value !== 'string' || !value.startsWith('DYNAMIC:')) continue;

    const path = value.slice('DYNAMIC:'.length);
    if (path.startsWith('event.') && stackObj.type === 'triggered') {
      dynamic[key] = readRulePath({ event: stackObj.triggeringEvent }, path);
      continue;
    }

    if (path === 'source.power') {
      sourceInfo ??= resolveSourceInformation(room, stackObj);
      dynamic[key] = sourceInfo.power;
    } else if (path === 'source.toughness') {
      sourceInfo ??= resolveSourceInformation(room, stackObj);
      dynamic[key] = sourceInfo.toughness;
    } else if (path === 'target.power') {
      const firstTarget = effect.targets[0];
      if (firstTarget?.cardUuid) {
        const card = room.battlefield.find(c => c.uuid === firstTarget.cardUuid);
        dynamic[key] = card ? CardCharacteristicService.resolvePower(room, card) : undefined;
      }
    } else if (path === 'target.toughness') {
      const firstTarget = effect.targets[0];
      if (firstTarget?.cardUuid) {
        const card = room.battlefield.find(c => c.uuid === firstTarget.cardUuid);
        dynamic[key] = card ? CardCharacteristicService.resolveToughness(room, card) : undefined;
      }
    }
  }

  return dynamic;
}

function isPermanent(room: GameRoom, card: CardInstance): boolean {
  return CardCharacteristicService.resolveTypes(room, card).some(type =>
    ['Creature', 'Artifact', 'Enchantment', 'Land'].includes(type)
  );
}

/**
 * Perform the structural zone change for a resolving StackObject.
 * This is a game rule, not an effect — permanents enter the battlefield,
 * non-permanents go to the graveyard. Countered spells go to graveyard
 * regardless of type.
 *
 * Returns the card after zone change (for PERMANENT_ENTERED emission)
 * and the mutations to apply.
 */
export function applyStructuralZoneChange(room: GameRoom, stackObj: StackObject): { card: CardInstance; mutations: GameMutation[] } {
  const mutations: GameMutation[] = [];

  // Exhaustive switch on the discriminated union — adding a new StackObject
  // type forces the compiler to handle it here (no default case).
  switch (stackObj.type) {
    case 'spell': {
      // Source is a card on the stack — it moves to its destination.
      const card = stackObj.source;
      const ownerId = card.state.ownerId;
      if (stackObj.countered || stackObj.fizzled) {
        mutations.push({ type: 'MOVE_CARD', cardUuid: card.uuid, playerId: ownerId, from: 'stack', to: 'graveyard' });
      } else if (isPermanent(room, card)) {
        mutations.push({ type: 'MOVE_CARD', cardUuid: card.uuid, playerId: ownerId, from: 'stack', to: 'battlefield' });
      } else {
        mutations.push({ type: 'MOVE_CARD', cardUuid: card.uuid, playerId: ownerId, from: 'stack', to: 'graveyard' });
      }
      return { card, mutations };
    }
    case 'activated':
    case 'triggered': {
      // Source is a permanent already on the battlefield — it stays there.
      // Only the StackObject itself is popped. Moving the source would
      // duplicate it (e.g. an attacking creature would be re-added).
      return { card: stackObj.source, mutations: [{ type: 'REMOVE_STACK', stackUuid: stackObj.uuid }] };
    }
  }
}

/**
 * Resolve all effects on a StackObject by dispatching each to the EffectRegistry.
 * Before each effect resolves:
 * 1. Targets are re-validated (illegal targets removed)
 * 2. Dynamic params are computed (values that change between propose and resolve)
 *
 * Skips resolution entirely if the stack object is countered.
 * Returns effect completion metadata for publication after application.
 * Returns the accumulated mutations.
 *
 * NOTE: Effects within a single StackObject are applied sequentially through
 * the reducer so each effect sees the state after previous effects.
 */
export function resolveEffects(room: GameRoom, stackObj: StackObject, results: ResolutionEffectResult[] = [], targetsLocked = false): GameMutation[] {
  if (stackObj.countered || stackObj.fizzled) return [];

  const mutations: GameMutation[] = [];
  let workingRoom = room;

  for (const effect of stackObj.effects) {
    // 1. Resolve targets at resolve time: expand "all" targets (anthem/AOE)
    //    into concrete targets, then re-validate concrete targets
    const validatedEffect = targetsLocked && isExplicitTargeting(effect.targeting)
      ? { ...effect, fizzled: false, targets: effect.targets.filter(target => targetIdentityPresent(workingRoom, target)) }
      : revalidateTargets(workingRoom, effect, stackObj.controllerId, stackObj.source);

    // 2. Compute dynamic params (values that may have changed since propose)
    const dynamicParams = buildDynamicParams(workingRoom, stackObj, validatedEffect);
    const unresolved = Object.entries(validatedEffect.params).some(([key, value]) => typeof value === 'string' && value.startsWith('DYNAMIC:') &&
      (dynamicParams[key] === undefined || (typeof dynamicParams[key] === 'number' && !Number.isFinite(dynamicParams[key]))));
    if (unresolved) {
      results.push({ effectId: validatedEffect.action, fizzled: false, skipped: 'unresolved_parameter' });
      continue;
    }
    if (Object.keys(dynamicParams).length > 0) {
      validatedEffect.dynamicParams = dynamicParams;
    }

    // 3. Dispatch to EffectRegistry (handler does nothing if targets is empty)
    const handler = EffectRegistry[validatedEffect.action];
    if (handler && (!isExplicitTargeting(validatedEffect.targeting) || validatedEffect.targets.length > 0)) {
      const effectMutations = handler(workingRoom, stackObj, { ...validatedEffect, params: { ...validatedEffect.params, ...dynamicParams } });
      mutations.push(...effectMutations);
      // Apply each effect's mutations so the next effect sees the updated state
      for (const m of effectMutations) {
        workingRoom = gameReducer(workingRoom, m);
      }
    }

    // Keep the input stack object immutable; completion metadata carries fizzle status.
    results.push({ effectId: validatedEffect.action, fizzled: targetsLocked ? stackObj.fizzled ?? false : validatedEffect.fizzled ?? false,
      ...(isExplicitTargeting(validatedEffect.targeting) && validatedEffect.targets.length === 0 && (effect.fizzled || effect.targets.length > 0) ? { skipped: 'illegal_targets' as const } : {}) });
  }

  return mutations;
}

/**
 * Full resolution of a single StackObject: structural zone change,
 * effect execution, and post-resolution events (PERMANENT_ENTERED, STACK_RESOLVED).
 * Used by both ActionService and GameEngine to avoid duplicated logic.
 * Returns the accumulated mutations.
 */
export function resolveStackObject(room: GameRoom, stackObj: StackObject, results: ResolutionEffectResult[] = []): GameMutation[] {
  const plan = planStackResolution(room, stackObj);
  results.push(...plan.resolution?.effects ?? []);
  return plan.mutations;
}

/** Targets are checked once for the object; sequential instructions retain that decision. */
export function planStackResolution(room: GameRoom, stackObj: StackObject, continuation?: ResolutionContinuation): { mutations: GameMutation[]; resolution?: ResolutionReport; pendingChoice?: PendingChoice } {
  if (continuation) return continueResolution(room, continuation.stackObj, continuation.effectIndex, continuation.results);
  if (stackObj.type === 'triggered' && stackObj.ability?.interveningIf) {
    const info = resolveSourceInformation(room, stackObj);
    if (!conditionMatches(stackObj.ability.interveningIf, createRuleContext(room, info.card, stackObj.controllerId, stackObj.triggeringEvent, info))) {
      return { mutations: applyStructuralZoneChange(room, stackObj).mutations, resolution: { stackObj, effects: stackObj.effects.map(effect => ({ effectId: effect.action, fizzled: false, skipped: 'condition_failed' })) } };
    }
  }
  const source = stackObj.effects.some(effect => isExplicitTargeting(effect.targeting)) ? resolveSourceInformation(room, stackObj).card : stackObj.source;
  const effects = stackObj.effects.map(effect => isExplicitTargeting(effect.targeting)
    ? revalidateTargets(room, effect, stackObj.controllerId, source) : effect);
  const chosen = stackObj.effects.filter(effect => isExplicitTargeting(effect.targeting)).flatMap(effect => effect.targets);
  const legal = effects.filter(effect => isExplicitTargeting(effect.targeting)).flatMap(effect => effect.targets);
  const fizzled = !stackObj.countered && chosen.length > 0 && legal.length === 0;
  const resolving: StackObject = { ...stackObj, effects, fizzled };
  return continueResolution(room, resolving, 0, []);
}

function continueResolution(room: GameRoom, resolving: StackObject, startIndex: number, previousResults: ResolutionEffectResult[]): { mutations: GameMutation[]; resolution?: ResolutionReport; pendingChoice?: PendingChoice } {
  const results = [...previousResults];
  const mutations: GameMutation[] = [];
  let workingRoom = room;
  if (!resolving.fizzled && !resolving.countered) {
    for (let index = startIndex; index < resolving.effects.length; index++) {
      const effect = resolving.effects[index];
      const available = !isExplicitTargeting(effect.targeting) || effect.targets.some(target => targetIdentityPresent(workingRoom, target));
      if (effect.choice && available) {
        const selected = effect.choice.kind === 'distribution' ? revalidateTargets(workingRoom, effect, resolving.controllerId, resolving.source) : effect;
        const request = resolutionChoice(workingRoom, resolving, selected, index, results);
        if (!choiceCanComplete(request)) {
          results.push({ effectId: effect.action, fizzled: false, skipped: 'illegal_targets' });
          continue;
        }
        return { mutations, pendingChoice: request };
      }
      const produced = resolveEffects(workingRoom, { ...resolving, effects: [effect] }, results, true);
      const planned = planProposedMutations(workingRoom, produced);
      if (planned.pendingChoice) {
        if (planned.pendingChoice.continuation.type === 'replacement') planned.pendingChoice.continuation.afterResolution = {
          type: 'resolution', stackObj: resolving, effectIndex: index + 1, results,
        };
        return { mutations, pendingChoice: planned.pendingChoice };
      }
      mutations.push(...planned.mutations);
      for (const mutation of planned.mutations) workingRoom = gameReducer(workingRoom, mutation);
    }
  }
  mutations.push(...applyStructuralZoneChange(workingRoom, resolving).mutations);
  if (resolving.fizzled || resolving.countered) results.push(...resolving.effects.map(effect => ({ effectId: effect.action, fizzled: resolving.fizzled ?? false,
    skipped: resolving.countered ? 'countered' as const : 'object_failed' as const })));
  return { mutations, resolution: { stackObj: resolving, effects: results } };
}

function targetIdentityPresent(room: GameRoom, target: TargetPointer): boolean {
  if (target.targetType === 'card' || target.targetType === 'permanent') {
    const card = findTargetCard(room, target);
    return !!card && card.state.zone === (target.zone ?? 'battlefield') &&
      (target.zoneRevision === undefined || target.zoneRevision === (card.state.zoneRevision ?? 0));
  }
  if (target.targetType === 'player') return !!target.playerId && !!room.players[target.playerId];
  if (target.targetType === 'spell' || target.targetType === 'stack') return room.stack.some(object => object.uuid === target.stackUuid);
  return false;
}
