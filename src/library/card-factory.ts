// src/library/card-factory.ts
import rawCardData from './card_data.json';
import { normalizeCard } from './card-parser';
import type { CardBlueprint, CardInstance } from '../types/card.types';
import { createCardState } from '../shared/card-state';
import { defaultRuntimeContext, type RuntimeContext } from '../shared/runtime-context';

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

export function instantiateCard(
  cardId: string,
  context: Pick<RuntimeContext, 'uuid'> = defaultRuntimeContext,
): CardInstance {
  const blueprint = getBlueprint(cardId);

  const instance: CardInstance = {
    blueprint,
    uuid: context.uuid(),
    state: createCardState(blueprint, '', '', 'library'),
  };

  return instance;
}

export default { getBlueprint, instantiateCard };
