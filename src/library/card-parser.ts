// src/library/card-parser.ts
import type { CardBlueprint, CardAbility, ActivatedAbility, TriggeredAbility, CardType, CardZone } from '../types/card.types';
import type { ActionCost, EffectPayload, EffectDefinition } from '../types/effect.types';

export function normalizeActionCost(cost: Record<string, unknown> | undefined): ActionCost {
  if (!cost) return { mana: {}, tap: false, life: 0, discard: 0, sacrifice: false };

  return {
    mana: (cost.mana as Record<string, number>) || {},
    tap: !!cost.tap,
    life: typeof cost.life === 'number' ? cost.life : 0,
    discard: typeof cost.discard === 'number' ? cost.discard : 0,
    sacrifice: !!cost.sacrifice,
  };
}

export function normalizeEffect(raw: Record<string, unknown>): EffectDefinition {
  return {
    action: (raw.action as string) || '',
    params: (raw.params as Record<string, unknown>) || {},
    tags: (raw.tags as string[]) || [],
    targeting: (raw.targeting as EffectDefinition['targeting']) || { type: 'self', required: false },
  };
}

export function normalizeAbility(ability: Record<string, unknown>): CardAbility | null {
  if (!ability || typeof ability !== 'object') return null;

  const type = (ability.type as string) || 'activated';
  const effect: EffectPayload = {
    effectId: typeof ability.effectId === 'string' ? ability.effectId.toUpperCase() : '',
    params: (ability.params as Record<string, unknown>) || {},
  };

  const base = {
    effect,
    castSpeed: (ability.castSpeed as 'instant' | 'sorcery') || 'instant',
  };

  if (type === 'triggered') {
    return {
      type: 'triggered',
      triggerCondition: (ability.triggerCondition as TriggeredAbility['triggerCondition']) || 'ON_ENTER_BATTLEFIELD',
      ...base,
    } as TriggeredAbility;
  }

  return {
    type: 'activated',
    cost: normalizeActionCost(ability.cost as Record<string, unknown> | undefined),
    duration: (ability.duration as string) || null,
    ...base,
  } as ActivatedAbility;
}

export function normalizeCard(raw: Record<string, unknown>): CardBlueprint {
  if (!raw.id) {
    throw new Error(`[CardParser] Missing absolute identifier 'id' on card name: ${raw.name}`);
  }

  return {
    id: raw.id as string,
    name: (raw.name as string) || '',
    cardTypes: (raw.cardTypes as CardType[]) || [],
    subTypes: (raw.subTypes as string[]) || [],
    rulesText: (raw.rulesText as string) || '',
    power: raw.power as number | undefined,
    toughness: raw.toughness as number | undefined,

    onCastEffects: (((raw.onCastEffects || raw.onPlay) as Record<string, unknown>[]) || []).map(normalizeEffect),
    onEnterEffects: ((raw.onEnterEffects as Record<string, unknown>[]) || []).map(normalizeEffect),

    castRequirements: {
      allowedZones: (raw.castRequirements as Record<string, unknown>)?.allowedZones as CardZone[] || ['hand'],
      speed: ((raw.castRequirements as Record<string, unknown>)?.speed as 'instant' | 'sorcery') || 'sorcery',
      cost: normalizeActionCost((raw.castRequirements as Record<string, unknown>)?.cost as Record<string, unknown> | undefined),
      condition: ((raw.castRequirements as Record<string, unknown>)?.condition as Record<string, unknown>) || undefined,
    },

    abilities: ((raw.abilities as Record<string, unknown>[]) || [])
      .map(normalizeAbility)
      .filter((a): a is CardAbility => a !== null),
  };
}

export function parseAll(rawMap: Record<string, Record<string, unknown>>): Record<string, CardBlueprint> {
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
  parseAll,
};