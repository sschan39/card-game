# Milestone 1.2 Implementation Plan

**Goal:** Centralize physical-card moves and active state resets while retaining departure data.
**Architecture:** Pure zone helper called by reducer; engine captures pre-reset information;
existing event/stack payloads retain snapshots; sync replays the same mutations.
**Constraints:** Persistent UUIDs; no targeting or generation changes, new zones, history service or new settings. Stay on current checkout.

**Status:** Implemented 7 October 2026; changes remain uncommitted on codex/milestone-0.
**Evidence:** 15 failures reproduced in the 17 new transition tests before implementation;
63 focused transition/reducer/actual-socket tests passed afterward. Final full suite:
486 tests in 38 files passed. Both TypeScript checks and production build passed
with bundled Node 24.19.0. Read-only code review approved the narrowed scope.

## Tasks

- [x] Write failing transition tests for resets, atomic stack movement, no loss on invalid destinations, same-zone no-op, ownership and ability snapshots. Run RED.
- [x] Implement createCardState/resetCardForZone/getCardInZone/moveCard in src/engine/zone-transitions.ts, integrate factory/reducer and remove SET_CARD_ZONE. Cast with one MOVE_CARD carrying a spell object. Run focused GREEN.
- [x] Write failing departure/ETB/delta tests. Capture CardSnapshot before mutation, emit events only on actual moves and read departure-trigger source P/T from snapshots. Extend sync for atomic stack insertion. Run focused GREEN.
- [x] Update existing tests to the accepted changed behavior; add actual socket assertions for reset state, old source snapshot and unchanged UUID. Run focused/full suites, both typechecks and build.
- [x] Request read-only code review, resolve material findings and record evidence. Leave changes for review without merging or pushing.

**Interfaces:** createCardState(blueprint, ownerId, controllerId, zone): CardState;
resetCardForZone(card, zone, controllerId?): CardInstance;
getCardInZone(room, uuid, playerId, zone): CardInstance | undefined;
moveCard(room, mutation: MOVE_CARD): GameRoom. MOVE_CARD has optional destination
spell stackObject and controllerId; moving into stack requires stackObject at runtime.
CardSnapshot = { card: CardInstance; power: number; toughness: number }.
