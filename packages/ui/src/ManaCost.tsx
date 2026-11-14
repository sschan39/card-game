const STYLES = ['gem', 'crystal', 'outline', 'seal', 'glyph'] as const;
export type ManaStyle = (typeof STYLES)[number];

/** Colour runes this game prints inside a cost. Everything else is generic mana. */
const RUNES = new Set(['W', 'U', 'B', 'R', 'G', 'Y']);

/**
 * Split `{U}{U}{1}` into `['U', 'U', '1']`.
 *
 * The cost is not a sentence — it is a row of runes, so the card face has to draw it
 * rune by rune instead of printing the braces as text.
 */
export function manaTokens(cost: string): string[] {
  return [...cost.matchAll(/\{([^}]+)\}/g)].map((match) => match[1].toUpperCase());
}

/** Which of the five treatments the page asked for via `?mana=1..5`, or the original
 *  pre-redesign face via `?mana=0`. */
function currentStyle(): ManaStyle | 'original' {
  const value = typeof document === 'undefined' ? '' : document.documentElement.dataset.manaStyle ?? '';
  if (value === 'original') return 'original';
  return (STYLES as readonly string[]).includes(value) ? (value as ManaStyle) : 'gem';
}

/**
 * Read the style from the URL once and park it on the root element, so every mana row
 * on the page follows without threading a prop through the card components.
 */
export function applyManaStyleFromUrl(): void {
  if (typeof document === 'undefined') return;
  const raw = new URLSearchParams(window.location.search).get('mana');
  /* `?mana=0` is the escape hatch: it restores the plain `{U}{U}` text face exactly as
     it looked before the rune icons, for side-by-side comparison. */
  const style = raw !== null && Number(raw) === 0 ? 'original' : STYLES[Number(raw) - 1] ?? 'gem';
  document.documentElement.dataset.manaStyle = style;
}

/** A cost rendered as a row of rune icons instead of the raw `{U}{R}` text. */
export function ManaCost({ cost }: { cost: string }) {
  const tokens = manaTokens(cost);
  if (tokens.length === 0) return null;
  const style = currentStyle();
  if (style === 'original') return <div className="card-mana">{cost}</div>;
  /* Repeated runes collapse into one badge plus a multiplier, so eight `{U}` read as
     `U ×8` instead of eight identical circles crowding the name strip. */
  const counts = new Map<string, number>();
  for (const token of tokens) counts.set(token, (counts.get(token) ?? 0) + 1);
  return (
    <span className="mana-cost" data-style={style}>
      {[...counts].map(([token, count]) => (
        <span className="mana-group" key={token}>
          <span className="mana-icon" data-color={RUNES.has(token) ? token : 'generic'}>{token}</span>
          {count > 1 && <span className="mana-count">×{count}</span>}
        </span>
      ))}
    </span>
  );
}
