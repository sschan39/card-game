# Development documents

These are working documents for individual roadmap items. Edit the relevant item when its structure or scope changes. Historical specs, execution plans and completion audits remain evidence; they are not the editable architecture reference.

Source baseline: `ad6a96e`, inspected 12 October 2026. A source inspection establishes structure, not a fresh passing test result. Proposed structures below are not implemented contracts.

## Document contract

Every item documents its purpose, existing implementation, responsibility boundaries, data flow, extension points, remaining work, acceptance evidence and conditions that require stopping. Status applies to the item, not its entire milestone. Keep current and proposed interfaces distinct. After implementation, replace proposals with actual exported names and link the scenarios that prove them.

## Shared constraints

- Engine first; named cards and playable catalog additions require separate scope.
- Preserve the authoritative `GameEngine`, pure reducer and existing choice/checkpoint pipeline.
- Card UUIDs remain stable; real zone changes advance `zoneRevision` and reset active state to the blueprint. Immutable reducer copies are compatible with this logical identity.
- Use effective characteristics and exact object references. Do not introduce card-name or catalog-ID branches in engine behavior.
- Keep settings in `src/config.ts`; room-specific setup already snapshots defaults.
- Keep full debug state available. Private outgoing views remain the deferred 0.3 item.
- Combat allocation remains manual; new combat keyword consumers remain deferred.
- Reuse existing choice transport and `ChoicePanel` for engine decisions.
- Stop before implementing an ad hoc patch: a bypass of validation, reducer, proposals, checkpoint, event or sync contracts to make a particular scenario pass. Explain the missing general contract and propose the structural change first. Normal typed rule operations and centralized defaults are not card-specific hardcoding.

## Milestone 8 item documents

| Roadmap item | Working document | State |
|---|---|---|
| Library/hidden-zone choices | [8.1 Zones and library workflows](8.1-zones-and-library.md) | Approved [operation outcomes](8.1-committed-operation-outcomes.md) and shuffle implemented; remaining workflows open |
| Attachments | [8.2 Attachments](8.2-attachments.md) | Legality/cleanup implemented; actions proposed |
| Additional card families | [8.3 Card families](8.3-card-families.md) | Partial state foundations; family actions proposed |
| Stack breadth | [8.4 Stack breadth](8.4-stack-breadth.md) | Existing choices/costs; remaining gaps identified |
| Card catalog/decks | [8.5 Catalog and decks](8.5-catalog-and-decks.md) | Separate content scope; not authorized for implementation |
| Custom ST01A | [8.6 Custom profile](8.6-custom-profile.md) | Historical requirements; separate scope |

## Milestone 0 item documents

| Item | Working document | State |
|---|---|---|
| 0.1 | [Verification gates](0.1-verification-gates.md) | Implemented |
| 0.2 | [Terminal convergence](0.2-terminal-convergence.md) | Implemented |
| 0.3 | [Private views](0.3-private-views.md) | Explicitly deferred |
| 0.4 | [Engine lifecycle](0.4-engine-lifecycle.md) | Implemented |
| 0.5 | [General integration harness](0.5-integration-harness.md) | General factory deferred; focused live tests exist |

## Milestone 1 item documents

| Item | Working document | State |
|---|---|---|
| 1.1 | [Action boundary](1.1-action-boundary.md) | Implemented with lean debug modes |
| 1.2 | [Object identity](1.2-object-identity.md) | Implemented |
| 1.3 | [Events and logging](1.3-events-logging.md) | Implemented; approved semantic outcome extension |
| 1.4 | [Rules checkpoint](1.4-rules-checkpoint.md) | Implemented |
| 1.5 | [Priority passes](1.5-priority-passes.md) | Implemented |
| 1.6 | [Incremental phases](1.6-incremental-phases.md) | Implemented |

## Coverage still to document

The full roadmap remains [the source list](../implementation-plan-2026-10-07.md). Milestones 0, 1 and all six Milestone 8 rows now have individual working documents. This does not claim the entire roadmap is documented or implemented.

- Milestone 2: ordinary turns, shortcuts, land special action, payment, mana windows/draining, setup/mulligans, cleanup.
- Milestone 3: ability actions, shared costs, targets, whole-object resolution, pending choices, counter/source information.
- Milestone 4: trigger predicates, canonical events, checkpoint scheduling, delayed/conditional/history behavior, simultaneous witnesses.
- Milestone 5: simultaneous damage, participant reconciliation, allocation, damage passes, legality hooks, damage consumers, attack destinations.
- Milestone 6: effect lifetime, layers, static scopes, permissions, registration identity.
- Milestone 7: proposed events, replacement ordering/continuations, removal/damage semantics, simultaneous state-based settlement.
- Milestone 9: turn/loop extensions, formats, durability, browser/invariant coverage, quality gates, deployment/operations.

## Updating an item

1. Inspect the named modules and tests against the current revision.
2. Revise boundaries and flow before changing behavior. Record any unresolved decision with its consequences, rather than silently selecting a shortcut.
3. Implement one independently reviewable slice after its design is accepted.
4. Record actual exported contracts, scenario paths and commands/results. Do not mark the item complete from narrow unit coverage alone.
5. Update this index and the original roadmap status without overwriting historical verification.
