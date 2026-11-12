/**
 * Battlefield density engine.
 *
 * Pure functions only — no React, no DOM, no store. The board asks this module
 * how wide a card should be and how far apart neighbours should sit, then
 * renders the answer. Keeping the arithmetic out of the components is what
 * makes crowded boards testable without a browser.
 *
 * The rule the whole file exists to enforce: a card never shrinks below
 * `minCardWidth`. When the row runs out of room the cards start overlapping
 * instead, and once even the overlap is unreadable the row scrolls.
 */

export type DensityMode = 'normal' | 'dense' | 'crowded' | 'extreme';

/** Fraction of a card that must stay uncovered for the card to stay readable. */
export const READABLE_STEP = 0.34;

/** Above this the exposed strip is comfortable, so the row is "dense" not "crowded". */
export const COMFORTABLE_STEP = 0.62;

/** Hard floor. Below this a card face stops being legible at arm's length. */
export const MIN_CARD_WIDTH = 92;

/** Ceiling on a 1440-wide screen; wider screens earn a larger ceiling. */
export const BASE_MAX_CARD_WIDTH = 148;

export interface RowPlan {
  /** Index of the first slot in this row. */
  start: number;
  /** How many slots this row holds. */
  count: number;
  /** Horizontal advance between neighbours, in px. */
  step: number;
  /** Total width the row occupies, in px. */
  width: number;
}

export interface DensityPlan {
  mode: DensityMode;
  cardWidth: number;
  rows: RowPlan[];
  /** True when even the tightest plan overflows and the row must scroll. */
  scroll: boolean;
}

export interface DensityInput {
  count: number;
  availableWidth: number;
  cardWidth: number;
  gap?: number;
  maxRows?: number;
}

function row(start: number, count: number, step: number, cardWidth: number): RowPlan {
  return { start, count, step, width: cardWidth + (count - 1) * step };
}

function split(count: number, rows: number, step: number, cardWidth: number): RowPlan[] {
  const perRow = Math.ceil(count / rows);
  const plans: RowPlan[] = [];
  for (let start = 0; start < count; start += perRow) {
    plans.push(row(start, Math.min(perRow, count - start), step, cardWidth));
  }
  return plans;
}

/**
 * Decide how a group of `count` permanents fits into `availableWidth`.
 *
 * Four tiers, in order of preference:
 *   normal   — every card at full width with a gap between neighbours
 *   dense    — overlapping, but at least 62% of each card stays exposed
 *   crowded  — overlapping down to the 34% readability floor
 *   extreme  — wrapped onto more rows, then scrolled if still too wide
 */
export function planDensity({
  count,
  availableWidth,
  cardWidth,
  gap = 10,
  maxRows = 2,
}: DensityInput): DensityPlan {
  if (count <= 0) return { mode: 'normal', cardWidth, rows: [], scroll: false };

  // Before the first measurement (server render, or the frame before the
  // ResizeObserver fires) lay the cards out without overlap and re-plan later.
  if (!Number.isFinite(availableWidth) || availableWidth <= 0) {
    return { mode: 'normal', cardWidth, rows: [row(0, count, cardWidth + gap, cardWidth)], scroll: false };
  }

  if (count === 1) return { mode: 'normal', cardWidth, rows: [row(0, 1, 0, cardWidth)], scroll: false };

  const comfortable = count * cardWidth + (count - 1) * gap;
  if (comfortable <= availableWidth) {
    return { mode: 'normal', cardWidth, rows: [row(0, count, cardWidth + gap, cardWidth)], scroll: false };
  }

  const single = (availableWidth - cardWidth) / (count - 1);
  if (single >= cardWidth * READABLE_STEP) {
    return {
      mode: single >= cardWidth * COMFORTABLE_STEP ? 'dense' : 'crowded',
      cardWidth,
      rows: [row(0, count, single, cardWidth)],
      scroll: false,
    };
  }

  for (let rows = 2; rows <= Math.max(1, maxRows); rows++) {
    const perRow = Math.ceil(count / rows);
    if (perRow < 2) continue;
    const step = (availableWidth - cardWidth) / (perRow - 1);
    if (step >= cardWidth * READABLE_STEP) {
      return {
        mode: step >= cardWidth * COMFORTABLE_STEP ? 'dense' : 'crowded',
        cardWidth,
        rows: split(count, rows, step, cardWidth),
        scroll: false,
      };
    }
  }

  const plans = split(count, Math.max(1, maxRows), cardWidth * READABLE_STEP, cardWidth);
  return { mode: 'extreme', cardWidth, rows: plans, scroll: plans.some((plan) => plan.width > availableWidth) };
}

export interface BoardWidthInput {
  /** Width of the whole battlefield, in px. */
  width: number;
  /** Height of one player's half of the battlefield, in px. */
  height: number;
  /**
   * How many category bands share that height. A half holding creatures and
   * lands has to fit two captions and two rows, so each band gets half the
   * height. Defaults to 1, which reproduces the single-band sizing exactly.
   */
  bands?: number;
  /** Number of cards the lane aims to fit across before density planning. */
  columns?: number;
  min?: number;
  max?: number;
}

/** Vertical room a band caption takes above its row of cards, in px. */
export const CAPTION_HEIGHT = 16;

/**
 * How wide a battlefield card should be for a given board size.
 *
 * Height is the binding constraint on a landscape screen: the board has to fit
 * two permanent rows plus the hand, so the card is sized from the half-height
 * first and only then capped by how many cards should fit across.
 *
 * `bands` divides that height between the category groups actually present, so
 * a half showing creatures and lands does not size both rows as if each owned
 * the whole half. When even the floor cannot fit every band the half scrolls
 * rather than clipping — see `.board-half` in the stylesheet.
 */
export function boardCardWidth({
  width,
  height,
  bands = 1,
  columns = 9,
  min = MIN_CARD_WIDTH,
  max,
}: BoardWidthInput): number {
  const ceiling = max ?? Math.min(200, Math.max(BASE_MAX_CARD_WIDTH, width / 12));
  const perBand = height / Math.max(1, bands);
  const byHeight = ((perBand - CAPTION_HEIGHT) * 5) / 7;
  const byWidth = width / Math.max(1, columns);
  const raw = Math.min(byHeight, byWidth);
  if (!Number.isFinite(raw) || raw <= 0) return min;
  return Math.round(Math.min(Math.max(raw, min), ceiling));
}
