import { CatalogCardSchema, DECK_RULES, type CatalogCard } from '@card-game/protocol';
import { getBlueprint, getCardIds } from '@card-game/engine/library/card-catalog';
import type { CardBlueprint } from '@card-game/engine/types/card.types';

function printedMana(card: CardBlueprint): string {
  const cost = card.castRequirements.cost?.mana, symbols: string[] = [];
  if (cost?.generic !== undefined) symbols.push('{' + (typeof cost.generic === 'number' ? cost.generic : cost.generic.numeric.kind === 'binding' ? cost.generic.numeric.name : 'Variable') + '}');
  for (const [color, glyph] of [['white','W'],['blue','U'],['black','B'],['red','R'],['green','G'],['yellow','Y']] as const)
    for (let count = 0; count < (cost?.[color] ?? 0); count++) symbols.push('{' + glyph + '}');
  return symbols.join('');
}

// Explicit project format exceptions. Other lands retain the four-copy limit.
const unlimited = new Set(['land-red']);
const fixtures = new Set(['rock', 'paper', 'scissors', 'choice-practice', 'trigger-probe']);
export function buildCatalog(): ReadonlyMap<string, CatalogCard> {
  return new Map(getCardIds().map(id => {
    const card = getBlueprint(id);
    const view = CatalogCardSchema.parse({ id, name: card.name, cardTypes: [...card.cardTypes], subTypes: [...card.subTypes ?? []],
      rulesText: card.rulesText, manaCost: printedMana(card), colors: [...card.colors ?? []],
      ...(card.power === undefined ? {} : { power: card.power }), ...(card.toughness === undefined ? {} : { toughness: card.toughness }),
      deckLegal: !fixtures.has(id) && !id.endsWith('-fixture'), copyLimit: unlimited.has(id) ? null : DECK_RULES.maxCopies });
    return [id, view];
  }));
}
