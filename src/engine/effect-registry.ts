// src/engine/effect-registry.ts
import type { GameRoom } from '../types/game.room.types';
import type { StackObject, StackEffect } from '../types/effect.types';
import type { ManaColor, CardInstance } from '../types/card.types';

export type EffectHandler = (room: GameRoom, stackObj: StackObject, effect: StackEffect) => void;

function findCardOnBattlefield(room: GameRoom, uuid: string): CardInstance | undefined {
  return room.battlefield.find(c => c.uuid === uuid);
}

export const EffectRegistry: Record<string, EffectHandler> = {

  'MOVE_ZONE': (room, stackObj, effect) => {
    const params = effect.params as { origin: string; destination: string };
    for (const target of effect.targets) {
      if (target.targetType === 'permanent' && target.cardUuid) {
        const card = findCardOnBattlefield(room, target.cardUuid);
        if (!card) continue;

        // Remove from origin
        if (params.origin === 'battlefield') {
          const idx = room.battlefield.findIndex(c => c.uuid === card.uuid);
          if (idx !== -1) room.battlefield.splice(idx, 1);
        }

        // Add to destination
        card.state.zone = params.destination as any;
        if (params.destination === 'graveyard') {
          const ownerId = card.state.controllerId || card.state.ownerId;
          room.players[ownerId]?.graveyard.push(card);
        } else if (params.destination === 'battlefield') {
          room.battlefield.push(card);
        } else if (params.destination === 'hand') {
          const ownerId = card.state.controllerId || card.state.ownerId;
          room.players[ownerId]?.hand.push(card);
        }
      } else if (target.targetType === 'stack' && target.stackUuid) {
        // Counter target spell on stack
        const targetStackObj = room.stack.find(s => s.uuid === target.stackUuid);
        if (targetStackObj && effect.tags.includes('counter')) {
          targetStackObj.countered = true;
        }
      }
    }
  },

  'MODIFY_LIFE': (room, stackObj, effect) => {
    const params = effect.params as { amount: number };
    for (const target of effect.targets) {
      if (target.targetType === 'player' && target.playerId) {
        const player = room.players[target.playerId];
        if (player) {
          player.life += params.amount;
        }
      }
    }
  },

  'MODIFY_STATS': (room, stackObj, effect) => {
    const params = effect.params as { power?: number; toughness?: number; damage?: number };
    for (const target of effect.targets) {
      if ((target.targetType === 'permanent' || target.targetType === 'card') && target.cardUuid) {
        const card = findCardOnBattlefield(room, target.cardUuid);
        if (!card) continue;

        if (params.damage !== undefined) {
          card.state.damageTaken = (card.state.damageTaken || 0) + params.damage;
        }
        // Power/toughness modifications will go through ModifierPipeline in the future
      }
    }
  },

  'ADD_COUNTER': (room, stackObj, effect) => {
    const params = effect.params as { counterType: string; amount: number };
    for (const target of effect.targets) {
      if ((target.targetType === 'permanent' || target.targetType === 'card') && target.cardUuid) {
        const card = findCardOnBattlefield(room, target.cardUuid);
        if (!card) continue;
        card.state.counters[params.counterType] = (card.state.counters[params.counterType] || 0) + params.amount;
      }
    }
  },

  'REMOVE_COUNTER': (room, stackObj, effect) => {
    const params = effect.params as { counterType: string; amount: number };
    for (const target of effect.targets) {
      if ((target.targetType === 'permanent' || target.targetType === 'card') && target.cardUuid) {
        const card = findCardOnBattlefield(room, target.cardUuid);
        if (!card) continue;
        const current = card.state.counters[params.counterType] || 0;
        card.state.counters[params.counterType] = Math.max(0, current - params.amount);
      }
    }
  },

  'TAP': (room, stackObj, effect) => {
    for (const target of effect.targets) {
      if ((target.targetType === 'permanent' || target.targetType === 'card') && target.cardUuid) {
        const card = findCardOnBattlefield(room, target.cardUuid);
        if (card) card.state.isTapped = true;
      }
    }
  },

  'UNTAP': (room, stackObj, effect) => {
    for (const target of effect.targets) {
      if ((target.targetType === 'permanent' || target.targetType === 'card') && target.cardUuid) {
        const card = findCardOnBattlefield(room, target.cardUuid);
        if (card) card.state.isTapped = false;
      }
    }
  },

  'DRAW': (room, stackObj, effect) => {
    const params = effect.params as { amount: number };
    const player = room.players[stackObj.controllerId];
    const toDraw = Math.min(params.amount, player.deck.length);
    for (let i = 0; i < toDraw; i++) {
      const card = player.deck.pop()!;
      card.state.zone = 'hand';
      player.hand.push(card);
    }
  },

  'ADD_MANA': (room, stackObj, effect) => {
    const player = room.players[stackObj.controllerId];
    const params = effect.params as { color: ManaColor; amount: number };
    player.mana[params.color] = (player.mana[params.color] || 0) + params.amount;
  },
};