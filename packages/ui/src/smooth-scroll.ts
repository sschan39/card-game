/**
 * Inertial wheel scrolling.
 *
 * The algorithm and its numbers come from the snippet the workspace owner supplied:
 * `EASE = 0.075`, `targetScroll += deltaY * 1.0`, a rAF lerp towards the target and
 * `scrollTo({ behavior: 'instant' })` so the browser's own smooth behaviour does not
 * fight it. Resize re-clamps the target, and native scrolls (keyboard, scrollbar,
 * anchor jump) resynchronise both values while the loop is idle.
 *
 * Two guards make it safe in this app:
 *
 * 1. A wheel event over something that scrolls itself — the log drawer's entries, the
 *    card detail panel, the catalogue grid, admin lists — is left to the browser.
 *    Intercepting it would scroll the whole page instead, which is how a page-wide
 *    smooth scroll usually breaks a UI. Form controls are left alone for the same
 *    reason.
 * 2. `prefers-reduced-motion: reduce` disables the whole thing; the page keeps its
 *    native wheel behaviour.
 */

/** Damping: smaller glides longer, larger feels closer to native scrolling. */
const EASE = 0.075;
/** Wheel multiplier; 1.0 is the sensitivity the snippet shipped with. */
const SENSITIVITY = 1.0;
/** Stop once the gap is below half a pixel. */
const SETTLE_PX = 0.5;

const FORM_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT']);

let installed = false;

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** Nearest ancestor (or the target itself) that can scroll in either axis. */
function nearestScrollable(target: EventTarget | null): Element | null {
  let node = target instanceof Element ? target : null;
  while (node && node !== document.body && node !== document.documentElement) {
    const style = getComputedStyle(node);
    const scrollsY = /(auto|scroll)/.test(style.overflowY) && node.scrollHeight > node.clientHeight + 1;
    const scrollsX = /(auto|scroll)/.test(style.overflowX) && node.scrollWidth > node.clientWidth + 1;
    if (scrollsY || scrollsX) return node;
    node = node.parentElement;
  }
  return null;
}

/** True when the browser should own this wheel event. */
function ownsWheel(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  if (FORM_TAGS.has(target.tagName)) return true;
  return nearestScrollable(target) !== null;
}

/**
 * Installs the inertial wheel handler once. Safe to call on every page load; does
 * nothing under `prefers-reduced-motion` or when there is no DOM.
 */
export function installSmoothScroll(): void {
  if (installed || typeof window === 'undefined' || typeof document === 'undefined') return;
  if (prefersReducedMotion()) return;
  installed = true;

  let targetScroll = window.scrollY;
  let currentScroll = window.scrollY;
  let running = false;

  const clamp = (min: number, max: number, value: number) => Math.max(min, Math.min(max, value));
  const maxScroll = () => Math.max(0, document.documentElement.scrollHeight - window.innerHeight);

  const update = () => {
    currentScroll += (targetScroll - currentScroll) * EASE;
    window.scrollTo({ top: currentScroll, left: 0, behavior: 'instant' as ScrollBehavior });
    if (Math.abs(targetScroll - currentScroll) > SETTLE_PX) {
      requestAnimationFrame(update);
      return;
    }
    /* Snap the last fraction so text does not sit on a half-pixel. */
    currentScroll = targetScroll;
    window.scrollTo(0, currentScroll);
    running = false;
  };

  const start = () => {
    if (running) return;
    running = true;
    requestAnimationFrame(update);
  };

  window.addEventListener('wheel', (event) => {
    if (event.ctrlKey || ownsWheel(event.target)) return;
    event.preventDefault();
    targetScroll = clamp(0, maxScroll(), targetScroll + event.deltaY * SENSITIVITY);
    start();
  }, { passive: false });

  window.addEventListener('resize', () => {
    targetScroll = clamp(0, maxScroll(), targetScroll);
  });

  /* A keyboard page-down, a scrollbar drag or an anchor jump must not be fought by the
     loop: while idle, whatever the page did becomes the new target. */
  window.addEventListener('scroll', () => {
    if (running) return;
    targetScroll = window.scrollY;
    currentScroll = window.scrollY;
  });

  targetScroll = window.scrollY;
  currentScroll = window.scrollY;
}
