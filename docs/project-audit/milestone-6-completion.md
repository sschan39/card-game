# Milestone 6 completion audit

Scope: all five Milestone 6 requirements and its gate in `docs/implementation-plan-2026-10-07.md`, with the engine design and implementation plan in `docs/superpowers/`. Work stays in the existing checkout/branch. The engine uses generic operations and existing UI; no named-card mechanics, catalog additions, new client components, configuration flags or combat automation were added.

## Requirement evidence

| Requirement | Current implementation | Executable evidence |
|---|---|---|
| Resolved and static effects have independent lifetime, recipients, source identity and controller | Central normalization records origin, source revision/controller, unique ID/timestamp and affected object references. Resolved buffs survive source departure; explicit dependencies are checked separately. | `continuous-lifetime.test.ts`: independent/default/explicit dependent lifetimes, frozen recipients/count expressions, source and target re-entry; actual-server buff/static/source-departure scenario |
| SET_STATS and the complete characteristic layer pipeline | Pure whole-board fold covers copy, control, text, type/subtype, color, ability/keyword, defining P/T, base setting, deltas/counters and switching. Operation types select stages. | `continuous-layers.test.ts`: every operation, 2/4 → set 3/5 → +2/+1 → counter → switch = 7/6, timestamp conflicts, negative counters, multiple switches, copiable values and immutable blueprints |
| Timestamps, dependencies and defining abilities | Separate room clocks/IDs, object zone-entry and ability-grant timestamps; dependency signatures reevaluate after applications; cyclic components retain external dependencies. | Layer tests: reverse-timestamp dependency, cycle and older outside dependent, no false dependency from no-op setting, grant timestamps, defining counts, same-layer rewritten definitions; lifetime tests: equal timestamp IDs and other-zone source timestamps |
| Characteristic facade used by engine and existing UI | Queries supply effective spell definitions, costs/modes, types/control/colors/abilities, combat legality, triggers, source snapshots, structural spell destinations, state-based actions and displays/selections. | `effective-characteristic-consumers.test.ts`: declarations, control/type pruning, Flying removal, animation/control tenure, granted/lost/legacy/delayed triggers, copied targeting/modes, spell destination, removed land mana; `gameStore.test.ts`: effective control in selection |
| Static source applicability and dynamic scopes, including deliberate other zones | Active static abilities are derived on every query, with declared zones and effective control. Ordinary statics default to battlefield recipients; defining abilities and explicit zones are supported. Multi-layer groups retain their affected set once started. | Layer tests: later entrant anthem/source removal, source-relative control, ability removal, gained same-layer statics, cross-layer continuation and hand exclusion; lifetime/consumer tests: graveyard timestamps and control source |
| Shared target permissions and cast/activation rules | Effective Shroud/Hexproof/protection checks feed engine announcement/resolution and client highlighting. Rule permissions provide prohibitions and instant timing; restrictions win. Mana activation uses the same permission evaluator. | `characteristic-permissions.test.ts`: effective target filters/control, gained/lost permissions, protection source qualities, Flash plus priority, cast restrictions/options, activation/mana and timing; actual-server Hexproof response → original target fizzles, rejection without costs/deltas and reconnect |
| Unique effects, precise removal/expiry and source/target revisions | Every committed effect has an ID; dependent source expiry removes matching IDs only. End-of-turn cleanup filters duration. Zone revisions prevent old effects reviving on returned sources or targets. | Lifetime tests: equal timestamps, ID-specific removal, source-dependent expiry alongside surviving independent entry, exact removal deltas, both re-entry cases; existing reducer duration-cleanup tests and actual-server cleanup |
| Serializable state, client agreement and recovery | Definitions, references, clocks, effects and retained snapshots are plain room data. Sync handles entry changes, timestamps, tenure and automatic combat reconciliation. | Lifetime JSON roundtrip and full delta replay tests; actual-server scenarios compare clients with the engine and reconnect with live Hexproof/effect/stack state |

## Gate audit

- A resolved temporary buff survives source departure: unit engine lifetime and real-server buff resolution prove it.
- A static bonus applies to later entrants and stops with its source: layer fixtures and real-server cast/entrant/bounce prove it.
- SET_STATS, deltas, counters and switching interact: the exact 7/6 fixture, negative counters and multiple switches prove it.
- Timestamp and dependency conflicts: reverse order, cycles with outside dependencies, defining counts, same-layer text changes and grant timestamps have concrete fixtures.
- Ability removal changes combat and activation: removing Flying permits the previously illegal block; granted activation and mana disappear when removed or their static source leaves.
- Server/UI targeting agree: shared effective filters/permissions plus actual-server gaining Hexproof after announcement, resolution fizzle, subsequent announcement rejection and reconnect prove it.

Review findings were reproduced before correction: dependency cycles releasing outside effects early, stale same-layer static definitions, duplicate and unstable granted identities, resolved source-dependence defaults, copiable LKI including later buffs, effective event types/control, delayed trigger filters, other-zone control reconciliation, noncreature tenure and client selection control. Regressions cover the fixes.

## Verification

Final checks on 9 October 2026, after the last implementation changes:

- Full Vitest run: **762 tests passed across 64 files**, including **30 actual source-server Socket.IO scenarios**. The four new focused Milestone 6 suites contain 65 tests; existing engine/client regressions and three new real-server scenarios cover the integrations.
- Server TypeScript: `tsc --noEmit -p tsconfig.json` passed.
- Client TypeScript: `tsc --noEmit -p src/client/tsconfig.json` passed.
- Production: `npm run build` passed, compiling the server and building 85 client modules.
- `git diff --check` passed. Final staged diff was checked before the local commit.
- Read-only independent review found a client effective-controller selection gap; a failing regression reproduced it before the component/store guards fixed it. Other review findings and scope-audit regressions are recorded above. No reported correctness finding remains unresolved.

## Extension boundary

The engine contracts and pipeline are documented in `docs/continuous-effects-engine.md`. Effective characteristics and permission checks are in scope; the separately planned targeting redesign remains later. Replacement/prevention and protection's damage/blocking/attachment consumers belong to Milestone 7 and the combat extension review. Milestone 5's manual allocation policy and open keyword hooks remain unchanged. Deliberately declared static zones cover the zones represented in the current room model; command-zone/token mechanics are not claimed.
