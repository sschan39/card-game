import { useEffect, useLayoutEffect, useState } from 'react';

/* ───────────────────────────────────────────────────────────────────────────
   Page entrance and cross-document navigation.

   Home, Play and Decks are three separate documents (two React roots and two
   stylesheets), so every tab click is a full navigation. That makes the entrance
   animation the only transition the player ever sees, and it used to start on
   mount — before the background artwork had decoded and before the first fetch
   had landed. The animation therefore played over an incomplete page and the
   missing pieces popped in afterwards, which read as a flicker.

   The rules implemented here:

   1. The route token (`html[data-route]`) is written before the first paint, so
      the page's own artwork is requested by the very first frame instead of by a
      post-paint effect.
   2. The entrance waits for the page's artwork to decode and for the first data
      to arrive, then runs exactly once. A short ceiling keeps a slow network from
      holding the page hostage; whatever is still missing settles in afterwards.
   3. Leaving a page fades its content out first, then navigates. Modified clicks,
      new-tab links, same-page links and reduced-motion users keep the native
      behaviour untouched.
   ─────────────────────────────────────────────────────────────────────────── */

export type PageRoute = 'home' | 'play' | 'room' | 'decks' | 'admin';

/** Milliseconds the page content takes to fade out before the browser navigates. */
export const LEAVE_DURATION_MS = 160;

/** The attribute the animations hang off; `main` fades to zero while it is set. */
export const LEAVING_ATTRIBUTE = 'data-leaving';

/** How long an entrance may wait for data and artwork before it runs anyway. */
export const ENTRANCE_TIMEOUT_MS = 400;

const decodedArtwork = new Set<string>();

/**
 * Writes the route token. Call it from a module body (before React renders) so the
 * artwork referenced by `html[data-route='…']` is requested by the first paint.
 */
export function setPageRouteToken(route: PageRoute): void {
  if (typeof document === 'undefined') return;
  if (document.documentElement.dataset.route === route) return;
  document.documentElement.dataset.route = route;
}

/** Reads the token the document was loaded with. */
export function readPageRouteToken(): string | undefined {
  if (typeof document === 'undefined') return undefined;
  return document.documentElement.dataset.route;
}

/**
 * Keeps the token in step with an in-app route change (a room id arriving through
 * history.replaceState, for example). A layout effect runs before the browser
 * paints, so the page never shows one frame of the wrong artwork.
 */
export function usePageRouteToken(route: PageRoute): void {
  useLayoutEffect(() => {
    setPageRouteToken(route);
  }, [route]);
}

/**
 * Loads an image and resolves once it can be painted without a decode hitch.
 * Rejections and broken URLs resolve too: a decorative image must never be able
 * to hold the entrance animation hostage.
 */
export function preloadImage(url: string): Promise<void> {
  if (!url || typeof Image === 'undefined') return Promise.resolve();
  if (decodedArtwork.has(url)) return Promise.resolve();
  return new Promise<void>((resolve) => {
    const image = new Image();
    image.decoding = 'async';
    const done = () => {
      decodedArtwork.add(url);
      resolve();
    };
    image.onload = () => {
      if (typeof image.decode === 'function') image.decode().then(done, done);
      else done();
    };
    image.onerror = () => resolve();
    image.src = url;
  });
}

/** True once the artwork in `urls` has decoded (or failed); never rejects. */
export function preloadArtwork(urls: readonly string[] = []): Promise<void> {
  return Promise.all(urls.map(preloadImage)).then(() => undefined);
}

export interface PageEntranceOptions {
  /** The page's first data has arrived (deck list, catalogue, board snapshot). */
  ready: boolean;
  /** Artwork the page paints behind its content; decoded before the fade runs. */
  images?: readonly string[];
  /** Ceiling for the wait. Defaults to {@link ENTRANCE_TIMEOUT_MS}. */
  timeoutMs?: number;
}

/**
 * Gate for the page entrance animation.
 *
 * Returns `false` until the page can be shown complete; the caller renders its
 * skeleton while `false` and marks the content `data-entered` once `true`, which
 * is what starts the single fade-in. The promise chain is deliberately re-armed
 * when `ready` flips, so data that lands early is not wasted.
 */
