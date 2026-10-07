# Countering and source information — Milestone 3.6

Keep the existing stack/reducer/event architecture and persistent card UUIDs. Add selected stack-object removal, authored instant fixtures, and explicit last-known source snapshots. Do not expand into the full layer or trigger scheduling milestones.

- [x] Add failing counter scenarios: selected lower spell/ability removal, spell graveyard movement, source staying in place, paid costs persisting, resolving object removal by UUID, and actual socket/client stack selection.
- [x] Add `COUNTER_STACK` and `REMOVE_STACK` mutations, generic counter effect, exhaustive reducer/delta handling and typed applied counter event. Keep legacy flags as low-level compatibility; normal countering removes immediately.
- [x] Add instant counterspell/ability-counter fixtures and instant timing on the existing fireball. Ability-only targeting has an explicit stack-type filter.
- [x] Add failing source-information scenarios: current characteristics after activation, departure after buffs/counters, source sacrifice as a cost, zone re-entry, simultaneous departures, and serialized/delta preservation.
- [x] Capture source snapshots at activation/discovery and refresh on departure with current derived characteristics; use live original object while present and last-known information afterward. Resolve abilities independently of source presence.
- [x] Make resolved temporary buffs independent of source presence, and bind selected targets to their zone revision. Preserve source-dependent static entries and their departure cleanup.
- [x] Review; run full tests, both typechecks and production build. Audit all six Milestone 3 items against the roadmap and record concrete evidence before completing the goal.
- [x] Commit the verified changes and confirm the worktree is clean.

Final verification: 614 tests in 52 files passed, both typechecks passed, production build passed. Independent review found two sequential-batch trigger source-information gaps; both were reproduced with failing regressions, fixed, and re-reviewed with no further important findings. Departure events use immediate preceding state for sequential instructions and shared preceding state for simultaneous state-based removals. Newly discovered triggers retain later departures from the same batch. See `../../project-audit/milestone-3-completion.md` for the full milestone audit.

Reference: [official rules](https://media.wizards.com/2026/downloads/MagicCompRules%2020260619.pdf), 113.7a, 608.2h and 704.8. Last-known information records departure rather than merely activation; simultaneous state-based departures share the preceding state.
