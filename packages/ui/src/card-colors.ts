/** The five printed colours plus this game's雷 (yellow), and the colourless default. */
export type CardColor = 'white' | 'blue' | 'black' | 'red' | 'green' | 'yellow' | 'colorless';

const SYMBOLS: Record<string, CardColor> = {
  W: 'white',
  U: 'blue',
  B: 'black',
  R: 'red',
  G: 'green',
  Y: 'yellow',
};

/**
 * Tie-break order. A card that leans equally on two colours must always land the same
 * way, otherwise the same card could change colour between renders.
 */
const ORDER: CardColor[] = ['white', 'blue', 'black', 'red', 'green', 'yellow'];

/**
 * The card's dominant colour, read from its mana symbols.
 *
 * Mana is the only colour information a card view is guaranteed to carry, and it is
 * what the player already associates with the card, so the face is tinted from it
 * rather than from the catalogue's colour list.
 */
export function cardColorFromMana(manaCost: string): CardColor {
  const counts = new Map<CardColor, number>();
  for (const match of manaCost.matchAll(/\{([WUBRGY])\}/gi)) {
    const color = SYMBOLS[match[1].toUpperCase()];
    if (color) counts.set(color, (counts.get(color) ?? 0) + 1);
  }
  if (counts.size === 0) return 'colorless';
  let best: CardColor = 'colorless';
  let bestCount = 0;
  for (const color of ORDER) {
    const count = counts.get(color) ?? 0;
    if (count > bestCount) {
      best = color;
      bestCount = count;
    }
  }
  return best;
}
