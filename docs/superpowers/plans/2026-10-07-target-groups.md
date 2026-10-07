# Target groups implementation plan

**Goal:** Implement Milestone 3.3 using one legality query for every announced and revalidated target group. Whole-object resolution is the next separate item.

**Model:** An effect may name a `targetGroup`; absent names become `effect-N`. Effects sharing a name share a targeting clause and must declare identical definitions. Stack objects carry validated groups. Each concrete card pointer captures its zone revision so a leave-and-return cannot revive an old selection despite persistent UUIDs. Self/all selections are nontargeted and never contribute to whole-object failure.

- [x] Add engine regressions for two groups with different types, shared groups, duplicate/extra/missing selections, type/control/permission changes, current power restrictions, and leave-return with the same UUID.
- [x] Add `shared/target-legality.ts` and `engine/target-groups.ts`. Check current zones, types, subtypes, control, power/toughness bounds, spell versus ability stack types, and keyword permissions. Provide permission hooks for new restrictions. Do not treat all-matching selections as targeted for permissions.
- [x] Use target-group planning from casting and activation; lock concrete references from authoritative state. Revalidation calls the same legality query. Legacy flat lists remain accepted only when unambiguous.
- [x] Update client targeting to collect one group at a time and preserve selection data. Card/player/stack highlights use shared legality. Add client callback regressions for group progression.
- [x] Run tests/typechecks/build; request a separate targeting review and commit item 3.3.
