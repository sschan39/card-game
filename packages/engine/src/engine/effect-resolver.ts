// src/engine/effect-resolver.ts
import { EffectRegistry } from './effect-registry';
import type { ResolutionEffectResult, ResolutionReport } from '../types/game-event.types';
import { gameReducer } from './game-reducer';
import { CardCharacteristicService } from './card-characteristic-service';
import type { GameMutation } from '../types/game-mutation.types';
import type { GameRoom } from '../types/game.room.types';
import type { StackObject, TargetPointer } from '../types/effect.types';
import type { CardInstance } from '../types/card.types';
import { isExplicitTargeting, findTargetCard } from '../shared/target-legality';
import { resolutionChoice } from './resolution-choices';
import type { PendingChoice, ResolutionContinuation } from '../types/choice.types';
import { choiceCanComplete } from './choices';
import { resolveSourceInformation } from './source-information';
import { conditionMatches, createRuleContext } from './rule-conditions';
import { planProposedMutations } from './proposed-events';
import { defaultEffectContext, type EffectContext } from './effect-context';
import { hasNumericExpression } from './numeric-values';
import { expandBoundedReveal } from './bounded-reveal';
import { probeOutcome, settleOutcome } from './resolution-outcomes';
import { buildDynamicParams, revalidateTargets } from './resolution-planning';

export { buildStackEffects, buildDynamicParams, revalidateTargets } from './resolution-planning';

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
      const origin = stackObj.immediate ? card.state.zone : 'stack';
      const cast = stackObj.immediate ? { reason: 'cast' as const, stackObject: stackObj } : {};
      if (stackObj.countered || stackObj.fizzled) {
        mutations.push({ type: 'MOVE_CARD', cardUuid: card.uuid, playerId: ownerId, from: origin, to: 'graveyard', ...cast });
      } else if (isPermanent(room, card)) {
        mutations.push({ type: 'MOVE_CARD', cardUuid: card.uuid, playerId: ownerId, from: origin, to: 'battlefield', ...cast });
      } else {
        mutations.push({ type: 'MOVE_CARD', cardUuid: card.uuid, playerId: ownerId, from: origin, to: 'graveyard', ...cast });
      }
      return { card, mutations };
    }
    case 'activated':
    case 'triggered': {
      // Source is a permanent already on the battlefield — it stays there.
      // Only the StackObject itself is popped. Moving the source would
      // duplicate it (e.g. an attacking creature would be re-added).
      return { card: stackObj.source, mutations: stackObj.immediate ? [] : [{ type: 'REMOVE_STACK', stackUuid: stackObj.uuid }] };
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
export function resolveEffects(room: GameRoom, stackObj: StackObject, results: ResolutionEffectResult[] = [], targetsLocked = false, context: EffectContext = defaultEffectContext): GameMutation[] {
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
    const unresolved = Object.entries(validatedEffect.params).some(([key, value]) => (hasNumericExpression(value) || typeof value === 'string' && value.startsWith('DYNAMIC:')) &&
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
      const effectMutations = handler(workingRoom, stackObj, { ...validatedEffect, params: { ...validatedEffect.params, ...dynamicParams } }, context);
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
export function resolveStackObject(room: GameRoom, stackObj: StackObject, results: ResolutionEffectResult[] = [], context: EffectContext = defaultEffectContext): GameMutation[] {
  const plan = planStackResolution(room, stackObj, undefined, context);
  results.push(...plan.resolution?.effects ?? []);
  return plan.mutations;
}

/** Targets are checked once for the object; sequential instructions retain that decision. */
export function planStackResolution(room: GameRoom, stackObj: StackObject, continuation?: ResolutionContinuation, context: EffectContext = defaultEffectContext): { mutations: GameMutation[]; resolution?: ResolutionReport; pendingChoice?: PendingChoice } {
  if (continuation) return continueResolution(room, continuation.stackObj, continuation.effectIndex, continuation.results, context);
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
  return continueResolution(room, resolving, 0, [], context);
}

function continueResolution(room: GameRoom, resolving: StackObject, startIndex: number, previousResults: ResolutionEffectResult[], context: EffectContext): { mutations: GameMutation[]; resolution?: ResolutionReport; pendingChoice?: PendingChoice } {
  const results = [...previousResults];
  const mutations: GameMutation[] = [];
  let workingRoom = room;
  if (!resolving.fizzled && !resolving.countered) {
    for (let index = startIndex; index < resolving.effects.length; index++) {
      const effect = resolving.effects[index];
      if (effect.requiresOutcome && resolving.resolutionOutcomes?.[effect.requiresOutcome] !== true) {
        results.push({ effectId: effect.action, fizzled: false, skipped: 'condition_failed' });
        continue;
      }
      const expanded = !effect.choice ? expandBoundedReveal(workingRoom, resolving, effect, index) : undefined;
      if (expanded) {
        resolving = expanded;
        index--;
        continue;
      }
      const available = !isExplicitTargeting(effect.targeting) || effect.targets.some(target => targetIdentityPresent(workingRoom, target));
      if (effect.choice && available) {
        const selected = effect.choice.kind === 'distribution' ? revalidateTargets(workingRoom, effect, resolving.controllerId, resolving.source) : effect;
        const request = resolutionChoice(workingRoom, resolving, selected, index, results);
        if (effect.choice.kind === 'discard' && request.kind === 'discard' && request.max === 0) {
          results.push({ effectId: effect.action, fizzled: false });
          continue;
        }
        if (!choiceCanComplete(request)) {
          results.push({ effectId: effect.action, fizzled: false, skipped: 'illegal_targets' });
          continue;
        }
        return { mutations, pendingChoice: request };
      }
      const produced = resolveEffects(workingRoom, { ...resolving, effects: [effect] }, results, true, context);
      const outcomeProbe = probeOutcome(workingRoom, effect.recordOutcome, produced);
      const planned = planProposedMutations(workingRoom, produced);
      if (planned.pendingChoice) {
        if (planned.pendingChoice.continuation.type === 'replacement') planned.pendingChoice.continuation.afterResolution = {
          type: 'resolution', stackObj: resolving, effectIndex: index + 1, results, outcomeProbe,
        };
        return { mutations, pendingChoice: planned.pendingChoice };
      }
      mutations.push(...planned.mutations);
      resolving = settleOutcome(workingRoom, resolving, outcomeProbe, planned.mutations);
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
