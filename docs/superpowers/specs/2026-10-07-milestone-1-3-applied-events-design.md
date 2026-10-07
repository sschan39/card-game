# Milestone 1.3: Applied events and extensible logging

Approved scope: publish typed events from committed mutation batches, retain before/after information and cause identity, connect the timeline to delta/JSONL/console logging, and correct indexed delta insertion. Keep card identity and the current trigger coordinator; targeting and the rules checkpoint remain separate milestones.

The engine captures a batch's immutable before-room, applies mutations, then publishes events against the committed after-room. Each applied mutation also has a generic event, so new mutations remain observable without adding logger cases. Semantic event derivation lives in its own module. Death/leave snapshots use the shared batch before-state; trigger discovery receives that before-state for departure events and the after-state for other events.

Applied batches carry unique IDs, command context and causes (command, trigger, state-based action or engine). They retain room references in memory; JSONL records only batch metadata and event payloads, alongside existing patches. No full-room serialization on every action. Planning code emits no game events. Effect completion notifications are returned as resolution metadata and published only after the associated stack removal is applied.

The logger accepts arbitrary event names, structured context and injectable sinks. Console formatting is one default sink; adding event types requires no logger changes. Optional console event output is centralized in config. JSONL includes the applied event timeline regardless of console verbosity. Existing player filtering is preserved; detailed internal events stay in the unfiltered server log.

Rejected commands produce a contextual diagnostic log but no committed batch. No database, crash recovery, initial-state persistence or reconnect protocol redesign is included.

RPS deck/hand setup uses a setup-only `SET_PLAYER_ZONES` mutation on freshly initialized cards. This prevents host-side setup from retroactively changing batch room references and makes the setup patches part of the same command timeline. Existing snapshot delivery remains available.

Acceptance: listeners see committed state; discarded/no-op mutations emit no semantic events; accumulated damage reports the actual positive increment; cleanup does not report damage; simultaneous departure snapshots share before-state; resolution fizzle metadata does not mutate input; batches survive JSONL round-trip; custom log events/sinks work; indexed insertion matches the server.
