# Development documents

These are working documents for individual roadmap items. Edit the relevant item when its structure or scope changes. Historical specs, execution plans and completion audits remain evidence; they are not the editable architecture reference.

Each item records its inspected source baseline. The latest documentation pass inspects `60e9349` on 12 October 2026. A source inspection establishes structure, not a fresh passing test result. Proposed structures below are not implemented contracts.

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

## Milestone 2 item documents

| Item | Working document | State |
|---|---|---|
| 2.1 | [Ordinary turns](2.1-ordinary-turns.md) | Ordinary sequence/declarations/windows implemented |
| 2.2 | [Turn shortcuts](2.2-turn-shortcuts.md) | Debug skip exists; player shortcuts open |
| 2.3 | [Land special action](2.3-land-special-action.md) | Open; hand cards still use spell route |
| 2.4 | [Mana payment](2.4-mana-payment.md) | Supported symbols/allocation choices implemented; broader costs open |
| 2.5 | [Mana abilities and lifetime](2.5-mana-abilities-and-lifetime.md) | Activated/payment consumers implemented; broader windows and boundary draining open |
| 2.6 | [Setup and mulligans](2.6-setup-and-mulligans.md) | Setup snapshots implemented; mulligans/deck construction open |
| 2.7 | [Cleanup and failed draw](2.7-cleanup-and-failed-draw.md) | Damage/effect cleanup and failed-draw loss implemented; full cleanup open |

## Milestone 3 item documents

| Item | Working document | State |
|---|---|---|
| 3.1 | [Ability actions](3.1-ability-actions.md) | Stable effective ability selection implemented |
| 3.2 | [Action cost transactions](3.2-action-cost-transactions.md) | Supported shared costs implemented |
| 3.3 | [Target groups](3.3-target-groups.md) | Grouped validation implemented; full system review deferred |
| 3.4 | [Whole-object resolution](3.4-object-resolution.md) | Legality decision/instruction cursor implemented |
| 3.5 | [Pending choices](3.5-pending-choices.md) | Current workflow continuations implemented; future workflows remain explicit |
| 3.6 | [Countering and source information](3.6-countering-and-source-information.md) | Selected counters and retained source information implemented |

## Milestone 4 item documents

| Item | Working document | State |
|---|---|---|
| 4.1 | [Trigger predicates](4.1-trigger-predicates.md) | Read-only discovery and supported filters implemented |
| 4.2 | [Canonical trigger events](4.2-canonical-trigger-events.md) | Actual supported events implemented; shuffle uses explicit outcomes |
| 4.3 | [Trigger scheduling](4.3-trigger-scheduling.md) | Two-player APNAP and persistent selections implemented |
| 4.4 | [Delayed conditions and history](4.4-delayed-conditions-and-history.md) | Supported event conditions, lifetimes and per-turn records implemented |
| 4.5 | [Simultaneous witnesses](4.5-simultaneous-witnesses.md) | Shared SBA departure witnesses implemented; new simultaneous effect families need explicit scope |

## Milestone 5 item documents

| Item | Working document | State |
|---|---|---|
| 5.1 | [Simultaneous damage](5.1-simultaneous-damage.md) | Shared atomic damage and attribution implemented |
| 5.2 | [Combat participants](5.2-combat-participants.md) | Exact live reconciliation and blocked status implemented |
| 5.3 | [Manual allocation](5.3-manual-damage-allocation.md) | Player choices implemented; auto-allocation deferred |
| 5.4 | [Damage passes](5.4-damage-passes.md) | Generic scheduling/windows implemented; keyword consumers deferred |
| 5.5 | [Declaration hooks](5.5-declaration-rule-hooks.md) | Base rules/Flying/hooks implemented; new consumers deferred |
| 5.6 | [Shared damage consumers](5.6-shared-damage-consumers.md) | Generic results/prevention implemented in Milestone 7; assignment consumers remain separate |
| 5.7 | [Attack destinations](5.7-attack-destinations.md) | Open; declarations derive one opposing player |

## Milestone 6 item documents

