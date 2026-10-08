# Milestone 4 — engine trigger semantics and scheduling

The owner authorized reaching Milestone 4 after the engine-only comparison. Retain the existing pure reducer, applied events, discovery/coordinator boundary, checkpoint and serializable choice protocol. Do not add named cards, catalog entries or client components. Synthetic fixtures and actual-server protocol tests prove the engine behavior.

## Design choices

Keep read-only scanning and small services rather than introducing a subscription index or a second orchestrator. Declarative trigger predicates are serializable and compose with the existing ability schema. A runtime callback-only predicate system would complicate recovery; a card-specific switch would prevent reuse.

1. **Matching:** a trigger may select its event subject (`self`, `another`, `any`), subject controller (`self`, `opponent`, `any`), types and subtypes. Card-subject events default to self; player/step events default to the ability controller. Legacy onEnterEffects is self-only. Object identity includes zone revision. Explicit watchers remain visible in simultaneous departure batches.
2. **Events:** derive typed cast/draw/discard/gain/loss/block/combat damage events from committed changes. Draw and discard use explicit MOVE_CARD reasons; generic zone transfers do not imply these actions. Creature battlefield-to-graveyard movement is death; every battlefield departure is leave. Add the minimal exile zone storage/movement needed for the leave gate. Existing event payloads retain actual incremental amounts and departure snapshots.
3. **Scheduling:** collect discovered triggered objects separately from ordinary cleanup mutations. After SBAs settle, schedule in active-player/nonactive-player order, allowing each controller to order their group. Collect modes, all target groups and announced divisions before insertion. Persist the queue and all outstanding requests in room state. Impossible targets remove an unschedulable trigger. No unrelated action or priority while choosing.
4. **Resolution:** a small declarative condition evaluator supports all/any/not and comparisons over source, controller, triggering event and turn history. Intervening conditions are checked both at discovery and resolution. Dynamic effect parameters can reference triggering-event values and snapshots. Optional effects reuse existing resolution choices.
5. **Delayed triggers/history:** delayed triggers are serializable registrations containing definition, source snapshot, controller and lifetime. One-shot registrations expire when triggered; end-of-turn registrations expire at the relevant boundary. Record current-turn semantic events and keyed trigger/activation uses; reset on real turn advancement. History predicates and per-turn limits use this shared data.

Actual configuration belongs in `src/config.ts`; ability predicates and limits are authored rules data, not configuration. No new configuration switch is needed.

## Acceptance

Engine and real-server scenarios cover own/other entry, gains versus losses, noncreature graveyard movement, bounce/exile, simultaneous departure witnesses, mixed-controller ordering, chosen order/targets/modes, optional resolution, delayed end-step effects, once-per-turn limits and reconnect/recovery. Run the full suite, both typechecks and build. Record requirement-by-requirement evidence and limitations in the final report.
