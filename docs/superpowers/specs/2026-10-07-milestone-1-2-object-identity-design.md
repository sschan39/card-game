# Milestone 1.2 — Centralized zone transitions and resets

Status: implemented and verified, 7 October 2026. Baseline: aff4d88.
The owner's review supersedes the original object-generation proposal.

## Goal

Keep each physical card's persistent UUID and blueprint. Centralize zone movement,
reset its active state explicitly, and retain relevant departure information.
Reducer copies preserve the same logical instance; no new entity identity is created.

## Included behavior

- One pure zone-transition helper owns lookup, movement and reset construction.
- Preserve UUID, blueprint and owner. On actual zone changes reset damage, counters,
  tapping, attack flags and attachment state. Creature battlefield entry starts sick;
  other destinations are not sick. Outside battlefield/stack control defaults to owner.
  Resolving spells retain the spell controller on battlefield entry; other entries
  default to owner unless the move specifies a controller.
- Validate source and destination before removal; missing source, wrong owner, unsupported
  destination or invalid spell-stack destination is a no-op. Same-zone moves are no-ops.
  Existing toIndex is honored for per-player destination arrays.
- Hand-to-stack movement atomically removes the card and inserts the spell carrying
  its reset source. PUSH_STACK remains for abilities and fixture setup. Ability
  source snapshots are not physical stack-zone occupants.
- Remove SET_CARD_ZONE, which changes only the zone label and has no gameplay producer.
- Capture departing battlefield card state plus resolved power/toughness before reset.
  Departure events and their triggered stack objects retain this information. Existing
  departure-trigger dynamic source parameters use this snapshot. No room-wide history
  store or pending-ability rewrite.
- Emit leave events for actual battlefield departures; emit death only for battlefield
  to graveyard. Invalid moves emit neither and do not remove continuous effects.
  ETB events carry the actual reset entry state.
- Delta replay includes the same moved/reset card and atomic spell insertion; clients
  and reconnect snapshots agree with authoritative state.

## Deferred

Targeting design, generation counters, versioned references, changing fizzle behavior,
new zones, token rules, continuous-effect lifetime redesign, combat-reference semantics,
event batches, simultaneous watcher discovery, checkpoint/priority/phase redesign.
Debug controls and raw snapshots remain available. No new setting is needed.

## Check placement

| Owner | Timing | Check/change |
|---|---|---|
| Zone helper/reducer | Before removing any source | Source is a physical card in the declared zone, destination exists, stack insertion is a valid spell and ID is not duplicated |
| Reset constructor | During a successful actual move | Build active CardState from defaults and destination context, retaining persistent card metadata |
| Engine | Immediately before reducer application | Capture departure state and resolved characteristics |
| Engine | After successful application only | Publish retained departure information; preserve existing trigger/SBA handling and terminal guards |
| Resolver | After previewing structural movement | Publish actual battlefield entry state; use retained departure data for current departure-trigger source parameters |
| SyncService | During mutation replay | Remove/add reset instance and atomically insert the destination spell; no state change means no delta changes |

## File boundary and acceptance

Create src/engine/zone-transitions.ts. Modify card factory, reducer, mutation/card types,
play-card handler, engine, resolver and sync service. Update existing reducer/handler
assertions for atomic casting and removal of SET_CARD_ZONE. Add focused transition tests
and actual socket/client-reducer checks.

Acceptance: stale state is cleared across moves; UUID/blueprint/owner remain; cards cannot
be dropped/duplicated by invalid movement; ability snapshots cannot be moved as cards;
departure triggers retain pre-reset state and P/T; clients receive exact reset state;
terminal rooms remain immutable. Run focused tests, full suite, both typechecks and build.