| Item | Working document | State |
|---|---|---|
| 6.1 | [Effect lifetime](6.1-effect-lifetime.md) | Independent resolved/frozen characteristic effects implemented |
| 6.2 | [Characteristic layers](6.2-characteristic-layers.md) | Supported operations/dependencies and shared facade implemented |
| 6.3 | [Static scopes](6.3-static-scopes.md) | Dynamic query-time statics and grouped continuations implemented |
| 6.4 | [Permissions](6.4-characteristic-permissions.md) | Supported effective consumers implemented; access/blocking extensions open |
| 6.5 | [Effect and grant identity](6.5-effect-and-grant-identity.md) | Stable identities and ordering/removal implemented |

## Milestone 7 item documents

| Item | Working document | State |
|---|---|---|
| 7.1 | [Proposed events](7.1-proposed-event-boundary.md) | Typed prepare-before-commit boundary implemented |
| 7.2 | [Replacement choices/shields](7.2-replacement-choices-and-shields.md) | Supported operation registry and nested continuations implemented |
| 7.3 | [Removal/damage semantics](7.3-removal-and-damage-semantics.md) | Supported destruction/sacrifice/results implemented |
| 7.4 | [Simultaneous SBAs](7.4-simultaneous-state-based-actions.md) | Supported batch/decision settlement implemented; family actions remain open |

## Milestone 8 item documents

| Item | Working document | State |
|---|---|---|
| 8.1 | [Zones and library workflows](8.1-zones-and-library.md) | [Outcomes/shuffle](8.1-committed-operation-outcomes.md), [ordered operations](8.1-ordered-library-operations.md) and [ordered search](8.1-ordered-card-search.md) implemented; [reveal](8.1-reveal-lifecycle.md) deferred until a consumer; access open |
| 8.2 | [Attachments](8.2-attachments.md) | Legality/cleanup implemented; [generic operations](8.2-attachment-operations.md) and Aura/equip flows deferred until a concrete consumer |
| 8.3 | [Card families](8.3-card-families.md) | Partial foundations; [integration gaps reviewed](8.3-family-integration-review.md); next family slice open |
| 8.4 | [Stack breadth](8.4-stack-breadth.md) | Existing choices/costs; remaining gaps identified |
| 8.5 | [Catalog and decks](8.5-catalog-and-decks.md) | Separate content scope; not authorized for implementation |
| 8.6 | [Custom profile](8.6-custom-profile.md) | Historical requirements; separate scope |

## Milestone 9 item documents

| Item | Working document | State |
|---|---|---|
| 9.1 | [Turn extensions/loops](9.1-turn-extensions-and-loops.md) | Open; ordinary cursor and damage passes are foundations |
| 9.2 | [Multiplayer/formats](9.2-multiplayer-and-formats.md) | Future scope requiring explicit format semantics |
| 9.3 | [Durable replay/recovery](9.3-durable-replay-and-recovery.md) | JSON/delta foundations; durability/sequences/migrations open |
| 9.4 | [Browser/invariant coverage](9.4-browser-and-invariant-coverage.md) | Socket/component tests exist; automated browser/property harness open |
| 9.5 | [Quality/fixture isolation](9.5-quality-gates-and-fixture-isolation.md) | Gates/negative tests exist; coverage policy/immutable boundary open |
| 9.6 | [Deployment/operations](9.6-deployment-and-operations.md) | Local build exists; hosting/durability/load verification open |

## Roadmap coverage and implementation queue

The [original roadmap](../implementation-plan-2026-10-07.md) has 57 individual numbered tasks/table rows/bullets across Milestones 0–9. Each has a document above, including deferred and separately scoped work. For milestones whose original rows were unnumbered, this index assigns numbers in their existing order. The operation-outcome prerequisite is an additional 8.1 contract, not an extra roadmap row.

Documentation coverage does not claim all implementation is complete. Open/deferred status and acceptance gaps remain visible in each item. Continue engine implementation one independently reviewable slice at a time. The 8.1 ordered-operation primitives and interactive ordered search are implemented; cross-zone casting remains open, while reveal is deferred until a concrete consumer establishes its needs. Do not resume explicitly deferred reveal infrastructure, private views, new combat keyword consumers or separately scoped named/custom content silently.

## Updating an item

1. Inspect the named modules and tests against the current revision.
2. Revise boundaries and flow before changing behavior. Record any unresolved decision with its consequences, rather than silently selecting a shortcut.
3. Implement one independently reviewable slice after its design is accepted.
4. Record actual exported contracts, scenario paths and commands/results. Do not mark the item complete from narrow unit coverage alone.
5. Update this index and the original roadmap status without overwriting historical verification.
