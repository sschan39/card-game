# V2 — Start to spell resolution

Status: proposed; follows V1. Baseline `8798da1`, 13 October 2026. [Vertical plan](README.md). Existing roadmap owners: [land action](../2.3-land-special-action.md), [mana payment](../2.4-mana-payment.md), [ordinary turns](../2.1-ordinary-turns.md).

## Player transcript and scope

Two sessions create/join the same room, choose RPS, receive usable hands, play a land directly, tap it for mana, cast an existing creature or targeted spell, pass priority normally and see resolution on both screens. Debug resolve/end-turn controls remain available but do not count as completing this transcript.

The necessary new rule consumer is ordinary hand land play. Other work is repair of the existing path: useful option labels/reasons, visible mana/priority, target confirmation/cancellation and result feedback. No deck builder, mulligan, cross-zone permission system or general land-allowance modifier framework.

## Structure and flow

| Boundary | Owner |
|---|---|
| Create/join/RPS/deal | Existing StartScreen, useGameActions, server setup and room factory |
| Hand routing | CardComponent and OptionService choose `play_land` for effective Land, otherwise existing cast flow; ContextMenu uses the same action |
| Land timing/allowance | New `src/engine/handlers/play-land-handler.ts`; known `ACTION_IDS.playLand`; active player/main phase/priority/empty stack; hand source only |
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
