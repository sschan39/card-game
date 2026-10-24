import { abilityEffects } from './ability-effects';
// src/engine/effect-registry.ts
import type { GameMutation } from '../types/game-mutation.types';
import { findTargetCard } from '../shared/target-legality';
import type { GameRoom } from '../types/game.room.types';
import type { StackObject, StackEffect } from '../types/effect.types';
import type { ManaColor, CardInstance, CardZone, ContinuousEffectEntry, TriggeredAbility } from '../types/card.types';
import { resolveSourceInformation } from './source-information';
import { planDamage } from './damage-service';
import type { DamageAssignment } from '../types/damage.types';
import type { ReplacementDefinition } from '../types/proposed-event.types';
import { planLibraryReorder, planLibraryShuffle } from './library-operations';
import type { MoveZoneParameters } from '../types/library.types';
import { defaultEffectContext, type EffectContext } from './effect-context';
import { validateCardMove } from './zone-transitions';
import { legalEquipmentAttachment } from './mechanics/equipment';

export type EffectHandler = (room: GameRoom, stackObj: StackObject, effect: StackEffect, context?: EffectContext) => GameMutation[];

const isCardZone = (value: unknown): value is CardZone =>
  typeof value === 'string' && ['library', 'hand', 'battlefield', 'graveyard', 'exile', 'stack'].includes(value);

function findCardOnBattlefield(room: GameRoom, uuid: string): CardInstance | undefined {
  return room.battlefield.find(c => c.uuid === uuid);
}

function findCardInZone(room: GameRoom, uuid: string, zone: string): CardInstance | undefined {
  if (zone === 'battlefield') return room.battlefield.find(c => c.uuid === uuid);
  for (const player of Object.values(room.players)) {
    if (zone === 'hand') {
      const found = player.hand.find(c => c.uuid === uuid);
      if (found) return found;
    }
    if (zone === 'graveyard') {
      const found = player.graveyard.find(c => c.uuid === uuid);
      if (found) return found;
    }
    if (zone === 'exile') {
      const found = player.exile?.find(c => c.uuid === uuid);
      if (found) return found;
    }
    if (zone === 'library') {
      const found = player.deck.find(c => c.uuid === uuid);
      if (found) return found;
    }
  }
  return undefined;
}

