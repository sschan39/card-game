# Pending choices implementation plan

**Goal:** Implement Milestone 3.5 with serializable room-owned choices, validated owner responses, and resumable resolution without unrelated priority.

**Contract:** `PendingChoice` includes request ID, owner, kind, prompt, server-owned options, cardinality/allocation constraints and an action or resolution continuation. `choose` submits option IDs or integer allocations. Choice data and queued triggers are reducer/snapshot/delta state, not closures or client-only state.

**Timing clarification after review:** Actual modes, targets and divisions among targets belong to announcement. Targeted distributions are locked before costs/stack commitment and assign at least one per selected target. Resolution `options` and `selection` are explicitly nontargeted choices; resolution branches cannot introduce actual targets. Untargeted distributions use concrete current matching objects. See [official rules](https://media.wizards.com/2026/downloads/MagicCompRules%2020260619.pdf), 601.2b–d and 608.2d.

- [x] Add failing scenarios for action mode/target/discard prompts, resolution optional/search/distribution/ordering prompts, wrong-owner/stale/invalid responses, paused priority, no premature checkpoints, and reconstruction from serialized room state.
- [x] Add types and pure request/answer helpers. Action preparation prompts for missing modes, target groups, discard selection and explicitly requested mana allocation, then revalidates the entire action before commitment. Server definitions determine option values.
- [x] Extend effect definitions with declarative resolution choices. Resolution executes preceding instructions, saves the next instruction index and initial legality, pauses, and resumes from validated answers. Never replay completed instructions. Persist discovered triggers until final resolution settlement.
- [x] Add pending-choice reducer mutations and delta mappings, engine routing for `choose`, and generic choice events. Ordinary actions, phase advancement and debug resolution remain blocked while a choice is pending. Completing resolution restores normal checkpoints and priority.
- [x] Render an owner-only choice panel supporting selection, ordering and allocation; reconnect derives the panel from room state. Add real-server continuation/reconnect and client callback tests.
- [x] Run full tests, both typechecks and build; review and commit. Audit every named choice kind with concrete scenarios before treating this item as complete.

Verification: 596 tests in 50 files passed; server and client typechecks and production build passed. Independent review findings were fixed with regressions: selected-zone identity, ability choice parsing, announcement timing for targets/distributions, allocation feasibility, and duplicate option IDs. Real sockets cover owner choice reconnect and resume; serialized engine recovery preserves queued triggers.

