# V2 — Start to spell resolution

Status: implemented and verified, 13 October 2026; follows V1. Planning baseline `8798da1`, implementation baseline `f1daa26`. [Vertical plan](README.md), [execution record](02-start-to-spell-resolution-plan.md). Existing roadmap owners: [land action](../2.3-land-special-action.md), [mana payment](../2.4-mana-payment.md), [ordinary turns](../2.1-ordinary-turns.md).

## Player transcript and scope

Two sessions create/join the same room, choose RPS, receive usable hands, play a land directly, tap it for mana, cast an existing creature or targeted spell, pass priority normally and see resolution on both screens. Debug resolve/end-turn controls remain available but do not count as completing this transcript.

The necessary new rule consumer is ordinary hand land play. Other work is repair of the existing path: useful option labels/reasons, visible mana/priority, target confirmation/cancellation and result feedback. No deck builder, mulligan, cross-zone permission system or general land-allowance modifier framework.

## Structure and flow

| Boundary | Owner |
|---|---|
| Create/join/RPS/deal | Existing StartScreen, useGameActions, server setup and room factory |
| Hand routing | CardComponent and OptionService choose `play_land` for effective Land, otherwise existing cast flow; ContextMenu uses the same action |
| Land timing/allowance | `src/engine/handlers/play-land-handler.ts`, shared `validateLandPlay(room, playerId, data)`; known `ACTION_IDS.playLand`; active player/main phase/priority/empty stack; hand source and current integer zoneRevision required |
| Count successful land plays | Extend existing TurnHistory with per-player land-play count and a recording mutation; reset via existing newTurnHistory on real turn switch |
| Commit | Existing direct action/proposed MOVE_CARD/checkpoint/events/delta; active player retains priority; no stack object or SPELL_CAST |
| Mana/spell/response | Existing tapForMana, target groups, cost planner, spell handler and priority passes |

Put ordinary `landPlaysPerTurn: 1` in central room-snapshotted setup configuration; this provides a small adjustable development/rules default without adding effect-based permission infrastructure. Count an accepted land-play action once when its transaction completes, including when a replacement redirects or cancels its movement; an entry change does not refund the accepted play. A rejected action consumes no allowance. Paused replacement choices retain this bookkeeping in the current transaction. Do not infer play count from generic PERMANENT_ENTERED events, because effects also put lands onto the battlefield. If the current completion boundary cannot express it cleanly, resolve that general contract before implementing this action.

```text
Create/join → RPS → normal configured hand
  → click Land → validate direct play → MOVE_CARD + record play → entry/checkpoint
  → choose mana ability → existing immediate mana payment/output
  → click spell → select target → existing payment/stack insertion
  → player passes → opponent passes → normal resolution
  → both screens show zones/life/mana/priority and matching trace
```

## UI refinement boundaries

Do not silently hide all disabled options: show the relevant action and its concise disabled reason where the player asks for options. Preserve normal click convenience. Show rules text or the existing description so the player can understand the action without opening a console. Make clear who should act next. Fix only inconsistent routing/gating encountered in this transcript; do not duplicate server legality in a new frontend rules service.

Use existing `land-red`, `empire-servant` and `broken-fireball` definitions. Configure repeatable useful hands and sufficient libraries centrally for development. Keep RPS hand setup separate from the actual play deck. No production handler branches on these IDs.

## Implementation/acceptance checkpoint

After the item scope is approved, write its detailed execution steps around the exact land transaction completion API and the browser observations. Expected files: action IDs/registry/server registration, land handler, TurnHistory and mutation/reducer/sync support, config/setup snapshot, OptionService, CardComponent/ContextMenu/PlayerInfo/PhaseBar, and their focused tests.

Add `tests/engine/play-land.test.ts` and one actual-server transcript; extend client action/option cases. Prove direct hand→battlefield/no spell event, one play then a rejected second play, later-turn allowance reset, and an ordinary spell resolving after two passes. Existing zone-revision/entry/payment tests remain the foundations; do not recreate a broad rules matrix.

Browser acceptance: complete the transcript on both screens, see the second-land reason, play successfully on the next turn, and use V1 logs to explain every step. Record the actual command transcript in this document.

## Stop boundary

Stop before suppressing cast events after land casting, counting every land entry as a play, fake source cards, new turn shortcuts or named-land exceptions. Keep broader allowance/access extensions open in their original documents.

