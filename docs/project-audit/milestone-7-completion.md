# Milestone 7 completion audit

Date: 10 October 2026. Baseline: `f44aa85` (design/plan), engine baseline `3288f7a` (Milestone 6). Existing branch: `codex/milestone-0`.

Scope: the roadmap's replacement/prevention processing, semantic removal, generic damage consumers and extended state-based settlement. No named-card mechanics, catalog additions, client components, combat auto-allocation or configuration knobs were added.

## Requirement evidence

| Requirement | Implementation | Executable evidence |
|---|---|---|
| Typed proposals before mutation | `proposed-event.types.ts`, `proposed-events.ts`; pure preview before engine commit | `proposed-events.test.ts`: order, unchanged input, split lineage; `replacement-transactions.test.ts`: uncommitted cost/push tail |
| Affected-player choices and self precedence | `replacement-rules.ts`; re-evaluation and applied-ID lineage | Order 5 doubled then prevent 3 deals 7; reverse deals 4; self-replacements and redirection scenarios; prohibited-destruction self exception |
| Consumable prevention and lifetimes | `ADD/REMOVE_REPLACEMENT_EFFECT`, monotonic room sequence, source references, cleanup expiry | `replacement-registration.test.ts`: independent targeted shields, expiry/new IDs, source-independent regeneration, unpreventable damage; finite shared shield allocation in proposal tests |
| Persisted/reconnectable decisions | Room-owned replacement and SBA continuations, resolution position and nested parent transactions | JSON reconstruction in proposal/transaction/SBA tests; three added actual-server reconnect scenarios |
| Destroy/sacrifice/transfer distinction | Semantic operations survive proposal processing; only destruction checks indestructible/regeneration | `removal-damage-rules.test.ts`: effective indestructible, sacrifice, regeneration, stale identity; zero toughness bypasses destruction in SBA tests |
| Actual damage and generic consumers | Shared damage/result stages, effective source/LKI, actual event derivation | Lifelink simultaneous survival, deathtouch, protection, infect/wither, loyalty/defense; nested result-created damage regressions; departure logging regression |
| Full simultaneous SBA batches | `state-based-planner.ts`, repeated checkpoint before trigger insertion | `state-based-extended.test.ts`: zero/lethal, tokens, attachments, legends/world, loyalty/defense/Siege, opposing counters/LKI and simultaneous losses |
| Protocol and logs remain extendable | Existing choices, generic events, explicit new delta mappings and recursive atomic result replay | `m7-boundaries.test.ts`: registration/World/cleanup/result movement parity; `sync-service.test.ts`: JSONL choice + actual poison/lifegain/damage replay |
| Ordinary draw and response continuation | Normal draw-step proposal even on an empty library; individual draw sequencing; persisted phase/combat tails | `m7-boundaries.test.ts`: failed-draw loss, sequential draw replacement, manual combat replacement returning priority |

## Named acceptance gates

- Different valid replacement orders: pure engine fixtures and both actual-server reconnect transcripts produce the expected different final damage and lifelink totals.
- Prevention changes actual damage: fully prevented damage omits damage/deathtouch/lifelink; remaining damage drives semantic events and JSONL records. Counter/life result replacement and nested new damage preserve atomicity.
- Sacrifice bypasses destruction prevention: indestructible and an unused regeneration shield do not prevent the sacrifice move.
- Attachment/legend/token convergence: illegal Auras move, including animated Auras; Equipment/nonattachments detach; multiple legend choices retain the whole batch; token death is observed before cessation.
- Simultaneous outcomes: life/poison and both failed draws yield draws independently of iteration order; simultaneous terminal and legend changes finish before reducers freeze.

## Review and verification

Read-only review covered the proposal processor and its integrations in multiple passes. Reproduced findings were fixed with regressions: draw metadata/player matching, damage created from result replacement, nested priority restoration, and animated Aura legality. Final review reported no additional concrete in-scope defect.

Final verification on 10 October 2026:

- Full Vitest suite: **819 tests passed in 70 files**, including **33 actual-server scenarios**. This adds 57 scenarios to the Milestone 6 baseline.
- Server TypeScript check: exit 0.
- Client TypeScript check: exit 0.
- Production build: exit 0; Vite built 86 modules.
- Diff whitespace check: exit 0.

One concurrent verification run timed out in the server startup hook while build/typechecks competed for resources. The complete suite subsequently passed alone with no skipped scenarios. Earlier failures led to concrete fixes; legacy turn fixtures now opt into drawable libraries, and semantic destruction assertions retain their intended rule behavior.

## Boundaries retained

The token/supertype/attachment/protector fields are the minimum foundation for these checks. Milestone 8 still owns full token/copy creation, attachment actions and casting, planeswalker loyalty actions and battle gameplay. Static replacement declarations and entry-control/copy/face consumers can be added through engine extensions alongside those families. This milestone does not claim complete MTG conformance or implement the previously deferred combat keywords. Milestone 9 still owns exotic loops, broader formats and durable restart recovery.
