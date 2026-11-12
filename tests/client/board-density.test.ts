import { describe, expect, it } from 'vitest';
import {
  BASE_MAX_CARD_WIDTH,
  CAPTION_HEIGHT,
  COMFORTABLE_STEP,
  MIN_CARD_WIDTH,
  READABLE_STEP,
  boardCardWidth,
  planDensity,
} from '@client/layout/density';

/**
 * The board's one non-negotiable rule: a card never shrinks to make room.
 * When a row runs out of width the cards overlap, then wrap, then scroll —
 * they do not get smaller. These tests pin that rule down.
 */
describe('battlefield density', () => {
  describe('planDensity', () => {
    it('lays out a comfortable row without overlap when there is room', () => {
      const plan = planDensity({ count: 4, availableWidth: 900, cardWidth: 140 });
      expect(plan.mode).toBe('normal');
      expect(plan.scroll).toBe(false);
      expect(plan.rows).toHaveLength(1);
      expect(plan.rows[0]).toMatchObject({ start: 0, count: 4, step: 150 });
    });

    it('never reports a card narrower than the width it was given', () => {
      for (const count of [1, 2, 5, 9, 17, 40, 120]) {
        for (const availableWidth of [0, 120, 480, 1280, 2560]) {
          const plan = planDensity({ count, availableWidth, cardWidth: 140 });
          expect(plan.cardWidth).toBe(140);
        }
      }
    });

    it('overlaps rather than shrinks once the row is full', () => {
      // 10 cards at 140px need 1490px; give it 1000px.
      const plan = planDensity({ count: 10, availableWidth: 1000, cardWidth: 140 });
      expect(plan.mode).toBe('dense');
      expect(plan.rows).toHaveLength(1);
      expect(plan.rows[0].step).toBeLessThan(140);
      expect(plan.rows[0].step).toBeGreaterThanOrEqual(140 * COMFORTABLE_STEP);
    });

    it('drops to crowded once the exposed strip falls below the comfort threshold', () => {
      // 900px leaves a 0.60 step: still readable, no longer comfortable.
      const plan = planDensity({ count: 10, availableWidth: 900, cardWidth: 140 });
      expect(plan.mode).toBe('crowded');
      expect(plan.rows[0].step).toBeGreaterThanOrEqual(140 * READABLE_STEP);
    });

    it('keeps at least the readable strip exposed before wrapping', () => {
      const plan = planDensity({ count: 8, availableWidth: 700, cardWidth: 140 });
      for (const row of plan.rows) {
        expect(row.step).toBeGreaterThanOrEqual(140 * READABLE_STEP);
      }
    });

    it('wraps onto a second row when one row would be unreadable', () => {
      // 20 cards in 700px: a single row would leave 29px per card, below the floor.
      const plan = planDensity({ count: 20, availableWidth: 700, cardWidth: 140 });
      expect(plan.rows.length).toBeGreaterThan(1);
      expect(plan.rows.reduce((total, row) => total + row.count, 0)).toBe(20);
      for (const row of plan.rows) {
        expect(row.step).toBeGreaterThanOrEqual(140 * READABLE_STEP);
      }
    });

    it('falls back to the readability floor and scrolls when nothing else fits', () => {
      const plan = planDensity({ count: 60, availableWidth: 400, cardWidth: 140 });
      expect(plan.mode).toBe('extreme');
      expect(plan.scroll).toBe(true);
      for (const row of plan.rows) {
        expect(row.step).toBeCloseTo(140 * READABLE_STEP, 5);
      }
    });

    it('covers every card exactly once across all rows', () => {
      for (const count of [1, 2, 3, 7, 8, 15, 16, 30, 31, 100]) {
        const plan = planDensity({ count, availableWidth: 640, cardWidth: 140 });
        const covered = plan.rows.flatMap((row) =>
          Array.from({ length: row.count }, (_, index) => row.start + index),
        );
        expect(covered).toEqual(Array.from({ length: count }, (_, index) => index));
      }
    });

    it('lays out without overlap before the board has been measured', () => {
      const plan = planDensity({ count: 6, availableWidth: 0, cardWidth: 140 });
      expect(plan.mode).toBe('normal');
      expect(plan.scroll).toBe(false);
      expect(plan.rows[0].step).toBeGreaterThan(140);
    });

    it('returns no rows for an empty group', () => {
      expect(planDensity({ count: 0, availableWidth: 900, cardWidth: 140 }).rows).toEqual([]);
    });

    it('gives a lone permanent the full card width', () => {
      const plan = planDensity({ count: 1, availableWidth: 900, cardWidth: 140 });
      expect(plan.rows).toEqual([{ start: 0, count: 1, step: 0, width: 140 }]);
    });
  });

  describe('boardCardWidth', () => {
    it('allows the wide frontline to favor larger cards before using overlap', () => {
      expect(boardCardWidth({ width: 720, height: 220, columns: 6 })).toBe(120);
    });
    it('grows the card as the board grows', () => {
      const small = boardCardWidth({ width: 900, height: 220 });
      const large = boardCardWidth({ width: 1920, height: 420 });
      expect(large).toBeGreaterThan(small);
    });

    it('never returns less than the readable floor', () => {
      for (const width of [0, 40, 200, 640]) {
        for (const height of [0, 30, 90, 200]) {
          expect(boardCardWidth({ width, height })).toBeGreaterThanOrEqual(MIN_CARD_WIDTH);
        }
      }
    });

    it('caps the card so a wide screen does not produce a giant card', () => {
      expect(boardCardWidth({ width: 3840, height: 1600 })).toBeLessThanOrEqual(200);
    });

    it('honours an explicit ceiling', () => {
      expect(boardCardWidth({ width: 1920, height: 900, max: 120 })).toBeLessThanOrEqual(120);
    });

    it('sizes from height when the board is short and wide', () => {
      // A short half cannot fit a tall card, so height wins over width.
      const short = boardCardWidth({ width: 1920, height: 150 });
      const tall = boardCardWidth({ width: 1920, height: 400 });
      expect(short).toBeLessThan(tall);
    });

    it('stays at or above the default ceiling on a typical laptop', () => {
      expect(boardCardWidth({ width: 1440, height: 320 })).toBeGreaterThanOrEqual(BASE_MAX_CARD_WIDTH);
    });

    it('divides the half height between the bands that share it', () => {
      // Two bands cannot both be sized as if each owned the whole half.
      const one = boardCardWidth({ width: 1440, height: 400, bands: 1 });
      const two = boardCardWidth({ width: 1440, height: 400, bands: 2 });
      expect(two).toBeLessThan(one);
    });

    it('keeps every band inside the half it shares', () => {
      // The whole point of the band count: the cards it sizes must actually
      // fit, captions included, or the lower band gets clipped.
      for (const bands of [1, 2, 3, 4, 5, 6]) {
        for (const height of [180, 260, 400, 620]) {
          const width = boardCardWidth({ width: 1440, height, bands });
          const needed = bands * (CAPTION_HEIGHT + (width * 7) / 5);
          if (width > MIN_CARD_WIDTH) {
            expect(needed).toBeLessThanOrEqual(height + 1);
          } else {
            // The readability floor is non-negotiable, so a half that cannot
            // fit every band at the floor scrolls instead of shrinking further.
            expect(width).toBe(MIN_CARD_WIDTH);
          }
        }
      }
    });

    it('scrolls rather than shrinking below the floor when bands cannot fit', () => {
      // Six bands in a 180px half cannot fit at the floor, so the card stays
      // at the floor and the half is expected to scroll.
      const width = boardCardWidth({ width: 1440, height: 180, bands: 6 });
      expect(width).toBe(MIN_CARD_WIDTH);
      const needed = 6 * (CAPTION_HEIGHT + (width * 7) / 5);
      expect(needed).toBeGreaterThan(180);
    });

    it('treats a missing band count as a single band', () => {
      expect(boardCardWidth({ width: 1440, height: 400 })).toBe(
        boardCardWidth({ width: 1440, height: 400, bands: 1 }),
      );
    });
  });
});