## Implemented contracts and evidence

`playLandHandler` returns direct `MOVE_CARD` and `RECORD_LAND_PLAY` instructions without a stack object. Existing proposed transactions retain both instructions through replacement choices. `TurnHistory.landPlays` stores per-player accepted plays, survives event-history recording, and resets in existing `SET_TURN` advancement. Reducer and delta mapping support the recording instruction; generic land entries do not record plays. `landPlayLimit(setup?)` owns the central legacy fallback; room setup snapshots `landPlaysPerTurn`, default one. Zero disables ordinary land play. Effect-based allowance modifiers remain deferred.

Effective Land cards reject the cast route in announcement preparation and both lower-level spell-handler stages. Card clicks and options use the same land action and current revision. Hand spell options remain visible with cost descriptions; disabled options show their reasons. PhaseBar shows priority/decision ownership, PlayerInfo shows the allowance, and GameLog/browser logs summarize entry and mana changes. Right-click coordinates remain local across the options response. Sickness styling is restricted to battlefield creatures; card tenure state is preserved for later type changes.

The configured development deck retains its nine-card multiset. Existing shuffle stays configurable; the default order deals two lands, one creature and one targeted spell. No card definitions, named-card handlers, transport framework or completion subsystem were added.

Final verification: 1044 tests in 80 files, including 39 actual-server scenarios; both server/client typechecks and the production build passed. Independent review found no remaining critical or important issues. `tests/engine/play-land.test.ts` covers timing, postcombat main, exact revision after leave/return, effective types, cast-only prohibitions, allowance/reset, generic entry, redirect/cancel/decline and persisted replacement decisions. `tests/client/basic-play.test.ts` covers routing, disabled feedback, local positioning, priority, entry/mana summaries and creature-only sickness styling. Existing full-turn and option tests now assert direct land play and visible options. The actual-server normal-deck transcript checks shared zones, life, mana, turn history and matching command IDs; recipient-specific hand views need not be identical.

Browser acceptance used two independent IAB sessions against the final built client/backend at localhost:3000, room `df012030-355b-48fd-a15b-3d6168b41b9f`:

1. A created the room, B joined, and both chose Rock through visible hand controls. Ordinary priority passes reached precombat main with the repeatable useful hands.
2. A clicked a hand land: it entered directly, priority remained with A, the stack stayed empty and allowance showed 1/1. Trace `f7ac8cf5-9ecc-4298-9927-9a0c3788f03c` matched frontend send, backend receipt/acceptance/publication and both clients' applied entry.
3. A clicked another land: visible "No land plays remaining this turn" banner; its option was disabled with the same reason and 0 of 1 remaining description. Trace `2fb8ced3-f63a-4cda-ba42-87cf48cbc800` matched the backend rejection and generated no committed delta. The menu appeared beside the clicked card after the positioning repair; lands no longer displayed the creature sickness marker.
4. A dismissed the rejection, used the land's mana option, and saw red:1. A began and cancelled spell targeting; mana remained red:1 and no player command/payment occurred for the local cancellation. Retrying, selecting the opponent and confirming paid the mana and put the current targeted spell on the stack. Cast trace `eb42df62-470f-43af-aebe-ad92b759da8d` matched the backend and client results.
5. A and B used ordinary Pass Priority controls. Resolution left an empty stack, the spell in A's graveyard and B at 17 life on both screens.
6. Both players completed ordinary empty-combat turns: passes, Confirm Attackers (0), postcombat/end, then next upkeep/draw/main. No debug Resolve Stack or End Turn was used. When A's turn returned, allowance showed 0/1. A used the enabled Play land option successfully; both screens showed two A lands and allowance returned to 1/1. Trace `4a9fbe77-16a3-4490-ad9c-c34ed7420ff0`, sequence 46, matched the backend and both clients.
7. Reloading A restored the same room, two lands, phase/priority, life, mana and 1/1 allowance. The recent on-screen log intentionally restarted empty; B retained its recent trace. Both final local views remain open for inspection.

The initial runs reproduced the missing handler, cast routing, disappearing disabled feedback, unhelpful entry/mana summaries and random unusable hands. Browser observations then reproduced menu positioning and noncreature sickness styling. Review reproduced the omitted-revision stale-action gap before correction. One old multi-blocker socket scenario exceeded its time limit during concurrent checks; both subsequent full runs passed it without changing its timeout or combat behavior.
