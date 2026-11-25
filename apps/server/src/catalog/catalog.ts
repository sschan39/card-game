import { CatalogCardSchema, DECK_RULES, type CatalogCard } from '@card-game/protocol';
import { getBlueprint, getCardIds } from './card-catalog';
import type { CardBlueprint } from '@card-game/engine/types/card.types';
import { deckEligibility, DeckEligibilitySchema, type DeckEligibility } from '@card-game/protocol';

function printedMana(card: CardBlueprint): string {
  const cost = card.castRequirements.cost?.mana, symbols: string[] = [];
  if (cost?.generic !== undefined) symbols.push('{' + (typeof cost.generic === 'number' ? cost.generic : cost.generic.numeric.kind === 'binding' ? cost.generic.numeric.name : 'Variable') + '}');
  for (const [color, glyph] of [['white','W'],['blue','U'],['black','B'],['red','R'],['green','G'],['yellow','Y']] as const)
    for (let count = 0; count < (cost?.[color] ?? 0); count++) symbols.push('{' + glyph + '}');
  return symbols.join('');
}

// Owned config compiles the shared builder/server policy; overlapping or unknown exceptions fail closed.
export function buildCatalog(policy: DeckEligibility = deckEligibility): ReadonlyMap<string, CatalogCard> {
  policy = DeckEligibilitySchema.parse(policy);
  const unlimited = new Set(policy.unlimitedCopies), fixtures = new Set(policy.excludedCards);
  const retired = new Set(policy.retiredCards);
  const ids = getCardIds(), known = new Set(ids);
  const unknown = [...new Set([...unlimited, ...fixtures, ...retired, ...Object.keys(policy.copyLimits)])].filter(id => !known.has(id));
  if (unknown.length) throw new Error('Invalid deck eligibility configuration: unknown cards ' + unknown.join(', '));
  if ([...unlimited].some(id => fixtures.has(id) || id in policy.copyLimits) || Object.keys(policy.copyLimits).some(id => fixtures.has(id))) throw new Error('Invalid deck eligibility configuration');
  return new Map(ids.map(id => {
    const card = getBlueprint(id);
    const view = CatalogCardSchema.parse({ id, name: card.name, cardTypes: [...card.cardTypes], subTypes: [...card.subTypes ?? []],
      rulesText: card.rulesText, manaCost: printedMana(card), colors: [...card.colors ?? []],
      ...(card.power === undefined ? {} : { power: card.power }), ...(card.toughness === undefined ? {} : { toughness: card.toughness }),
      ...(retired.has(id) ? { retired: true } : {}),
      deckLegal: !fixtures.has(id) && !retired.has(id), copyLimit: unlimited.has(id) ? null : policy.copyLimits[id] ?? DECK_RULES.maxCopies });
    return [id, view];
  }));
}