export const EffectRegistry: Record<string, EffectHandler> = {
  'ATTACH': (room, stackObj, effect) => {
    const target = effect.targets[0];
    if (!target?.cardUuid || target.zoneRevision === undefined) return [];
    const operation: Extract<GameMutation, { type: 'ATTACH_CARD' }> = { type: 'ATTACH_CARD', cardUuid: stackObj.source.uuid,
      zoneRevision: stackObj.source.state.zoneRevision ?? 0, hostUuid: target.cardUuid, hostRevision: target.zoneRevision, controllerId: stackObj.controllerId };
    return legalEquipmentAttachment(room, operation) ? [operation] : [];
  },
  'CLAIM_REVEALED_SELF': (room, stackObj, effect) => {
    if (stackObj.type !== 'triggered' || stackObj.triggeringEvent?.eventId !== 'CARD_REVEALED') return [];
    const revealed = stackObj.triggeringEvent.payload.revealedCard as CardInstance | undefined;
    if (revealed?.uuid !== stackObj.source.uuid) return [];
    const player = room.players[revealed.state.ownerId];
    const card = [...player.deck, ...player.hand].find(card => card.uuid === revealed.uuid &&
      card.state.zone === stackObj.source.state.zone && (card.state.zoneRevision ?? 0) === (stackObj.source.state.zoneRevision ?? 0));
    if (!card || (card.state.zone !== 'library' && card.state.zone !== 'hand')) return [];
    const to = effect.params.discard ? 'graveyard' as const : 'hand' as const;
    if (card.state.zone === to) return [];
    return [{ type: 'MOVE_CARD', cardUuid: card.uuid, playerId: player.id, from: card.state.zone, to,
      zoneRevision: card.state.zoneRevision ?? 0, ...(effect.params.discard ? { reason: 'discard' as const } : {}) }];
  },
  'DISCARD_FROM_LIBRARY': (room, _stackObj, effect) => {
    const amount = effect.params.amount;
    if (!Number.isSafeInteger(amount) || (amount as number) < 0) return [];
    return effect.targets.flatMap(target => {
      const player = target.playerId ? room.players[target.playerId] : undefined;
      if (!player || amount === 0) return [];
      return player.deck.slice(-Math.min(amount as number, player.deck.length)).reverse().map(card => ({
        type: 'MOVE_CARD' as const, cardUuid: card.uuid, playerId: player.id, from: 'library' as const,
        to: 'graveyard' as const, zoneRevision: card.state.zoneRevision ?? 0, reason: 'discard' as const,
      }));
    });
  },
  'DISCARD_FROM_HAND': (room, _stackObj, effect) => effect.targets.flatMap(target => {
    const card = findTargetCard(room, target);
    return card && card.state.zone === 'hand' && target.zone === 'hand' &&
      target.zoneRevision === (card.state.zoneRevision ?? 0) ? [{
        type: 'MOVE_CARD' as const, cardUuid: card.uuid, playerId: card.state.ownerId,
        from: 'hand' as const, to: 'graveyard' as const, zoneRevision: card.state.zoneRevision ?? 0, reason: 'discard' as const,
      }] : [];
  }),
  'SHUFFLE': (room, _stackObj, effect, context = defaultEffectContext) => effect.targets.flatMap(target =>
    target.targetType === 'player' && target.playerId ? planLibraryShuffle(room, target.playerId, context.random) : []),
  'REORDER_LIBRARY': (room, _stackObj, effect) => {
    const placement = effect.params.placement;
    if (placement !== 'top' && placement !== 'bottom' || !effect.targets.length) return [];
    const cards = effect.targets.map(target => target.targetType === 'card' ? findTargetCard(room, target) : undefined);
    if (cards.some((card, index) => !card || card.state.zone !== 'library' ||
        effect.targets[index].zone !== undefined && effect.targets[index].zone !== 'library' ||
        effect.targets[index].zoneRevision !== undefined && effect.targets[index].zoneRevision !== (card.state.zoneRevision ?? 0))) return [];
    const ownerId = cards[0]!.state.ownerId;
    if (cards.some(card => card!.state.ownerId !== ownerId)) return [];
    return planLibraryReorder(room, ownerId, cards.map(card => ({ cardUuid: card!.uuid, zoneRevision: card!.state.zoneRevision ?? 0 })), placement);
  },
  'CREATE_REPLACEMENT_EFFECT': (room, stackObj, effect) => {
    const definition = effect.params.definition as Omit<ReplacementDefinition, 'id'> | undefined;
    if (!definition?.operation?.type || typeof definition.label !== 'string') return [];
    const targets = effect.targets.length ? effect.targets : [undefined];
    return targets.flatMap(target => {
      const card = target?.cardUuid ? room.battlefield.find(c => c.uuid === target.cardUuid) : undefined;
      if (target && !card && !target.playerId) return [];
      return [{ type: 'ADD_REPLACEMENT_EFFECT' as const, effect: { ...structuredClone(definition), source: { cardUuid: stackObj.source.uuid, zoneRevision: stackObj.source.state.zoneRevision ?? 0 },
        match: { ...definition.match, ...(card ? { card: { cardUuid: card.uuid, zoneRevision: card.state.zoneRevision ?? 0 } } : target?.playerId ? { playerId: target.playerId } : {}) } } }];
    });
  },
  'REGENERATE': (room, stackObj, effect) => EffectRegistry.CREATE_REPLACEMENT_EFFECT(room, stackObj, { ...effect,
    params: { definition: { label: 'Regeneration', operation: { type: 'regenerate' }, match: { kinds: ['destroy'] }, uses: 1, duration: 'end_of_turn' } } }),
  'CREATE_DELAYED_TRIGGER': (room, stackObj, effect) => {
    const ability = effect.params.ability as TriggeredAbility | undefined;
    const lifetime = effect.params.lifetime ?? 'once';
    if (!ability || ability.type !== 'triggered' || !ability.triggerCondition || !abilityEffects(ability).length || !['once', 'end_of_turn', 'permanent'].includes(lifetime as string)) return [];
    return [{ type: 'ADD_DELAYED_TRIGGER', registration: { id: '', source: structuredClone(stackObj.source), sourceInfo: resolveSourceInformation(room, stackObj),
      controllerId: stackObj.controllerId, ability: structuredClone(ability), lifetime: lifetime as 'once' | 'end_of_turn' | 'permanent' } }];
  },

  'COUNTER': (room, _stackObj, effect) => effect.targets.filter(target =>
    (target.targetType === 'spell' || target.targetType === 'stack') && room.stack.some(object => object.uuid === target.stackUuid))
    .map(target => ({ type: 'COUNTER_STACK', stackUuid: target.stackUuid! })),

  'MOVE_ZONE': (room, _stackObj, effect) => {
    const raw = effect.params;
    if (!isCardZone(raw.destination) || raw.origin !== undefined && !isCardZone(raw.origin) ||
        raw.libraryPlacement !== undefined && (raw.destination !== 'library' || raw.libraryPlacement !== 'top' && raw.libraryPlacement !== 'bottom')) return [];
    const params = raw as unknown as MoveZoneParameters;
    const mutations: GameMutation[] = [];
    for (const target of effect.targets) {
      if (params.libraryPlacement && ((target.targetType !== 'card' && target.targetType !== 'permanent') || !target.cardUuid)) return [];
      if ((target.targetType === 'permanent' || target.targetType === 'card') && target.cardUuid) {
        const card = params.origin ? findCardInZone(room, target.cardUuid, params.origin) : findTargetCard(room, target);
        if (!card || target.zone !== undefined && target.zone !== card.state.zone ||
            target.zoneRevision !== undefined && target.zoneRevision !== (card.state.zoneRevision ?? 0)) {
          if (params.libraryPlacement) return [];
          continue;
        }
        // Reordering an existing library occupant is a distinct operation.
        if (params.libraryPlacement && card.state.zone === 'library') return [];

        mutations.push({
          type: 'MOVE_CARD',
          cardUuid: card.uuid,
          playerId: card.state.ownerId,
          from: params.origin ?? card.state.zone,
          to: params.destination,
          zoneRevision: card.state.zoneRevision ?? 0,
          ...(params.libraryPlacement ? { libraryPlacement: params.libraryPlacement } : {}),
        });
      } else if ((target.targetType === 'stack' || target.targetType === 'spell') && target.stackUuid) {
        // Counter target spell on stack
        const targetStackObj = room.stack.find(s => s.uuid === target.stackUuid);
        if (targetStackObj && effect.tags.includes('counter')) {
          mutations.push({ type: 'COUNTER_STACK', stackUuid: targetStackObj.uuid });
        }
      }
    }
    if (!params.libraryPlacement) return mutations;
    const groups = new Map<string, Extract<GameMutation, { type: 'MOVE_CARD' }>[]>();
    for (const mutation of mutations) {
      if (mutation.type !== 'MOVE_CARD' || !validateCardMove(room, mutation)) return [];
      const group = groups.get(mutation.playerId) ?? [];
      group.push(mutation);
      groups.set(mutation.playerId, group);
    }
    if (new Set(mutations.map(mutation => mutation.type === 'MOVE_CARD' ? mutation.cardUuid : '')).size !== mutations.length) return [];
    return [...groups.values()].flatMap(group => params.libraryPlacement === 'top' ? group.reverse() : group);
  },

  'DEAL_DAMAGE': (room, stackObj, effect) => {
    const source = resolveSourceInformation(room, stackObj);
    const assignments = effect.targets.flatMap<DamageAssignment>(target => {
      if (target.targetType === 'player' && target.playerId) return [{ source, recipient: { kind: 'player' as const, playerId: target.playerId }, amount: effect.params.amount as number, combat: false }];
      if (target.targetType !== 'permanent' || !target.cardUuid) return [];
      const card = findTargetCard(room, target);
      return card && card.state.zone === 'battlefield' && (target.zoneRevision === undefined || target.zoneRevision === (card.state.zoneRevision ?? 0))
        ? [{ source, recipient: { kind: 'permanent' as const, cardUuid: card.uuid, zoneRevision: card.state.zoneRevision ?? 0 }, amount: effect.params.amount as number, combat: false }] : [];
    });
    return planDamage(room, assignments);
  },
  'MODIFY_LIFE': (room, stackObj, effect) => {
    const params = effect.params as { amount: number };
    if (params.amount < 0 && effect.tags.includes('damage')) {
      return planDamage(room, effect.targets.flatMap(target => target.targetType === 'player' && target.playerId
        ? [{ source: resolveSourceInformation(room, stackObj), recipient: { kind: 'player' as const, playerId: target.playerId }, amount: -params.amount, combat: false }] : []));
    }
    const mutations: GameMutation[] = [];
    for (const target of effect.targets) {
      if (target.targetType === 'player' && target.playerId) {
        const player = room.players[target.playerId];
        if (player) {
          mutations.push({ type: 'SET_LIFE', playerId: target.playerId, amount: player.life + params.amount });
        }
      }
    }
    return mutations;
  },

  'MODIFY_STATS': (room, stackObj, effect) => {
    const rawParams = effect.params as { power?: number; toughness?: number; damage?: number };
    // Resolve dynamic params: use resolve-time values if available, fall back to snapshot params
    const damage = (effect.dynamicParams?.damage as number) ?? rawParams.damage;
    const power = (effect.dynamicParams?.power as number) ?? rawParams.power;
    const toughness = (effect.dynamicParams?.toughness as number) ?? rawParams.toughness;
    const sourceCard = stackObj.source as CardInstance | undefined;
    const source = sourceCard?.uuid ?? 'emblem';
    const mutations: GameMutation[] = [];
    const damageAssignments: DamageAssignment[] = [];
    for (const target of effect.targets) {
      if ((target.targetType === 'permanent' || target.targetType === 'card') && target.cardUuid) {
        const card = findCardOnBattlefield(room, target.cardUuid);
        if (!card) continue;

        if (damage !== undefined) {
          damageAssignments.push({ source: resolveSourceInformation(room, stackObj), recipient: { kind: 'permanent', cardUuid: card.uuid, zoneRevision: card.state.zoneRevision ?? 0 }, amount: damage, combat: false });
        }

        // P/T changes are continuous effects (MTG layer 7), stored in the pool
        // and resolved on-demand by CardCharacteristicService.
        if (power !== undefined) {
          mutations.push({
            type: 'ADD_CONTINUOUS_EFFECT',
            entry: {
              source,
              layer: 7,
              effect: { type: 'STAT_DELTA', power },
              scope: { cardUuid: card.uuid, zoneRevision: card.state.zoneRevision ?? 0 },
              requiredZone: null, sourceControllerId: stackObj.controllerId,
              duration: 'END_OF_TURN',
            },
          });
        }

        if (toughness !== undefined) {
          mutations.push({
            type: 'ADD_CONTINUOUS_EFFECT',
            entry: {
              source,
              layer: 7,
              effect: { type: 'STAT_DELTA', toughness },
              scope: { cardUuid: card.uuid, zoneRevision: card.state.zoneRevision ?? 0 },
              requiredZone: null, sourceControllerId: stackObj.controllerId,
              duration: 'END_OF_TURN',
            },
          });
        }
      }
    }
    return [...planDamage(room, damageAssignments), ...mutations];
  },

  'ADD_COUNTER': (room, stackObj, effect) => {
    const params = effect.params as { counterType: string; amount: number };
    const mutations: GameMutation[] = [];
    for (const target of effect.targets) {
      if ((target.targetType === 'permanent' || target.targetType === 'card') && target.cardUuid) {
        const card = findCardOnBattlefield(room, target.cardUuid);
        if (!card) continue;
        mutations.push({ type: 'ADD_COUNTER', cardUuid: card.uuid, counterType: params.counterType, amount: params.amount, sourceControllerId: stackObj.controllerId, sourceInfo: resolveSourceInformation(room, stackObj) });
      }
    }
    return mutations;
  },

  'REMOVE_COUNTER': (room, stackObj, effect) => {
    const params = effect.params as { counterType: string; amount: number };
    const mutations: GameMutation[] = [];
    for (const target of effect.targets) {
      if ((target.targetType === 'permanent' || target.targetType === 'card') && target.cardUuid) {
        const card = findCardOnBattlefield(room, target.cardUuid);
        if (!card) continue;
        mutations.push({ type: 'REMOVE_COUNTER', cardUuid: card.uuid, counterType: params.counterType, amount: params.amount, sourceControllerId: stackObj.controllerId, sourceInfo: resolveSourceInformation(room, stackObj) });
      }
    }
    return mutations;
  },

  'DESTROY': (room, _stackObj, effect) => {
    const mutations: GameMutation[] = [];
    for (const target of effect.targets) {
      if ((target.targetType === 'permanent' || target.targetType === 'card') && target.cardUuid) {
        const card = findCardOnBattlefield(room, target.cardUuid);
        if (!card) continue;
        mutations.push({
          type: 'DESTROY_CARD',
          cardUuid: card.uuid,
          zoneRevision: card.state.zoneRevision ?? 0,
        });
      }
    }
    return mutations;
  },

  'SACRIFICE': (room, _stackObj, effect) => effect.targets.flatMap(target => {
    const card = target.cardUuid ? room.battlefield.find(c => c.uuid === target.cardUuid) : undefined;
    return card ? [{ type: 'SACRIFICE_CARD' as const, cardUuid: card.uuid, zoneRevision: card.state.zoneRevision ?? 0 }] : [];
  }),

  'TAP': (room, _stackObj, effect) => {
    const mutations: GameMutation[] = [];
    for (const target of effect.targets) {
      if ((target.targetType === 'permanent' || target.targetType === 'card') && target.cardUuid) {
        const card = findCardOnBattlefield(room, target.cardUuid);
        if (card) mutations.push({ type: 'TAP_CARD', cardUuid: card.uuid });
      }
    }
    return mutations;
  },

  'UNTAP': (room, _stackObj, effect) => {
    const mutations: GameMutation[] = [];
    for (const target of effect.targets) {
      if ((target.targetType === 'permanent' || target.targetType === 'card') && target.cardUuid) {
        const card = findCardOnBattlefield(room, target.cardUuid);
        if (card) mutations.push({ type: 'UNTAP_CARD', cardUuid: card.uuid });
      }
    }
    return mutations;
  },

  'DRAW': (room, stackObj, effect) => {
    const params = effect.params as { amount: number };
    return room.players[stackObj.controllerId] ? [{ type: 'DRAW_CARDS', playerId: stackObj.controllerId, amount: params.amount }] : [];
  },

  'ADD_MANA': (room, stackObj, effect) => {
    const player = room.players[stackObj.controllerId];
    const params = effect.params as { color: ManaColor; amount: number };
    return [{ type: 'ADD_MANA', playerId: stackObj.controllerId, color: params.color, amount: params.amount }];
  },

  // Convenience handler: decomposes into individual MOVE_ZONE primitives.
  // Per spec Section 2.3, DISCARD_HAND is replaced by multiple MOVE_ZONE calls.
  'DISCARD_HAND': (room, stackObj, _effect) => {
    const player = room.players[stackObj.controllerId];
    const mutations: GameMutation[] = [];
    for (const card of [...player.hand]) {
      mutations.push({
        type: 'MOVE_CARD',
        cardUuid: card.uuid,
        playerId: card.state.ownerId,
        from: 'hand',
        to: 'graveyard',
        reason: 'discard',
      });
    }
    return mutations;
  },

  'GRANT_STATS': (room, stackObj, effect) => {
    const params = effect.params as { power?: number; toughness?: number };
    const sourceCard = stackObj.source as CardInstance | undefined;
    const source = sourceCard?.uuid ?? 'emblem';
    const mutations: GameMutation[] = [];

    for (const target of effect.targets) {
      // Derive scope from the SAME TargetPointer used by all handlers.
      // Anthem mode (target.all): characteristic scope with filter fields.
      // Single-target mode (target.cardUuid): cardUuid scope.
      if (!target.all && !target.cardUuid) continue;

      const scope: ContinuousEffectEntry['scope'] = target.all
        ? { zones: ['battlefield'], cardTypes: target.cardTypes, subTypes: target.subTypes, controller: target.controller }
        : target.cardUuid
          ? { cardUuid: target.cardUuid, zoneRevision: findCardOnBattlefield(room, target.cardUuid)?.state.zoneRevision ?? 0 }
          : {};

      if (params.power !== undefined) {
        mutations.push({
          type: 'ADD_CONTINUOUS_EFFECT',
          entry: {
            source,
            layer: 7,
            effect: { type: 'STAT_DELTA', power: params.power },
            scope,
            duration: 'END_OF_TURN',
            origin: 'resolved', requiredZone: null, sourceControllerId: stackObj.controllerId,
          },
        });
      }

      if (params.toughness !== undefined) {
        mutations.push({
          type: 'ADD_CONTINUOUS_EFFECT',
          entry: {
            source,
            layer: 7,
            effect: { type: 'STAT_DELTA', toughness: params.toughness },
            scope,
            duration: 'END_OF_TURN',
            origin: 'resolved', requiredZone: null, sourceControllerId: stackObj.controllerId,
          },
        });
      }
    }

    return mutations;
  },

  'SET_STATS': (room, stackObj, effect) => createContinuousEffect(room, stackObj, effect,
    { type: 'SET_STATS', power: effect.params.power as number, toughness: effect.params.toughness as number }),
  'CREATE_CONTINUOUS_EFFECT': (room, stackObj, effect) => createContinuousEffect(room, stackObj, effect,
    effect.params.effect as import('../types/card.types').ContinuousEffect),
};

