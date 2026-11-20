import { describe, expect, it } from 'vitest';
import {
  beginPageLeave,
  endPageLeave,
  fadeThenNavigate,
  isPlainNavigationClick,
  isSameDestination,
  LEAVE_DURATION_MS,
  preloadImage,
} from '@card-game/ui';

/** A window stand-in: the module only touches location, document and the two timers. */
function fakeWindow(href = 'http://localhost/home', reducedMotion = false) {
  const attributes = new Map<string, string>();
  const assigned: string[] = [];
  const timers: Array<() => void> = [];
  const win = {
    location: { href, assign: (target: string) => { assigned.push(target); } },
    document: {
      documentElement: {
        setAttribute: (name: string, value: string) => { attributes.set(name, value); },
        removeAttribute: (name: string) => { attributes.delete(name); },
      },
    },
    matchMedia: () => ({ matches: reducedMotion }),
    setTimeout: (callback: () => void) => { timers.push(callback); return timers.length; },
  } as unknown as Window;
  return { win, attributes, assigned, timers };
}

describe('plain navigation clicks', () => {
  it('claims a primary-button click with no modifier', () => {
    expect(isPlainNavigationClick({ button: 0 })).toBe(true);
    expect(isPlainNavigationClick({})).toBe(true);
  });

  it('leaves new-tab gestures to the browser', () => {
    expect(isPlainNavigationClick({ button: 1 })).toBe(false);
    expect(isPlainNavigationClick({ button: 2 })).toBe(false);
    expect(isPlainNavigationClick({ metaKey: true })).toBe(false);
    expect(isPlainNavigationClick({ ctrlKey: true })).toBe(false);
    expect(isPlainNavigationClick({ shiftKey: true })).toBe(false);
    expect(isPlainNavigationClick({ altKey: true })).toBe(false);
    expect(isPlainNavigationClick({ defaultPrevented: true })).toBe(false);
  });
});

describe('same-destination detection', () => {
  it('ignores trailing slashes and the / ↔ /play alias', () => {
    expect(isSameDestination('/play', 'http://localhost/play')).toBe(true);
    expect(isSameDestination('/play/', 'http://localhost/play')).toBe(true);
    expect(isSameDestination('/', 'http://localhost/play')).toBe(true);
    expect(isSameDestination('/home/', 'http://localhost/home')).toBe(true);
  });

  it('treats a different path or query as a new destination', () => {
    expect(isSameDestination('/home', 'http://localhost/play')).toBe(false);
    expect(isSameDestination('/play?deckId=abc', 'http://localhost/play')).toBe(false);
    expect(isSameDestination('/deck-builder/', 'http://localhost/play')).toBe(false);
  });
});

describe('leaving marker', () => {
  it('sets and clears the document attribute', () => {
    const { win, attributes } = fakeWindow();
    beginPageLeave(win.document);
    expect(attributes.get('data-leaving')).toBe('true');
    endPageLeave(win.document);
    expect(attributes.has('data-leaving')).toBe(false);
  });
});

describe('fadeThenNavigate', () => {
  it('fades first and navigates only after the leave duration', () => {
    const { win, attributes, assigned, timers } = fakeWindow();
    expect(fadeThenNavigate('/play', { button: 0 }, win)).toBe(true);
    expect(attributes.get('data-leaving')).toBe('true');
    expect(assigned).toEqual([]);
    timers.forEach((run) => run());
    expect(assigned).toEqual(['/play']);
    expect(timers).toHaveLength(2);
    expect(LEAVE_DURATION_MS).toBe(160);
  });

  it('restores the page even if the navigation never happens', () => {
    const { win, attributes, timers } = fakeWindow();
    fadeThenNavigate('/play', { button: 0 }, win);
    timers[0]();
    expect(attributes.has('data-leaving')).toBe(false);
  });

  it('does not intercept modifier clicks, the current page or reduced motion', () => {
    const modified = fakeWindow();
    expect(fadeThenNavigate('/home', { ctrlKey: true }, modified.win)).toBe(false);
    expect(modified.attributes.has('data-leaving')).toBe(false);

    const same = fakeWindow();
    expect(fadeThenNavigate('/home', { button: 0 }, same.win)).toBe(false);
    expect(same.attributes.has('data-leaving')).toBe(false);

    const reduced = fakeWindow('http://localhost/home', true);
    expect(fadeThenNavigate('/home', { button: 0 }, reduced.win)).toBe(false);
    expect(reduced.attributes.has('data-leaving')).toBe(false);
  });
});

describe('artwork preload', () => {
  it('resolves without an Image constructor', async () => {
    await expect(preloadImage('/assets/home-hero.webp')).resolves.toBeUndefined();
    await expect(preloadImage('')).resolves.toBeUndefined();
  });
});
