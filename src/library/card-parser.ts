// src/library/CardParser.ts
import type { CardBlueprint, ActionCost } from '../types/card.types';

export function normalizeActionCost(cost: any): ActionCost {
  // If no cost block was specified at all, return an explicit zero-mana dictionary
  if (!cost) return { mana: {}, tap: false, life: 0, discard: 0, sacrifice: false };

  return {
    mana: cost.mana || {},
    tap: !!cost.tap,
    life: typeof cost.life === 'number' ? cost.life : 0,
    discard: typeof cost.discard === 'number' ? cost.discard : 0,
    sacrifice: !!cost.sacrifice
  };
}

export function normalizeAbility(ability: any): any {
  if (!ability || typeof ability !== 'object') return null;

  return {
    type: ability.type || 'activated',
    cost: normalizeActionCost(ability.cost),
    effectId: typeof ability.effectId === 'string' ? ability.effectId.toUpperCase() : undefined,
    params: ability.params || {},
    duration: ability.duration
  };
}

export function normalizeCard(raw: any): CardBlueprint {
  if (!raw.id) {
    throw new Error(`[CardParser] Missing absolute identifier 'id' on card name: ${raw.name}`);
  }

  return {
    id: raw.id,
    name: raw.name || '',
    cardTypes: raw.cardTypes || [],
    subTypes: raw.subTypes || [],
    rulesText: raw.rulesText || '',
    power: raw.power,
    toughness: raw.toughness,
    onPlayEffect: raw.onPlayEffect || null,
    
    castRequirements: {
      allowedZones: raw.castRequirements?.allowedZones || ['Hand'],
      speed: raw.castRequirements?.speed || 'sorcery',
      cost: normalizeActionCost(raw.castRequirements?.cost),
      condition: raw.castRequirements?.condition || null
    },

    abilities: (raw.abilities || [])
      .map(normalizeAbility)
      .filter(Boolean)
  };
}

export function parseAll(rawMap: Record<string, any>): Record<string, CardBlueprint> {
  const out: Record<string, CardBlueprint> = {};
  Object.keys(rawMap).forEach(k => {
    out[k] = normalizeCard(rawMap[k]);
  });
  return out;
}

export default {
  normalizeActionCost,
  normalizeAbility,
  normalizeCard,
  parseAll
};