/** Generic resolved characteristic effect; reducer captures its affected rules objects. */
function createContinuousEffect(room: GameRoom, object: StackObject, effect: StackEffect,
  operation: import('../types/card.types').ContinuousEffect): GameMutation[] {
  if (!operation || !['COPY', 'CONTROL', 'TEXT', 'TYPE', 'COLOR', 'ABILITY', 'SET_STATS', 'STAT_DELTA', 'SWITCH_STATS', 'PERMISSION'].includes(operation.type)) return [];
  const duration = effect.params.duration ?? 'PERMANENT';
  if (!['END_OF_TURN', 'PERMANENT', 'WHILE_ON_BATTLEFIELD', 'WHILE_ATTACHED'].includes(duration as string)) return [];
  return effect.targets.flatMap(target => {
    const card = target.cardUuid ? findTargetCard(room, target) : undefined;
    if (!target.all && !card) return [];
    const scope: ContinuousEffectEntry['scope'] = target.all ? { zones: ['battlefield'], cardTypes: target.cardTypes, subTypes: target.subTypes, controller: target.controller }
      : { cardUuid: card!.uuid, zoneRevision: card!.state.zoneRevision ?? 0 };
    return [{ type: 'ADD_CONTINUOUS_EFFECT' as const, entry: { source: object.source.uuid, sourceRevision: object.source.state.zoneRevision ?? 0,
      origin: 'resolved' as const, sourceControllerId: object.controllerId, requiredZone: effect.params.requiredZone as import('../types/card.types').CardZone | null ?? null,
      layer: 7, effect: structuredClone(operation), scope, duration: duration as ContinuousEffectEntry['duration'] } }];
  });
}