export function usePageEntrance({ ready, images = [], timeoutMs = ENTRANCE_TIMEOUT_MS }: PageEntranceOptions): boolean {
  const [entered, setEntered] = useState(false);
  const artworkKey = images.join('|');
  /* The ceiling is measured from mount, not from the data: a stalled request must
     not turn the skeleton into the page the player actually reads. Its own effect
     keeps a rising `ready` from restarting the clock. */
  useEffect(() => {
    if (entered) return;
    const ceiling = window.setTimeout(() => setEntered(true), Math.max(0, timeoutMs));
    return () => window.clearTimeout(ceiling);
  }, [entered, timeoutMs]);
  useEffect(() => {
    if (entered || !ready) return;
    let cancelled = false;
    let frame = 0;
    void preloadArtwork(images).then(() => {
      /* One animation frame after the artwork is ready, so the fade starts on a
         frame that already carries the final content. */
      if (!cancelled) frame = window.requestAnimationFrame(() => setEntered(true));
    });
    return () => {
      cancelled = true;
      window.cancelAnimationFrame(frame);
    };
    // `artworkKey` stands in for the array identity so callers can pass literals.
  }, [entered, ready, artworkKey]);
  return entered;
}

/** Click shape shared by DOM and React mouse events; kept structural for tests. */
export interface NavigationClick {
  button?: number;
  metaKey?: boolean;
  ctrlKey?: boolean;
  shiftKey?: boolean;
  altKey?: boolean;
  defaultPrevented?: boolean;
}

/**
 * True for a click this module is allowed to intercept: a plain primary-button
 * click with no modifier. Everything else (middle click, Ctrl/Cmd/Shift/Alt click,
 * an already-handled click) must reach the browser untouched — those gestures are
 * how players open Home, Play and Decks in a new tab.
 */
export function isPlainNavigationClick(click: NavigationClick): boolean {
  if (click.defaultPrevented) return false;
  if (typeof click.button === 'number' && click.button !== 0) return false;
  return !(click.metaKey || click.ctrlKey || click.shiftKey || click.altKey);
}

/** Route aliases: `/` and `/play` are the same lobby; trailing slashes never matter. */
const ROUTE_ALIASES: Record<string, string> = { '/': '/play', '/play': '/play' };

function normaliseDestination(value: string, base: string): string | null {
  try {
    const url = new URL(value, base);
    const path = url.pathname.replace(/\/+$/, '') || '/';
    return url.origin + (ROUTE_ALIASES[path] ?? path) + url.search;
  } catch {
    return null;
  }
}

/**
 * True when `href` points at the document already on screen. Re-navigating to it
 * would replay the entrance for no reason, so the header swallows the click.
 */
export function isSameDestination(href: string, currentHref: string): boolean {
  const target = normaliseDestination(href, currentHref);
  const current = normaliseDestination(currentHref, currentHref);
  return !!target && target === current;
}

function reducedMotion(win: Window): boolean {
  return typeof win.matchMedia === 'function' && win.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** Fades the page content out. Idempotent; safe to call twice in one gesture. */
export function beginPageLeave(doc: Document): void {
  doc.documentElement.setAttribute(LEAVING_ATTRIBUTE, 'true');
}

/** Clears the fade-out marker (bfcache restore, cancelled navigation). */
export function endPageLeave(doc: Document): void {
  doc.documentElement.removeAttribute(LEAVING_ATTRIBUTE);
}

/**
 * Fades the current page out, then navigates. Returns `false` when the gesture
 * belongs to the browser (new tab, modifier click) or the animation is suppressed,
 * in which case the caller must let the native navigation happen.
 */
export function fadeThenNavigate(href: string, click: NavigationClick, win: Window = window): boolean {
  if (!isPlainNavigationClick(click)) return false;
  if (isSameDestination(href, win.location.href)) return false;
  if (reducedMotion(win)) return false;
  beginPageLeave(win.document);
  /* Restore the page if the navigation is cancelled (blocked popup policy, offline,
     a download link): a page stuck at opacity 0 would look broken. */
  win.setTimeout(() => endPageLeave(win.document), 1200);
  win.setTimeout(() => win.location.assign(href), LEAVE_DURATION_MS);
  return true;
}

/**
 * Clears the fade-out marker when a document comes back from the back/forward
 * cache. Without this, pressing Back would restore a page that is still at
 * opacity 0 and the player would face an empty screen.
 */
export function usePageLeaveReset(): void {
  useEffect(() => {
    const restore = () => {
      if (typeof document !== 'undefined') endPageLeave(document);
    };
    window.addEventListener('pageshow', restore);
    window.addEventListener('popstate', restore);
    restore();
    return () => {
      window.removeEventListener('pageshow', restore);
      window.removeEventListener('popstate', restore);
    };
  }, []);
}
