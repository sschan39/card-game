# Animation inventory

Every animated thing in the three front ends, what starts it, how long it runs, and — the
column that matters — **who is responsible for cleaning it up**. Two rules follow from this
table:

1. A duration lives in exactly one place. CSS lengths come from `--dur-*` in
   `packages/ui/src/style.css`; a JS constant that must match a CSS duration carries a
   comment saying which one.
2. Only the log drawer and the toast have an exit that needs cleanup. Everything else is
   either a one-shot keyframe or a state-driven transition, so nothing can leak.

| Animation | Trigger | Duration | Cleanup owner |
|---|---|---|---|
| Log drawer slide in/out | Click the `Log` tab | `--dur-normal` (240ms) transform, `--dur-fast` (200ms) opacity | **Browser** — `display` participates via `allow-discrete`; the node never leaves the DOM |
| Log drawer entry start value | Above, on open | same | `@starting-style`, no rAF and no class toggle |
| Toast enter | New message arrives | 160ms (`toast-in`) | Component; unmounts on dismiss |
| Toast exit | 3s auto-dismiss or manual | 180ms (`toast-out`) | JS timer `EXIT_MS = 180` in `Toast.tsx`, **checked against the CSS value** |
| Page entrance | Route mounts | 320ms (`page-in`) | None needed — one-shot |
| Content reveal | Data arrives after mount | `content-in` | None needed — one-shot |
| Hover / press feedback | Pointer | `--dur-hover` (140ms) | None needed — state-driven |
| Card detail close | Dismiss | 320ms fallback | JS timer racing `transitionend` — **no matching CSS transition**, see note below |
| In-game status cues (targetable, summoning sickness, idle breathe) | Game state | 1s / 4s / 6s loops | None needed — CSS driven by a class |

## Known rough edge

`packages/ui/src/CardDetail.tsx` starts a 320ms timer as a fallback in case `transitionend`
never fires, but `.card-detail` declares no `transition`. In practice the timer is what
closes the panel, so the close always takes the full 320ms even though nothing is
animating. Either give `.card-detail` a real exit transition and keep the timer as a
backstop, or drop the timer and close immediately.

## Verification habits

- Rapid-toggle any component with an exit animation at least 20 times. Nothing should
  stick, and no frame should jump.
- Under `prefers-reduced-motion: reduce`, every animation resolves immediately and state
  still updates — a transition of duration 0 must not skip the state change itself.
- DevTools → Animations panel, with "slow down" off: no orphaned animations should remain
  running after a component closes.
