// src/engine/effect-registry.ts
import type { GameMutation } from '../types/game-mutation.types';
import type { GameRoom } from '../types/game.room.types';
import type { StackObject, StackEffect } from '../types/effect.types';
import type { ManaColor, CardInstance } from '../types/card.types';
import { currentPower } from './power-toughness';

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

  'MODIFY_LIFE': (room, stackObj, effect) => {
    const params = effect.params as { amount: number };
    const mutations: GameMutation[] = [];

    // Combat blocking: an attack tagged 'combat' that has an assigned blocker
    // (room.combat[stackObj.uuid]) deals damage to the blocker instead of the
    // face player, and the blocker deals its power back to the attacker. Lethal
    // damage destroys creatures via the round-9 state-based action. Unblocked
    // (no assignment) attacks fall through to the normal face-damage path.
    const blockerUuid = (effect.tags.includes('combat') && stackObj.uuid)
      ? room.combat?.[stackObj.uuid]
      : undefined;
    if (blockerUuid) {
      const blocker = room.battlefield.find(c => c.uuid === blockerUuid);
      const attacker = room.battlefield.find(c => c.uuid === (stackObj.source as any)?.uuid);
      if (blocker && attacker) {
        // Attacker damages blocker (using current, buffed power).
        mutations.push({
          type: 'SET_DAMAGE',
          cardUuid: blocker.uuid,
          amount: (blocker.state.damageTaken || 0) + currentPower(attacker),
        });
        // Blocker damages attacker back (using current, buffed power).
        mutations.push({
          type: 'SET_DAMAGE',
          cardUuid: attacker.uuid,
          amount: (attacker.state.damageTaken || 0) + currentPower(blocker),
        });
        return mutations;
      }
    }

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

  'MODIFY_STATS': (room, _stackObj, effect) => {
    const rawParams = effect.params as { power?: number; toughness?: number; damage?: number };
    // Resolve dynamic params: use resolve-time values if available, fall back to snapshot params
    const damage = (effect.dynamicParams?.damage as number) ?? rawParams.damage;
    const power = (effect.dynamicParams?.power as number) ?? rawParams.power;
    const toughness = (effect.dynamicParams?.toughness as number) ?? rawParams.toughness;
    const mutations: GameMutation[] = [];
    for (const target of effect.targets) {
      if ((target.targetType === 'permanent' || target.targetType === 'card') && target.cardUuid) {
        const card = findCardOnBattlefield(room, target.cardUuid);
        if (!card) continue;

        if (damage !== undefined) {
          mutations.push({ type: 'SET_DAMAGE', cardUuid: card.uuid, amount: (card.state.damageTaken || 0) + damage });
        }
        // Apply P/T bonuses/debuffs (params.power / params.toughness are deltas
        // added to the current effective stat). Negative values debuff.
        if (power !== undefined || toughness !== undefined) {
          mutations.push({
            type: 'SET_POWER_TOUGHNESS',
            cardUuid: card.uuid,
            powerMod: (card.state.powerMod ?? 0) + (power ?? 0),
            toughnessMod: (card.state.toughnessMod ?? 0) + (toughness ?? 0),
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
};