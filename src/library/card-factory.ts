// src/library/card-factory.ts
import rawCardData from '../../data/card_data.json';
import { normalizeCard } from './card-parser';
import type { CardBlueprint, CardInstance, CardState } from '../types/card.types';
import { v4 as uuidv4 } from 'uuid';

type BlueprintCache = Record<string, CardBlueprint>;
const blueprintCache: BlueprintCache = {};

export function getBlueprint(cardId: string): CardBlueprint {
  const raw = (rawCardData as Record<string, unknown>)[cardId] as Record<string, unknown>;
  if (!raw) {
    throw new Error(`[CardFactory] No raw card data found for ID: ${cardId}`);
  }

  if (!blueprintCache[cardId]) {
    blueprintCache[cardId] = normalizeCard(raw);
  }
  return blueprintCache[cardId];
}

export function instantiateCard(cardId: string): CardInstance {
  const blueprint = getBlueprint(cardId);

  // Deep clone abilities to prevent shared references
  const abilities = blueprint.abilities.map(a => {
    if (a.type === 'activated') {
      return {
        ...a,
        cost: { ...a.cost, mana: { ...(a.cost?.mana || {}) } },
      };
    }
    return { ...a };
  });

  // Deep clone castRequirements
  const rawCost = blueprint.castRequirements.cost || { mana: {} };
  const castRequirements = {
    ...blueprint.castRequirements,
    allowedZones: [...blueprint.castRequirements.allowedZones],
    cost: {
      ...rawCost,
      mana: { ...(rawCost.mana || {}) },
    },
    condition: blueprint.castRequirements.condition
      ? { ...blueprint.castRequirements.condition }
      : undefined,
  };

  const instance: CardInstance = {
    ...blueprint,
    uuid: uuidv4(),
    castRequirements,
    abilities,
    state: {
      zone: 'library',
      ownerId: '',
      controllerId: '',
      isTapped: false,
      summoningSickness: blueprint.cardTypes.includes('Creature'),
      damageTaken: 0,
      counters: {},
    } as CardState,
  } as unknown as CardInstance;

  return instance;
}

export default { getBlueprint, instantiateCard };