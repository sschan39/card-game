# Milestone 7: proposed events and state-based settlement

The user authorized reaching the entire Milestone 7 and reporting after completion. The preceding explanation establishes the design: process typed proposals before mutation, retain decisions in room-owned choices, and settle simultaneous state-based batches before triggers or priority.

## Boundaries

Keep engine-first definitions and synthetic fixtures. No named-card mechanics, catalog expansion, new client choice components, combat auto-allocation, or new configuration knobs. Continue in the existing checkout/branch. Existing UUID/zoneRevision identity, effective characteristics, applied-event logging and delta replay remain authoritative.

## Proposed-event processor

Use a pure planner over typed damage, destruction, sacrifice, zone-transfer, draw, and life-change proposals. Replacement definitions are serializable room data; operation handlers are registered engine extensions. Matching reads effective characteristics and exact incarnation references. Definitions support source-dependent and finite durations, self-replacement precedence, and consumable prevention/regeneration shields.

For each event, find unused applicable rules, ask the affected player/controller when several valid choices exist, apply one, and re-evaluate the changed event. Each rule gets at most one application to an event lineage. Persist current proposals, application history, provisional shield consumption, completed mutations and the remaining transaction in the choice continuation. No state change from the transaction becomes authoritative until its decisions finish.

Damage recipients within one batch remain simultaneous. Shield usage is reserved during planning, but consequences and applied events see only actual final damage. Preserve semantic destruction and sacrifice until lowering to the reducer's zone movement. Indestructible prohibits destruction; regeneration replaces destruction. Neither prevents ordinary transfers or sacrifice.

The existing ordered damage modification hook is retained as a compatibility extension, not used as the replacement ordering mechanism. Consequence hooks run after replacement/prevention. Generic damage keyword consumers are distinct from the core processor.

## Resolution and transaction continuation

Resolution processes effects sequentially, planning proposals before previewing their results, so later dynamic parameters and choices observe replaced outcomes. Pause with the current effect transaction and the next resolution position. Previously completed instructions can be committed while the persisted choice suppresses checkpoints. Resume the current effect once, then continue resolution; delay structural stack removal and completion publication until the object finishes.

Non-resolution transactions (cost payment and stack insertion, combat damage completion, state-based changes) retain their complete tail. The engine boundary processes raw gameplay mutations before commit; already processed primitives are explicitly marked to avoid a second replacement pass. Snapshots/reconnect retain all continuation data through existing choice synchronization.

## Damage and state foundations

Add exact incarnation destruction/sacrifice proposals, regeneration/prevention registrations, deathtouch damage markers, poison counters and failed-draw state. Add the minimum token, supertype and attachment identity state required for state-based checks. Loyalty and defense use generic counters; this does not add loyalty actions or complete battle gameplay.

Generic damage adapters consume effective source keywords and recipient types: lifelink, deathtouch, infect/wither, damage to loyalty/defense, and protection prevention. Lifegain and other damage results use actual damage, including simultaneous lifelink before player-loss checks.

## State-based settlement

Plan one complete batch from one board snapshot: player life/poison/failed-draw losses; zero toughness separately from lethal/deathtouch destruction; opposing +1/+1 and -1/-1 counters; tokens outside the battlefield; illegal Auras and detached Equipment; legend/world uniqueness; loyalty/defense conditions. Gather necessary player decisions before applying the batch. Preserve departure snapshots for simultaneous trigger discovery. Repeat until stable, then schedule triggers and return priority. Simultaneous losses produce a draw, independent of player iteration order.

## Acceptance evidence

Require focused tests for replacement order (5 doubled then prevent 3 = 7; opposite order = 4), self-replacement precedence, one application per lineage, re-evaluation after redirection, finite shields shared across a simultaneous batch, atomic transaction pauses, resumed sequential resolution and actual-damage consequences. Require synthetic SBA fixtures for every family above, prevention versus sacrifice, and simultaneous outcomes. Require actual-server choice/reconnect/delta scenarios, replay parity and generic logging coverage. Finish with the complete suite, server/client typechecks, production build, requirement audit, completion report and local commit.

Rules reference: https://media.wizards.com/2026/downloads/MagicCompRules%2020260925.txt (120, 614–616, 701, 702, 704).
