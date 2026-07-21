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

  const instance: CardInstance = {
    blueprint,
    uuid: uuidv4(),
    state: {
      zone: 'library',
      ownerId: '',
      controllerId: '',
      isTapped: false,
      summoningSickness: blueprint.cardTypes.includes('Creature'),
      damageTaken: 0,
      counters: {},
    },
  };

  return instance;
}

export default { getBlueprint, instantiateCard };