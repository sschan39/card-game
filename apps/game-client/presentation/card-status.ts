import type { CardView } from '@card-game/protocol';

export function showsSummoningSickness(card: CardView): boolean {
  return card.state.zone === 'battlefield' && card.cardTypes.includes('Creature') &&
    card.state.summoningSickness && !card.keywords.includes('Haste');
}
