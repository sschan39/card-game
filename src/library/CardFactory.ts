// src/library/CardFactory.ts
import rawCardData from '../../data/card_data.json';
import CardParser from './CardParser';
import type { CardBlueprint, CardInstance, CardState } from '../types/card.types';
import { v4 as uuidv4 } from 'uuid';


type BlueprintCache = Record<string, CardBlueprint>;

const blueprintCache: BlueprintCache = {};

export function getBlueprint(cardId: string): CardBlueprint | undefined {
  const raw = (rawCardData as Record<string, any>)[cardId];
  if (!raw) return undefined;
  if (!blueprintCache[cardId]) {
    blueprintCache[cardId] = CardParser.normalizeCard(raw) as CardBlueprint;
  }
  return blueprintCache[cardId];
}

export function instantiateCard(cardId: string): CardInstance | undefined {
  const blueprint = getBlueprint(cardId);
  if (!blueprint) return undefined;

  // Create a shallow/deep clone for live instance
  const abilities = (blueprint.abilities || []).map((a: any) => ({ ...a, cost: { ...(a.cost || {}) } }));

  const instance: CardInstance = {
    ...blueprint,
    uuid: uuidv4(),
    manaCost: { ...(blueprint.manaCost || {}) },
    abilities,
    state: {
      zone: 'library',
      isTapped: false,
      summoningSickness: Array.isArray(blueprint.cardTypes) && blueprint.cardTypes.some(t => String(t).toLowerCase() === 'creature'),
      damageTaken: 0,
      counters: {}
    } as CardState
  } as CardInstance;

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
