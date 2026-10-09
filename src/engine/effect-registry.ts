// src/engine/effect-registry.ts
import type { GameMutation } from '../types/game-mutation.types';
import { findTargetCard } from '../shared/target-legality';
import type { GameRoom } from '../types/game.room.types';
import type { StackObject, StackEffect } from '../types/effect.types';
import type { ManaColor, CardInstance, ContinuousEffectEntry, TriggeredAbility } from '../types/card.types';
import { resolveSourceInformation } from './source-information';
import { planDamage } from './damage-service';
import type { DamageAssignment } from '../types/damage.types';

export type EffectHandler = (room: GameRoom, stackObj: StackObject, effect: StackEffect) => GameMutation[];

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
  'CREATE_DELAYED_TRIGGER': (room, stackObj, effect) => {
    const ability = effect.params.ability as TriggeredAbility | undefined;
    const lifetime = effect.params.lifetime ?? 'once';
    if (!ability || ability.type !== 'triggered' || !ability.triggerCondition || !ability.effect || !['once', 'end_of_turn', 'permanent'].includes(lifetime as string)) return [];
    return [{ type: 'ADD_DELAYED_TRIGGER', registration: { id: '', source: structuredClone(stackObj.source), sourceInfo: resolveSourceInformation(room, stackObj),
      controllerId: stackObj.controllerId, ability: structuredClone(ability), lifetime: lifetime as 'once' | 'end_of_turn' | 'permanent' } }];
  },

  'COUNTER': (room, _stackObj, effect) => effect.targets.filter(target =>
    (target.targetType === 'spell' || target.targetType === 'stack') && room.stack.some(object => object.uuid === target.stackUuid))
    .map(target => ({ type: 'COUNTER_STACK', stackUuid: target.stackUuid! })),

  'MOVE_ZONE': (room, _stackObj, effect) => {
    const params = effect.params as { origin: string; destination: string };
    const mutations: GameMutation[] = [];
    for (const target of effect.targets) {
      if ((target.targetType === 'permanent' || target.targetType === 'card') && target.cardUuid) {
        const card = params.origin ? findCardInZone(room, target.cardUuid, params.origin) : findTargetCard(room, target);
        if (!card) continue;

        mutations.push({
          type: 'MOVE_CARD',
          cardUuid: card.uuid,
          playerId: card.state.ownerId,
          from: (params.origin ?? card.state.zone) as any,
          to: params.destination as any,
        });
      } else if ((target.targetType === 'stack' || target.targetType === 'spell') && target.stackUuid) {
        // Counter target spell on stack
        const targetStackObj = room.stack.find(s => s.uuid === target.stackUuid);
        if (targetStackObj && effect.tags.includes('counter')) {
          mutations.push({ type: 'COUNTER_STACK', stackUuid: targetStackObj.uuid });
        }
      }
    }
    return mutations;
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

  'ADD_COUNTER': (room, _stackObj, effect) => {
    const params = effect.params as { counterType: string; amount: number };
    const mutations: GameMutation[] = [];
    for (const target of effect.targets) {
      if ((target.targetType === 'permanent' || target.targetType === 'card') && target.cardUuid) {
        const card = findCardOnBattlefield(room, target.cardUuid);
        if (!card) continue;
        mutations.push({ type: 'ADD_COUNTER', cardUuid: card.uuid, counterType: params.counterType, amount: params.amount });
      }
    }
    return mutations;
  },

  'REMOVE_COUNTER': (room, _stackObj, effect) => {
    const params = effect.params as { counterType: string; amount: number };
    const mutations: GameMutation[] = [];
    for (const target of effect.targets) {
      if ((target.targetType === 'permanent' || target.targetType === 'card') && target.cardUuid) {
        const card = findCardOnBattlefield(room, target.cardUuid);
        if (!card) continue;
        mutations.push({ type: 'REMOVE_COUNTER', cardUuid: card.uuid, counterType: params.counterType, amount: params.amount });
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
          type: 'MOVE_CARD',
          cardUuid: card.uuid,
          playerId: card.state.ownerId,
          from: 'battlefield',
          to: 'graveyard',
        });
      }
    }
    return mutations;
  },

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
    const player = room.players[stackObj.controllerId];
    const toDraw = Math.min(params.amount, player.deck.length);
    const mutations: GameMutation[] = [];
    for (let i = 0; i < toDraw; i++) {
      const card = player.deck[player.deck.length - 1 - i];
      mutations.push({
        type: 'MOVE_CARD',
        cardUuid: card.uuid,
        playerId: card.state.ownerId,
        from: 'library',
        to: 'hand',
        reason: 'draw',
      });
    }
    return mutations;
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
