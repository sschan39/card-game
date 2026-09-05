// src/engine/effect-resolver.ts
import { EffectRegistry } from './effect-registry';
import { ModifierPipeline } from './modifier-pipeline';
import { EventBus } from './event-bus';
import { gameReducer } from './game-reducer';
import { CardCharacteristicService } from './card-characteristic-service';
import type { GameMutation } from '../types/game-mutation.types';
import type { GameRoom } from '../types/game.room.types';
import type { StackObject, StackEffect, EffectDefinition, TargetPointer } from '../types/effect.types';
import type { CardInstance } from '../types/card.types';

/**
 * Convert card definition effects into StackEffects with auto-filled self-targets.
 * Used by both playCardHandler (onCastEffects) and TriggerManager (onEnterEffects).
 */
export function buildStackEffects(
  definitions: EffectDefinition[] | undefined,
  controllerId: string
): StackEffect[] {
  if (!definitions) return [];
  return definitions.map(def => {
    const targets: TargetPointer[] = [];
    if (def.targeting.type === 'self') {
      targets.push({ targetType: 'player', playerId: controllerId });
    } else if (def.targeting.all) {
      // "All matching permanents" — expanded into concrete cardUuid targets
      // at resolve time by expandTargets(). The filter fields are carried here.
      targets.push({
        targetType: 'permanent',
        all: true,
        cardTypes: def.targeting.cardTypes,
        subTypes: def.targeting.subTypes,
        controller: def.targeting.controller,
      });
    }
    // For effects requiring explicit targets, targets are filled by server-prompted targeting (future)
    return {
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
  controllerId: string
): StackEffect {
  const resolvedTargets: TargetPointer[] = [];

  for (const target of effect.targets) {
    // Filter-based "all" target → expand to concrete matches
    if (target.all) {
      const matches = room.battlefield.filter(card => {
        if (target.cardTypes && target.cardTypes.length > 0) {
          const hasType = target.cardTypes.some(t => card.blueprint.cardTypes.includes(t));
          if (!hasType) return false;
        }
        if (target.subTypes && target.subTypes.length > 0) {
          const hasSubtype = target.subTypes.some(s => (card.blueprint.subTypes || []).includes(s));
          if (!hasSubtype) return false;
        }
        if (target.controller === 'self' && card.state.controllerId !== controllerId) return false;
        if (target.controller === 'opponent' && card.state.controllerId === controllerId) return false;
        return true;
      });
      for (const card of matches) {
        resolvedTargets.push({ targetType: 'permanent', cardUuid: card.uuid });
      }
      continue;
    }

    // Concrete target → validate it is still legal
    const valid = (() => {
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
  if (effect.targeting?.required && resolvedTargets.length === 0) {
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

  for (const [key, value] of Object.entries(effect.params)) {
    if (typeof value !== 'string' || !value.startsWith('DYNAMIC:')) continue;

    const path = value.slice('DYNAMIC:'.length);

    if (path === 'source.power') {
      const sourceCard = (stackObj.source as CardInstance | undefined);
      dynamic[key] = sourceCard ? CardCharacteristicService.resolvePower(room, sourceCard) : undefined;
    } else if (path === 'source.toughness') {
      const sourceCard = (stackObj.source as CardInstance | undefined);
      dynamic[key] = sourceCard ? CardCharacteristicService.resolveToughness(room, sourceCard) : undefined;
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
    mutations.push({ type: 'MOVE_CARD', cardUuid: card.uuid, playerId: ownerId, from: 'stack', to: 'battlefield' });
    mutations.push({ type: 'UNTAP_CARD', cardUuid: card.uuid });
    if (card.blueprint.cardTypes.includes('Creature')) {
      mutations.push({ type: 'SET_SUMMONING_SICKNESS', cardUuid: card.uuid, value: true });
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
    // 1. Resolve targets at resolve time: expand "all" targets (anthem/AOE)
    //    into concrete targets, then re-validate concrete targets
    const validatedEffect = revalidateTargets(workingRoom, effect, stackObj.controllerId);

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

    // Surface the fizzle on the StackObject itself so the client can render it
    // (the stack item is still on the stack until the structural MOVE_CARD pops it).
    if (validatedEffect.fizzled) {
      stackObj.fizzled = true;
      mutations.push({ type: 'SET_FIZZLED', stackUuid: stackObj.uuid });
    }

    eventBus.emit({
      eventId: 'STACK_ITEM_RESOLVED',
      roomId: workingRoom.roomId,
      payload: {
        effectId: validatedEffect.action,
        stackObj,
        fizzled: validatedEffect.fizzled ?? false,
      },
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