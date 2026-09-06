// src/engine/effect-registry.ts
import type { GameMutation } from '../types/game-mutation.types';
import type { GameRoom } from '../types/game.room.types';
import type { StackObject, StackEffect } from '../types/effect.types';
import type { ManaColor, CardInstance, ContinuousEffectEntry } from '../types/card.types';

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
    if (zone === 'library') {
      const found = player.deck.find(c => c.uuid === uuid);
      if (found) return found;
    }
  }
  return undefined;
}

export const EffectRegistry: Record<string, EffectHandler> = {

  'MOVE_ZONE': (room, _stackObj, effect) => {
    const params = effect.params as { origin: string; destination: string };
    const mutations: GameMutation[] = [];
    for (const target of effect.targets) {
      if ((target.targetType === 'permanent' || target.targetType === 'card') && target.cardUuid) {
        const card = findCardInZone(room, target.cardUuid, params.origin);
        if (!card) continue;

        mutations.push({
          type: 'MOVE_CARD',
          cardUuid: card.uuid,
          playerId: card.state.ownerId,
          from: params.origin as any,
          to: params.destination as any,
        });
      } else if (target.targetType === 'stack' && target.stackUuid) {
        // Counter target spell on stack
        const targetStackObj = room.stack.find(s => s.uuid === target.stackUuid);
        if (targetStackObj && effect.tags.includes('counter')) {
          mutations.push({ type: 'SET_COUNTERED', stackUuid: targetStackObj.uuid });
        }
      }
    }
    return mutations;
  },

  'MODIFY_LIFE': (room, _stackObj, effect) => {
    const params = effect.params as { amount: number };
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
    for (const target of effect.targets) {
      if ((target.targetType === 'permanent' || target.targetType === 'card') && target.cardUuid) {
        const card = findCardOnBattlefield(room, target.cardUuid);
        if (!card) continue;

        if (damage !== undefined) {
          mutations.push({ type: 'SET_DAMAGE', cardUuid: card.uuid, amount: (card.state.damageTaken || 0) + damage });
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
              scope: { cardUuid: card.uuid },
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
              scope: { cardUuid: card.uuid },
              duration: 'END_OF_TURN',
            },
          });
        }
      }
    }
    return mutations;
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
        ? { cardTypes: target.cardTypes, subTypes: target.subTypes, controller: target.controller }
        : target.cardUuid
          ? { cardUuid: target.cardUuid }
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
          },
        });
      }
    }

    return mutations;
  },
};