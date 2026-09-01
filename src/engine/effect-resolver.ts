// src/engine/effect-resolver.ts
import { EffectRegistry } from './effect-registry';
import { ModifierPipeline } from './modifier-pipeline';
import { EventBus } from './event-bus';
import { gameReducer } from './game-reducer';
import type { GameMutation } from '../types/game-mutation.types';
import type { GameRoom } from '../types/game.room.types';
import type { StackObject, StackEffect, EffectDefinition, TargetPointer } from '../types/effect.types';
import type { CardInstance } from '../types/card.types';
import { currentPower, currentToughness } from './power-toughness';

/**
 * Convert card definition effects into StackEffects with auto-filled self-targets.
 * Used by both playCardHandler (onCastEffects) and TriggerManager (onEnterEffects).
 *
 * For effects that declare a targeting type other than 'self' (e.g. a counter-spell
 * that targets a spell on the stack), the caller supplies `chosenTargets` — the
 * targets chosen at cast time (from action.targets). They are attached verbatim so
 * the EffectRegistry handler can apply the effect to them. Self-targeted effects
 * ignore chosenTargets.
 */
export function buildStackEffects(
  definitions: EffectDefinition[] | undefined,
  controllerId: string,
  chosenTargets?: TargetPointer[]
): StackEffect[] {
  if (!definitions) return [];
  return definitions.map(def => {
    const targets: TargetPointer[] = [];
    if (def.targeting.type === 'self') {
      targets.push({ targetType: 'player', playerId: controllerId });
    } else if (chosenTargets && chosenTargets.length > 0) {
      // Attach the cast-time chosen targets for non-self targeted effects.
      targets.push(...chosenTargets);
    }
    return {
      action: def.action,
      params: def.params,
      tags: def.tags || [],
      targets,
    };
  });
}

/**
 * Re-validate targets at resolve time. Filters out targets that are no longer
 * legal (e.g., a creature that was bounced back to hand after the spell was cast).
 *
 * Validation rules:
 * - 'permanent' / 'card' targets: must exist on the battlefield (by cardUuid)
 * - 'player' targets: must exist in room.players
 * - 'stack' targets: must still be on the stack (by stackUuid)
 * - 'self' targets: always valid (controller always exists)
 *
 * Returns a new StackEffect with only the valid targets. If all targets are
 * removed and the effect required targets, the effect is marked with an empty
 * targets array — the EffectRegistry handler will simply do nothing.
 */
