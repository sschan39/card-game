# Tap-Based Targeting UI — Design Document

**Date:** 2026-09-06
**Status:** Ready for Implementation
**Context:** The targeting system (Tasks 1-11 of `2026-09-04-targeting-system.md`) is complete and committed. The current frontend collects targets through a **modal dialog** (`TargetSelector.tsx` renders a full-screen overlay with a button list). This design replaces the modal with **tap-based targeting**: the player taps legal battlefield cards and player panels directly, with a lightweight bottom banner for Cancel/Confirm.

---

## 1. Overview

The modal dialog is a poor fit for a card game: it hides the battlefield, forces the player to map button labels back to cards, and breaks the spatial intuition of "tap the thing you want to hit." Tap-based targeting keeps the battlefield visible and lets the player select targets in place.

**Three settled principles (from the user):**

1. **Keep Confirm for all targeting.** Do not auto-confirm single-target selections yet — the Confirm button always appears. (May be flagged out for single-target later.)
2. **Same deselect for single and multi-target.** Tap-to-toggle: tap a target to select it, tap again to deselect it. No separate "remove" affordance.
3. **Reuse as much as possible.** No backend changes. Reuse the existing `TargetingState` store, `matchesTargetFilter()` shared utility, and `needsTargets()` helper.

---

## 2. Current State (verified 2026-09-06)

| Piece | Location | Status |
|-------|----------|--------|
| `TargetingState` (cardUuid/zone/actionId/targeting/collected) | `src/client/store/gameStore.ts` | ✅ Defined |
| `beginTargeting` / `addTarget` / `removeTarget` / `cancelTargeting` / `confirmTargeting` | `src/client/store/gameStore.ts` | ✅ Defined |
| `addTarget` enforces `maxTargets` | `src/client/store/gameStore.ts` | ✅ Works |
| `matchesTargetFilter(card, def, playerId)` | `src/shared/target-utils.ts` | ✅ Works |
| `needsTargets(card)` | `src/client/targeting.ts` | ✅ Works |
| `TargetSelector.tsx` (modal overlay + button list) | `src/client/components/TargetSelector.tsx` | ❌ To be replaced |
| `CardComponent.tsx` (no targeting awareness) | `src/client/components/CardComponent.tsx` | ❌ To be extended |
| `PlayerInfo.tsx` / `OpponentInfo.tsx` (no targeting awareness) | `src/client/components/PlayerInfo.tsx` | ❌ To be extended |

### Gaps

1. **Modal UX.** `TargetSelector` renders a full-screen overlay that hides the battlefield and lists targets as buttons.
2. **No tap-to-select on cards.** `CardComponent` has no targeting awareness — battlefield cards can't be tapped to select.
3. **No tap-to-select on players.** `PlayerInfo`/`OpponentInfo` can't be tapped to select a player target.
4. **No toggle deselect.** `addTarget`/`removeTarget` exist but nothing calls them from a tap; there's no single `toggleTarget` action.

---

## 3. Design

### 3.1 Data flow (unchanged from targeting system)

The store actions and `playerAction(actionId, cardUuid, targets)` flow are unchanged. Only the **UI layer** changes: instead of a modal collecting targets, the battlefield and player panels collect them via tap.

```
1. Left-click card in hand (needsTargets → non-null)
2. beginTargeting({...}) — targeting mode on
3. Battlefield cards + player panels render with
   .targetable highlight if matchesTargetFilter()
4. Tap a legal target → toggleTarget(pointer)
   (tap again → deselect)
5. Banner shows "Choose target — <card> (N selected)"
6. Confirm → playerAction(actionId, cardUuid, collected)
   → confirmTargeting() clears mode
```

### 3.2 Store changes (minimal)

Add **one** new action and **one** new selector:

- `toggleTarget(pointer: TargetPointer)` — if `pointer` is already in `collected`, remove it; otherwise add it (respecting `maxTargets`). This unifies select/deselect for both single and multi-target.
- `selectTargeting(state): TargetingState | null` — exported selector so components can read targeting mode without `useShallow`.

`addTarget`/`removeTarget` remain (unused by the new UI, but harmless and covered by tests).

### 3.3 Component changes

#### 3.3.1 `TargetSelector.tsx` → targeting banner

Shrinks from a modal to a fixed bottom banner. It no longer renders target buttons — it only shows:

- The card being cast (name resolved from the room snapshot).
- Selected count.
- **Cancel** and **Confirm** buttons.

Confirm is disabled until `minTargets` is reached and at least one target is collected. Confirm dispatches `playerAction(...)` **before** `confirmTargeting()` clears state (preserving the existing ordering fix).

#### 3.3.2 `CardComponent.tsx` — battlefield tap-to-select

When targeting mode is active and the card is on the battlefield and passes `matchesTargetFilter`, the card:

- Gets `.targetable` (gold pulsing outline) if legal, `.selected` (red outline) if collected.
- On click, calls `toggleTarget({ targetType: 'permanent', cardUuid })` and returns early (no cast/context-menu behavior).

Hand cards are unaffected (targeting only applies to `zone === 'battlefield'`).

#### 3.3.3 `PlayerInfo.tsx` / `OpponentInfo.tsx` — player tap-to-select

When targeting mode is active and `def.type === 'player'`:

- `PlayerInfo` is targetable if `def.controller !== 'opponent'` (self or any).
- `OpponentInfo` is targetable if `def.controller !== 'self'` (opponent or any).
- On click, calls `toggleTarget({ targetType: 'player', playerId })`.

### 3.4 CSS

Replace the modal CSS block with:

- `.targeting-banner` — fixed bottom bar.
- `.card.targetable` / `.card.targetable.selected` — gold pulse / red outline.
- `.player-info.targetable` / `.opponent-info.targetable` (+ `.selected`) — same highlight.

---

## 4. Out of scope

- Auto-confirm for single-target (deferred — "flag it out later").
- Hexproof/shroud/protection (still a stub).
- Mixed-mode targeting (player + permanent in one spell).
- Backend changes of any kind.

---

## 5. Verification

- `npx tsc --noEmit` — clean.
- `npm test` — all existing tests pass (no backend changes, so no new backend tests required).
- Manual smoke test (updated in `docs/smoke-test-targeting.md`).