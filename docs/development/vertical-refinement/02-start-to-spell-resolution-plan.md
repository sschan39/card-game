# V2 execution plan and record

Status: implemented and verified for the owner's active goal "next slice", 13 October 2026. Implementation baseline `f1daa26` on `codex/vertical-refinement-plan`. Scope and acceptance evidence: [start to spell resolution](02-start-to-spell-resolution.md).

The inspected proposal planner stores the entire instruction sequence in `ProposedTransaction.remaining/completed`, commits no prefix while a replacement choice remains, and restores priority through `resumePriority`. Ordinary handlers can return direct mutations without a stack object. These existing contracts suffice for land play; do not add completion infrastructure.

## 1. Direct land play

- [x] Write failing `tests/engine/play-land.test.ts` scenarios: hand land direct movement/no cast event, allowance rejection/reset, cast-route rejection, exact source revision, effective types, replacement pause/recovery/cancelled movement, and rejected timing.
- [x] Add `ACTION_IDS.playLand`, `playLandHandler` and shared `validateLandPlay(room, playerId, data)` result. Read live hand/effective types; require active player, main phase, priority and empty stack. Casting handlers/preparation reject effective Land independently.
- [x] Add optional `TurnHistory.landPlays`, initialized in `newTurnHistory`; add `RECORD_LAND_PLAY` with player/turn to mutation/reducer/sync. Handler returns `[MOVE_CARD, RECORD_LAND_PLAY]`; counts accepted actions even when the movement is replaced, not generic land entry. Existing proposal continuation and checkpoint own settlement/priority.
- [x] Add optional legacy-compatible `SetupConfig.landPlaysPerTurn` and central `landPlayLimit(setup?)`; snapshot the concrete default one. Preserve other setup behavior.

## 2. Usable normal controls

- [x] Extend client callback/render tests and actual-server routing to demonstrate play-land, second-play reason, tap-for-mana and targeted spell resolving through both priority passes.
- [x] Route effective Land hand clicks/options to the special action; keep spell targeting and RPS separate. Show relevant disabled options/reasons and cost descriptions; show current priority/declaration/choice owner using existing state.
- [x] Configure deterministic development dealing with the same nine-card multiset and a useful opening hand (land, land, creature, spell). Shuffle remains available through the existing flag; randomness tests request it explicitly.

## 3. Verification and handoff

- [x] Run focused tests, both typechecks, the full two-worker suite and production build. Review normal action/replacement bookkeeping and option parity.
- [x] In two actual browser sessions, create/join/RPS, reach main, play a land directly, inspect rejected second play, tap it, target/cancel/retry a spell, resolve using ordinary passes, then use ordinary steps to verify the next-turn allowance reset. No fixture injection/private React callbacks/debug shortcuts for browser acceptance.
- [x] Update actual contracts/evidence in the V2/2.3/index/logging docs; check local links and diffs; commit locally. Keep the next vertical item separate.
