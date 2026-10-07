# Ability activation implementation plan

> Execute inline, using the existing checkout branch and test-driven development. The full Milestone 3 scope remains in the design and roadmap; this plan implements item 3.1.

**Goal:** Make selected non-mana abilities executable through UI and sockets, starting with Hellkite.

**Architecture:** Blueprint-local IDs select server-owned definitions. A pure handler plans supported costs and a PUSH_STACK mutation. Existing resolver and option transport remain shared.

**Tech stack:** TypeScript, React/Zustand, Socket.IO, Vitest.

- [x] Write engine regressions for Hellkite payment/stack/source retention, illegal requests paying nothing, two abilities sharing a primitive, and instant versus sorcery timing. Run the new test and observe the missing handler failure.
- [x] Add authored IDs in `src/library/card_data.json`, normalized unique IDs in `card-parser.ts`, the action constant/label in `action.ids.ts`, and `handlers/activate-ability-handler.ts`. Reject unsupported costs until item 3.2 rather than silently paying only part.
- [x] Add source-directed self selection to `TargetingDefinition` and `buildStackEffects`; Hellkite's self effect uses this selection. Preserve controller-directed self defaults for existing effects.
- [x] Update `option-service.ts`, `server.ts`, and context-menu targeting payload preservation. Add client callback and actual socket scenarios proving ability selection is transmitted and resolves.
- [x] Run focused tests, full suite, both TypeScript configurations and build. Review the diff, commit item 3.1, then continue item 3.2.
