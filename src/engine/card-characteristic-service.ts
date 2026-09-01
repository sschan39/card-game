// src/engine/card-characteristic-service.ts
// Characteristic resolution service — the query facade for card P/T.
// Folds the ContinuousEffectPool through a 4-step pipeline:
//   ① locateSource — resolve source card ONCE
//   ② hasValidSourceZone — validate source's zone
//   ③ matchesScope — does this entry affect this card?
//   ④ fold — sum STAT_DELTA deltas
//
// Layer ordering (MTG layer 7 subset):
//   1. SET_STATS (base overwrite)  — declared but no handler yet
//   2. STAT_DELTA (additive)       — applied here
//   3. Counters (+1/+1)            — always last

import type { GameRoom } from '../types/game.room.types';
import type { CardInstance, CardZone, ContinuousEffectEntry } from '../types/card.types';

// -- Public API --

export const CardCharacteristicService = {
  resolvePower(room: GameRoom, card: CardInstance): number {
    const base = card.blueprint.power ?? 0;
    const deltas = resolveLayer7Deltas(room, card, 'power');
    const fromCounters = card.state.counters['+1/+1'] ?? 0;
    return base + deltas + fromCounters;
  },

  resolveToughness(room: GameRoom, card: CardInstance): number {
    const base = card.blueprint.toughness ?? 0;
    const deltas = resolveLayer7Deltas(room, card, 'toughness');
    const fromCounters = card.state.counters['+1/+1'] ?? 0;
    return base + deltas + fromCounters;
  },
};

// -- Pipeline --

function resolveLayer7Deltas(room: GameRoom, card: CardInstance, key: 'power' | 'toughness'): number {
  return room.continuousEffectPool
    .map(entry => ({ entry, sourceCard: locateSource(room, entry) }))   // ①
    .filter(({ entry, sourceCard }) => hasValidSourceZone(entry, sourceCard))  // ②
    .filter(({ entry, sourceCard }) => matchesScope(entry.scope, card, sourceCard))  // ③
    .filter(({ entry }) => entry.effect.type === 'STAT_DELTA')
    .reduce((sum, { entry }) => sum + (entry.effect[key] ?? 0), 0);     // ④
}

// -- Step ①: Source resolution --

function locateSource(room: GameRoom, entry: ContinuousEffectEntry): CardInstance | undefined {
  if (entry.source === 'emblem' || entry.source === 'global') return undefined;
  const zone = entry.requiredZone ?? 'battlefield';
  return findCardInZone(room, entry.source, zone);
}

function findCardInZone(room: GameRoom, uuid: string, zone: CardZone): CardInstance | undefined {
  switch (zone) {
    case 'battlefield':
      return room.battlefield.find(c => c.uuid === uuid);
    case 'stack':
      return (room.stack.find(s => (s.source as CardInstance).uuid === uuid)?.source as CardInstance) ?? undefined;
    case 'hand':
    case 'graveyard':
    case 'library':
      for (const player of Object.values(room.players)) {
        const arr = zone === 'hand' ? player.hand
          : zone === 'graveyard' ? player.graveyard
          : player.deck;
        const found = arr.find(c => c.uuid === uuid);
        if (found) return found;
      }
      return undefined;
    default:
      return undefined;
  }
}

// -- Step ②: Source zone validation --

function hasValidSourceZone(entry: ContinuousEffectEntry, sourceCard: CardInstance | undefined): boolean {
  if (entry.source === 'emblem' || entry.source === 'global') return true;
  return sourceCard !== undefined;
  // future: && !sourceCard.state.silenced
}

// -- Step ③: Scope matching --

function matchesScope(
  scope: ContinuousEffectEntry['scope'],
  card: CardInstance,
  sourceCard: CardInstance | undefined
): boolean {
  // Single-card target
  if (scope.cardUuid && card.uuid !== scope.cardUuid) return false;
  // Characteristic-based matching
  if (scope.cardTypes?.length && !scope.cardTypes.some(t => card.blueprint.cardTypes.includes(t))) return false;
  if (scope.subTypes?.length && !scope.subTypes.some(s => (card.blueprint.subTypes || []).includes(s))) return false;
  // Controller-relative (resolved against source's controller)
  if (scope.controller === 'self' && sourceCard && card.state.controllerId !== sourceCard.state.controllerId) return false;
  if (scope.controller === 'opponent' && sourceCard && card.state.controllerId === sourceCard.state.controllerId) return false;
  return true;
}