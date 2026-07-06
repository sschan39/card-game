// src/library/CardFactory.ts
import rawCardData from '../../data/card_data.json';
import CardParser from './card-parser';
import type { CardBlueprint, CardInstance, CardState } from '../types/card.types';
import { v4 as uuidv4 } from 'uuid';

type BlueprintCache = Record<string, CardBlueprint>;

const blueprintCache: BlueprintCache = {};

export function getBlueprint(cardId: string): CardBlueprint {
  const raw = (rawCardData as Record<string, any>)[cardId];
  if (!raw) {
    throw new Error(`[CardFactory] No raw card data found for ID: ${cardId}`);
  }
  
  if (!blueprintCache[cardId]) {
    blueprintCache[cardId] = CardParser.normalizeCard(raw);
  }
  return blueprintCache[cardId];
}

export function instantiateCard(cardId: string): CardInstance  {
  const blueprint = getBlueprint(cardId);
  if (!blueprint) {
    throw new Error(`[CardFactory] Blueprint generation failed for ID: ${cardId}`);
  }

  // Pure deep clone of abilities, ensuring internal mana records exist
  const abilities = blueprint.abilities.map((a: any) => ({ 
    ...a, 
    cost: { 
      ...a.cost,
      mana: { ...(a.cost?.mana || {}) } 
    } 
  }));

  // Resolve the optional cost object. If undefined (no-cost card), provide a zero-cost structure.
  const rawCost = blueprint.castRequirements.cost || { mana: {} };
  const rawMana = rawCost.mana || {};

  // Pure deep clone of strict ActionRequirements properties
  const castRequirements = {
    ...blueprint.castRequirements,
    allowedZones: [...blueprint.castRequirements.allowedZones],
    cost: {
      ...rawCost,
      mana: { ...rawMana }
    },
    condition: blueprint.castRequirements.condition 
      ? { ...blueprint.castRequirements.condition } 
      : undefined
  };

  const instance: CardInstance = {
    ...blueprint,
    uuid: uuidv4(),
    castRequirements,
    abilities,
    state: {
      zone: 'library',
      isTapped: false,
      summoningSickness: blueprint.cardTypes.some(t => String(t).toLowerCase() === 'creature'),
      damageTaken: 0,
      counters: {}
    } as CardState
  } as unknown as CardInstance;

  return instance;
}

export const cards = new Proxy({}, {
  get(target, prop) {
    if (typeof prop !== 'string') return Reflect.get(target, prop);
    if (prop === 'rawCardData') return rawCardData;
    if (prop === 'instantiateCard') return instantiateCard;
    return instantiateCard(prop);
  }
});

export default { getBlueprint, instantiateCard, cards };