// src/engine/effect-registry.ts
import { ManaPool } from './mana-pool';
import type { GameRoom } from '../types/game.room.types';
import type { StackObject, StackEffect } from '../types/effect.types';
import type { ManaColor, CardInstance } from '../types/card.types';

export type EffectHandler = (room: GameRoom, stackObj: StackObject, effect: StackEffect) => void;

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

function removeFromZone(room: GameRoom, card: CardInstance, zone: string): void {
  if (zone === 'battlefield') {
    const idx = room.battlefield.findIndex(c => c.uuid === card.uuid);
    if (idx !== -1) room.battlefield.splice(idx, 1);
    return;
  }
  for (const player of Object.values(room.players)) {
    const arr = zone === 'hand' ? player.hand
      : zone === 'graveyard' ? player.graveyard
      : zone === 'library' ? player.deck
      : null;
    if (arr) {
      const idx = arr.findIndex(c => c.uuid === card.uuid);
      if (idx !== -1) { arr.splice(idx, 1); return; }
    }
  }
}

function addToZone(room: GameRoom, card: CardInstance, zone: string): void {
  const ownerId = card.state.controllerId || card.state.ownerId;
  if (zone === 'battlefield') {
    room.battlefield.push(card);
  } else if (zone === 'graveyard') {
    room.players[ownerId]?.graveyard.push(card);
  } else if (zone === 'hand') {
    room.players[ownerId]?.hand.push(card);
  } else if (zone === 'library') {
    room.players[ownerId]?.deck.push(card);
  }
}

export const EffectRegistry: Record<string, EffectHandler> = {

  'MOVE_ZONE': (room, _stackObj, effect) => {
    const params = effect.params as { origin: string; destination: string };
    for (const target of effect.targets) {
      if ((target.targetType === 'permanent' || target.targetType === 'card') && target.cardUuid) {
        const card = findCardInZone(room, target.cardUuid, params.origin);
        if (!card) continue;

        removeFromZone(room, card, params.origin);
        card.state.zone = params.destination as any;
        addToZone(room, card, params.destination);
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
    const rawParams = effect.params as { power?: number; toughness?: number; damage?: number };
    // Resolve dynamic params: use resolve-time values if available, fall back to snapshot params
    const damage = (effect.dynamicParams?.damage as number) ?? rawParams.damage;
    const power = (effect.dynamicParams?.power as number) ?? rawParams.power;
    const toughness = (effect.dynamicParams?.toughness as number) ?? rawParams.toughness;
    for (const target of effect.targets) {
      if ((target.targetType === 'permanent' || target.targetType === 'card') && target.cardUuid) {
        const card = findCardOnBattlefield(room, target.cardUuid);
        if (!card) continue;

        if (damage !== undefined) {
          card.state.damageTaken = (card.state.damageTaken || 0) + damage;
        }
        // TODO: Apply power/toughness modifications via ModifierPipeline.
        // Currently P/T changes (params.power, params.toughness) are silently ignored.
        // Tracked as part of the modifier system implementation (spec Section 8).
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
    ManaPool.add(player.mana, params.color, params.amount);
  },

  // Convenience handler: decomposes into individual MOVE_ZONE primitives.
  // Per spec Section 2.3, DISCARD_HAND is replaced by multiple MOVE_ZONE calls.
  'DISCARD_HAND': (room, stackObj, _effect) => {
    const player = room.players[stackObj.controllerId];
    const cards = [...player.hand];
    for (const card of cards) {
      const idx = player.hand.findIndex(c => c.uuid === card.uuid);
      if (idx !== -1) player.hand.splice(idx, 1);
      card.state.zone = 'graveyard';
      player.graveyard.push(card);
    }
  },
};