export function revalidateTargets(room: GameRoom, effect: StackEffect): StackEffect {
  const validTargets = effect.targets.filter(target => {
    switch (target.targetType) {
      case 'permanent':
      case 'card': {
        if (!target.cardUuid) return false;
        return room.battlefield.some(c => c.uuid === target.cardUuid);
      }
      case 'player': {
        if (!target.playerId) return false;
        return target.playerId in room.players;
      }
      case 'stack':
      case 'spell': {
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
  });

  return {
    ...effect,
    targets: validTargets,
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

  for (const [key, value] of Object.entries(effect.params)) {
    if (typeof value !== 'string' || !value.startsWith('DYNAMIC:')) continue;

    const path = value.slice('DYNAMIC:'.length);

    if (path === 'source.power') {
      dynamic[key] = currentPower(stackObj.source as CardInstance);
    } else if (path === 'source.toughness') {
      dynamic[key] = currentToughness(stackObj.source as CardInstance);
    } else if (path === 'target.power') {
      const firstTarget = effect.targets[0];
      if (firstTarget?.cardUuid) {
        const card = room.battlefield.find(c => c.uuid === firstTarget.cardUuid);
        dynamic[key] = card ? currentPower(card) : undefined;
      }
    } else if (path === 'target.toughness') {
      const firstTarget = effect.targets[0];
      if (firstTarget?.cardUuid) {
        const card = room.battlefield.find(c => c.uuid === firstTarget.cardUuid);
        dynamic[key] = card ? currentToughness(card) : undefined;
      }
    }
  }

  return dynamic;
}

function isPermanent(card: CardInstance): boolean {
  return card.blueprint.cardTypes.some(type =>
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
  const card = stackObj.source as CardInstance;
  const ownerId = card.state.controllerId || card.state.ownerId;
  const mutations: GameMutation[] = [];

  if (stackObj.countered) {
    mutations.push({ type: 'MOVE_CARD', cardUuid: card.uuid, playerId: ownerId, from: 'stack', to: 'graveyard' });
  } else if (isPermanent(card)) {
    // Only enter the battlefield for permanents that were actually cast to the
    // stack (spells). Activated abilities (e.g. attacks) whose source is an
    // EXISTING battlefield permanent (state.zone === 'battlefield') must NOT be
    // re-entered — doing so would duplicate the attacker on the battlefield and
    // mask lethal-damage destruction.
    if (card.state.zone === 'stack') {
      mutations.push({ type: 'MOVE_CARD', cardUuid: card.uuid, playerId: ownerId, from: 'stack', to: 'battlefield' });
      mutations.push({ type: 'UNTAP_CARD', cardUuid: card.uuid });
      if (card.blueprint.cardTypes.includes('Creature')) {
        mutations.push({ type: 'SET_SUMMONING_SICKNESS', cardUuid: card.uuid, value: true });
      }
    }
  } else {
    mutations.push({ type: 'MOVE_CARD', cardUuid: card.uuid, playerId: ownerId, from: 'stack', to: 'graveyard' });
  }

  return { card, mutations };
}

/**
 * Resolve all effects on a StackObject by dispatching each to the EffectRegistry.
 * Before each effect resolves:
 * 1. Targets are re-validated (illegal targets removed)
 * 2. Dynamic params are computed (values that change between propose and resolve)
 *
 * Skips resolution entirely if the stack object is countered.
 * Emits STACK_ITEM_RESOLVED after each effect.
 * Returns the accumulated mutations.
 *
 * NOTE: Effects within a single StackObject are applied sequentially through
 * the reducer so each effect sees the state after previous effects.
 */
export function resolveEffects(room: GameRoom, stackObj: StackObject, eventBus: EventBus): GameMutation[] {
  if (stackObj.countered) return [];

  const mutations: GameMutation[] = [];
  let workingRoom = room;

  for (const effect of stackObj.effects) {
    // 1. Re-validate targets at resolve time
    const validatedEffect = revalidateTargets(workingRoom, effect);

    // 2. Compute dynamic params (values that may have changed since propose)
    const dynamicParams = buildDynamicParams(workingRoom, stackObj, validatedEffect);
    if (Object.keys(dynamicParams).length > 0) {
      validatedEffect.dynamicParams = dynamicParams;
    }

    // 3. Run through modifier pipeline
    ModifierPipeline.apply(validatedEffect, workingRoom, stackObj);

    // 4. Dispatch to EffectRegistry (handler does nothing if targets is empty)
    const handler = EffectRegistry[validatedEffect.action];
    if (handler) {
      const effectMutations = handler(workingRoom, stackObj, validatedEffect);
      mutations.push(...effectMutations);
      // Apply each effect's mutations so the next effect sees the updated state
      for (const m of effectMutations) {
        workingRoom = gameReducer(workingRoom, m);
      }
    }

    eventBus.emit({
      eventId: 'STACK_ITEM_RESOLVED',
      roomId: workingRoom.roomId,
      payload: { effectId: validatedEffect.action, stackObj },
    });
  }

  return mutations;
}

/**
 * Full resolution of a single StackObject: structural zone change,
 * effect execution, and post-resolution events (PERMANENT_ENTERED, STACK_RESOLVED).
 * Used by both ActionService and GameEngine to avoid duplicated logic.
 * Returns the accumulated mutations.
 */
export function resolveStackObject(room: GameRoom, stackObj: StackObject, eventBus: EventBus): GameMutation[] {
  const { card, mutations } = applyStructuralZoneChange(room, stackObj);
  let workingRoom = room;
  for (const m of mutations) {
    workingRoom = gameReducer(workingRoom, m);
  }

  // Ensure the resolved StackObject actually leaves room.stack. A resolving
  // spell/permanent is removed when its source card is MOVE_CARDed out of the
  // stack zone, but an activated ability or triggered death ability has a
  // source that lives elsewhere (battlefield / graveyard), so no zone-change
  // mutation pops it. Poke the resolved (top) object off the stack in that case
  // so it doesn't linger and block future priority/resolution.
  const stillOnStack = workingRoom.stack.some(so => so.uuid === stackObj.uuid);
  if (stillOnStack) {
    mutations.push({ type: 'POP_STACK' });
    workingRoom = gameReducer(workingRoom, { type: 'POP_STACK' });
  }

  // Resolve effects via shared resolver (passes workingRoom so effects see post-zone-change state)
  mutations.push(...resolveEffects(workingRoom, stackObj, eventBus));

  // Emit PERMANENT_ENTERED for permanents (triggers ETB via TriggerManager)
  if (!stackObj.countered && isPermanent(card)) {
    eventBus.emit({
      eventId: 'PERMANENT_ENTERED',
      roomId: workingRoom.roomId,
      payload: { card, controllerId: stackObj.controllerId },
    });
  }

  eventBus.emit({
    eventId: 'STACK_RESOLVED',
    roomId: workingRoom.roomId,
    payload: { effectId: stackObj.effects[0]?.action || 'structural' },
  });

  return mutations;
}