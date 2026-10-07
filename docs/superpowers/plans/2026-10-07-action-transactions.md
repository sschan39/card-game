# Shared action transactions implementation plan

**Goal:** Fulfil Milestone 3.2 with one pure cost planner for spells, stack abilities and immediate mana abilities.

**Contract:** `planActionCosts(room, playerId, source, cost, selections)` returns either a reason or a complete mutation batch. Selections contain concrete mana allocation, discard card UUIDs and ordered mana activations. Definitions supply costs; source sacrifice is the current boolean schema's meaning. Add an untap cost beside tap, rejecting contradictory orientation costs. Reject unsupported loyalty costs explicitly.

- [x] Add regressions for combined payment, discard/sacrifice/untap, rejection with zero payment, retaining costs after countering, and producing mana during payment. Casting cannot discard its own source. Earlier selected mana activations can invalidate later payment, in which case the entire action rejects.
- [x] Implement `src/engine/action-costs.ts`. Plan selected mana abilities against reducer previews, then validate and plan the final cost against the resulting state. Nested mana activation lists are disallowed; each individual activation may supply its own allocation/discard selection. No preview dispatches events or state-based actions.
- [x] Route casting, non-mana activation and mana activation through the planner. Timing/priority validation runs against the original room; resource validation uses the planner's preview. Commit all cost and stack mutations in one engine batch.
- [x] Update cost normalization/types and option affordability. Preserve automatic allocation and immediate mana behavior. UI prompts for additional selections are implemented in 3.5; socket commands accept explicit selections now.
- [x] Run focused and full regressions, both typechecks and build; review and commit before targeting work.
