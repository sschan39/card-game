# State, Session, and Registry Reassessment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Correct the setup-contract dependency inversion, preserve the proven `GameRoom`/`RoomRuntime` boundary, and close every remaining registry finding with an evidence-backed ownership decision rather than speculative infrastructure.

**Architecture:** Move only the serializable `SetupConfig` contract into `src/types` and enforce that type declarations cannot import executable configuration. Keep `GameRoom` as the serialized match aggregate and `RoomRuntime` as the owner of process-local session resources. Audit combat, damage, target-modifier, replacement-operation, and numeric-query registries one by one; retain each unless current production composition proves a per-match owner and isolation need.

**Tech Stack:** TypeScript 6, Vitest 4, existing TypeScript-AST import graph, Markdown architecture records, Git.

## Global Constraints

- Preserve the serialized `GameRoom`, socket payload, reconnect, persistence, and delta shapes.
- Preserve room creation, joining, RPS setup, debug settings, gameplay, and rules ordering.
- Preserve all built-in combat, damage, targeting, replacement, and numeric behavior.
- Do not rename `GameRoom`, introduce nested `game`/`session` objects, or migrate its engine-wide consumers solely for conceptual symmetry.
- Do not add a dependency-injection framework, service locator, universal `RuleSet`, or plugin lifecycle.
- Assess registries one at a time; retaining a cohesive registry is correct when no current per-match owner or production variation exists.
- Do not migrate a registry without a failing supported-production isolation test and an explicit construction owner.
- No mechanics, cards, UI behavior, settings, or protocol changes.
- Keep branch `codex/architecture-boundaries` as-is; do not push, merge, or open a pull request.

---

### Task 1: Put the setup contract below executable configuration

**Files:**
- Create: `src/types/setup-config.types.ts`
- Modify: `src/config.ts`
- Modify: `src/types/game.room.types.ts`
- Modify: `src/engine/room-factory.ts`
- Modify: `tests/architecture/import-graph.ts`
- Modify: `tests/architecture/import-boundaries.test.ts`
- Modify: `docs/architecture-import-policy.md`

**Interfaces:**
- Produces: `SetupConfig` from `src/types/setup-config.types.ts` with the exact existing fields.
- Preserves: `SetupConfig` as a type re-export from `src/config.ts` for source compatibility.
- Enforces: `ArchitecturePolicyViolations.typesToExecutableConfig: string[]` over all runtime and type-only imports.
- Preserves: `gameConfig`, `landPlayLimit()`, and `snapshotSetupConfig()` signatures and behavior.

- [ ] **Step 1: Extend the architecture policy with a failing type-to-config edge check**

In `tests/architecture/import-graph.ts`, add this field:

```ts
export interface ArchitecturePolicyViolations {
  runtimeCycles: string[][];
  cardContentToEngine: string[];
  typesToExecutableConfig: string[];
  engineToTransport: string[];
  transportToHandlers: string[];
  transportEntryToEngine: string[];
  unexpectedClientRuntimeEngine: string[];
  missingClientRuntimeEngine: string[];
}
```

In `architecturePolicyViolations()`, add this return member using the existing `allEdges` and
`renderEdge` values:

```ts
typesToExecutableConfig: allEdges
  .filter(edge => edge.from.startsWith('src/types/') && edge.to === 'src/config.ts')
  .map(renderEdge),
```

Extend the existing policy fixture in `tests/architecture/import-boundaries.test.ts`:

```ts
all: new Map([
  ['src/engine/rule.ts', new Set(['src/server.ts'])],
  ['src/library/parser.ts', new Set(['src/engine/internal.ts'])],
  ['src/types/room.ts', new Set(['src/config.ts'])],
  ['src/server.ts', new Set([
    'src/engine/game-engine.ts',
    'src/engine/handlers/concrete.ts',
  ])],
]),
```

Add the corresponding expected property to that fixture assertion:

```ts
typesToExecutableConfig: ['src/types/room.ts -> src/config.ts'],
```

Add this repository assertion after the card-content assertion:

```ts
it('keeps type declarations independent of executable configuration', () => {
  expect(policy.typesToExecutableConfig,
    `Type-to-config imports:\n${policy.typesToExecutableConfig.join('\n')}`).toEqual([]);
});
```

- [ ] **Step 2: Run the architecture gate and verify RED**

Run:

```powershell
npm run test:architecture
```

Expected: FAIL only in `keeps type declarations independent of executable configuration`, listing:

```text
src/types/game.room.types.ts -> src/config.ts
```

- [ ] **Step 3: Create the stable setup contract and preserve the old type export**

Create `src/types/setup-config.types.ts`:

```ts
export interface SetupConfig {
  startingLife: number;
  openingHandSize: number;
  firstPlayerDrawsOnFirstTurn: boolean;
  shuffleDevelopmentDeck: boolean;
  developmentDeck: string[];
  landPlaysPerTurn?: number;
  /** Opt-in starter rule; the confirmed creature threshold is attack + maximum health. */
  scorch?: boolean;
}
```

In `src/config.ts`, import and re-export the type:

```ts
import type { SetupConfig } from './types/setup-config.types';
export type { SetupConfig } from './types/setup-config.types';
```

Remove the local `SetupConfig` declaration from `src/config.ts`. Do not change any configuration
objects, fallback logic, validation, or snapshot code.

- [ ] **Step 4: Point domain consumers at the stable contract**

In `src/types/game.room.types.ts`, replace the executable-config import with:

```ts
import type { SetupConfig } from './setup-config.types';
```

In `src/engine/room-factory.ts`, split the current import so runtime values still come from config
and the type comes from the type layer:

```ts
import { gameConfig, snapshotSetupConfig } from '../config';
import type { SetupConfig } from '../types/setup-config.types';
```

No other runtime imports from `src/config.ts` move in this task.

- [ ] **Step 5: Document architecture rule 8**

Append this rule under `## Enforced rules` in `docs/architecture-import-policy.md`:

```md
8. Type declarations under `src/types/**` cannot import executable `src/config.ts`, including
   type-only imports. Serializable configuration contracts belong in `src/types/**`; runtime
   defaults, validation, and snapshot construction remain in `src/config.ts`.
```

Update the paragraph after the list to state that this rule also uses the all-import graph.

- [ ] **Step 6: Run focused verification**

Run:

```powershell
npm run test:architecture
npx vitest run --pool=threads --maxWorkers=1 --silent=true tests/engine/play-land.test.ts tests/engine/room-factory.test.ts tests/server/room-runtime.test.ts tests/server/reconnect.test.ts
npm run typecheck:server
npm run typecheck:client
git diff --check
```

Expected: architecture has 14 passing tests; all focused tests and both typechecks pass; diff check
reports no errors.

- [ ] **Step 7: Commit the setup boundary**

```powershell
git add src/types/setup-config.types.ts src/config.ts src/types/game.room.types.ts src/engine/room-factory.ts tests/architecture/import-graph.ts tests/architecture/import-boundaries.test.ts docs/architecture-import-policy.md
git commit -m "refactor: separate setup contracts from runtime config"
```

---

### Task 2: Record the state/session boundary decision

**Files:**
- Modify: `ARCHITECTURE.md`
- Modify: `docs/MAP.md`
- Modify: `docs/architecture-audit-2026-10-19.md`

**Interfaces:**
- Consumes: the existing `GameRoom`, `RoomRuntime`, reconnect helpers, and `StateStore` ownership.
- Produces: an explicit current boundary and future trigger for a `RoomSession` abstraction.
- Preserves: every serialized field and runtime owner; no source file moves.

- [ ] **Step 1: Re-run the state/session evidence searches**

Run:

```powershell
rg -n "GameRoom" src --glob "*.ts" --stats
rg -n "engines =|socketRooms =|destroyTimers =|createIdentityMaps|StateStore|RoomRuntimePorts" src/server --glob "*.ts"
rg -n "Socket|setTimeout|StateStore|GameEngine" src/types/game.room.types.ts
```

Expected:

- `GameRoom` remains broadly consumed by the engine;
- process-local engines, socket bindings, destruction timers, identity maps, store access, and
  transport ports remain in `RoomRuntime` or focused server modules;
- `game.room.types.ts` contains none of those process-resource types.

If the third search finds a process resource in `GameRoom`, stop this task and revise the design
before documenting a retain decision.

- [ ] **Step 2: Update `ARCHITECTURE.md` with the retained boundary**

Add a subsection under the room/runtime architecture that states:

```md
#### Serialized match state versus process session state

`GameRoom` remains the serialized authoritative match aggregate: player membership, setup/debug
snapshots, RPS/game status, phases, priority, stack, choices, cards, combat, and effects all affect
rule execution or recovery. `RoomRuntime` owns process-local session resources: engine instances,
socket-to-room and player identity bindings, destruction timers, runtime capabilities, store
coordination, and transport ports. Sockets, timers, stores, and engine objects are never serialized.

A separate `RoomSession` wrapper is intentionally absent. It becomes justified only when a
concrete transport or persistence feature needs one object to own several process resources and
removes duplicated lifecycle behavior from `RoomRuntime`; renaming or nesting `GameRoom` alone
would not improve the current boundary.
```

Update the directory map so `setup-config.types.ts` is listed under `src/types/`.

- [ ] **Step 3: Update `docs/MAP.md` ownership guidance**

Add or update ownership rows so they say:

```md
| **Serialized match state** | `GameRoom` | `types/game.room.types.ts` | Rule and recovery state, including membership/setup/RPS | Own sockets, timers, stores, or engine instances |
| **Process room session** | `RoomRuntime` | `server/room-runtime.ts`, `reconnect.ts`, `state-store.ts` | Engines, identities, timers, lifecycle, persistence coordination, ports | Be serialized into `GameRoom` |
```

Remove `GameRoom` mixing from `Known rough edges`. Replace it with a short statement that the
boundary was reassessed and retained because process resources are already external.

- [ ] **Step 4: Append the resolution to the dated audit**

Keep the original `GameRoom` finding intact. Append this resolution directly below it:

```md
**Resolved by reassessment in Slice 9:** the one confirmed ownership defect was the
`GameRoom -> config.ts` type edge; `SetupConfig` now belongs to `src/types`. The serialized
aggregate otherwise contains match/recovery state, while engines, sockets, identity maps, timers,
stores, and transport ports already belong to `RoomRuntime` and focused server modules. A
`RoomSession` wrapper or broad `GameState` migration would add indirection without removing current
coupling, so the existing aggregate is retained. Reconsider only when a concrete feature creates
duplicated process-resource lifecycle ownership.
```

- [ ] **Step 5: Check documentation and commit**

Run:

```powershell
git diff --check
rg -n "RoomSession|process-local|setup-config.types" ARCHITECTURE.md docs/MAP.md docs/architecture-audit-2026-10-19.md
```

Expected: the new retained-boundary text is present, and diff check reports no errors.

Commit:

```powershell
git add ARCHITECTURE.md docs/MAP.md docs/architecture-audit-2026-10-19.md
git commit -m "docs: record state session boundary"
```

---

### Task 3: Close each global-registry finding with current evidence

**Files:**
- Modify: `docs/architecture-audit-2026-10-19.md`
- Modify: `docs/MAP.md`
- Modify only if the audit contradicts the expected cleanup result:
  - `tests/engine/combat-choices.test.ts`
  - `tests/engine/combat-state.test.ts`
  - `tests/engine/counter-events.test.ts`
  - `tests/engine/damage-pipeline.test.ts`
  - `tests/engine/m7-boundaries.test.ts`
  - `tests/engine/object-resolution.test.ts`
  - `tests/engine/proposed-events.test.ts`
  - `tests/engine/replacement-transactions.test.ts`
  - `tests/engine/source-information.test.ts`
  - `tests/engine/target-groups.test.ts`

**Interfaces:**
- Produces: one ownership/lifecycle/decision/future-trigger record for each of five registry groups.
- Preserves: all registry exports, built-in order, test extension behavior, and engine composition.
- Requires: every disposer-returning temporary test registration executes through a guaranteed
  `finally` or framework `afterEach` cleanup path.

- [ ] **Step 1: Inventory production composition one registry at a time**

Run these separately and record their exact production call sites:

```powershell
rg -n "CombatRuleRegistry\.register\(" src --glob "*.ts"
rg -n "DamageRuleRegistry\.register\(" src --glob "*.ts"
rg -n "ModifierRegistry\.registerTargetRule\(" src --glob "*.ts"
rg -n "registerReplacementOperation\(" src --glob "*.ts"
rg -n "registerNumericQuery\(" src --glob "*.ts"
```

Expected evidence:

- combat: no production extension registration;
- damage: no production extension registration;
- target modifiers: no production extension registration;
- replacement operations: built-ins register in `src/engine/replacement-rules.ts` during module
  initialization;
- numeric queries: built-ins register in `src/shared/numeric-values.ts` and serve both parser
  validation and runtime evaluation.

Any additional production registration is new evidence. Classify its construction owner and
lifecycle before retaining or migrating that registry; do not continue from the expected table.

- [ ] **Step 2: Audit temporary registration cleanup**

Run:

```powershell
rg -n "CombatRuleRegistry\.register\(|DamageRuleRegistry\.register\(|ModifierRegistry\.registerTargetRule\(|registerReplacementOperation\(" tests --glob "*.test.ts"
```

Inspect every returned disposer. Expected: every temporary registration is enclosed by a
`try/finally` that calls the disposer or is tracked by a framework `afterEach` cleanup.
Numeric-query tests are excluded because
`registerNumericQuery()` intentionally has no disposer and establishes a unique schema query for
that isolated test process.

If any disposer can be skipped after an assertion failure, wrap the existing test body exactly as:

```ts
const dispose = registerTemporaryRule();
try {
  // Existing assertions remain unchanged.
} finally {
  dispose();
}
```

Do not add reset APIs, singleton replacement, or test-only production branches.

- [ ] **Step 3: Run focused registry tests after any cleanup edits**

Run:

```powershell
npx vitest run --pool=threads --maxWorkers=1 --silent=true tests/engine/combat-choices.test.ts tests/engine/combat-state.test.ts tests/engine/counter-events.test.ts tests/engine/damage-pipeline.test.ts tests/engine/m7-boundaries.test.ts tests/engine/numeric-values.test.ts tests/engine/object-resolution.test.ts tests/engine/proposed-events.test.ts tests/engine/replacement-transactions.test.ts tests/engine/source-information.test.ts tests/engine/target-groups.test.ts
```

Expected: all selected tests pass. If Step 2 required no edits, this command supplies fresh evidence
for the documented retain decisions.

- [ ] **Step 4: Append the registry decision table to the audit**

Keep the original global-registry finding intact. Append this table and explanatory text:

```md
**Resolved by reassessment in Slice 9:** shared mutation remains a real architectural property,
but current production composition has no independently configured match rule sets. Introducing a
universal per-engine rules object would therefore add dependency plumbing without a current owner.

| Registry | Current production owner/lifecycle | Slice 9 decision | Concrete migration trigger |
|---|---|---|---|
| Combat rules | Engine module; Flying and Trample are built-ins; temporary extensions are tests | Retain | A match format composes different combat semantics for simultaneous rooms |
| Damage rules | Engine module; no production registrations; temporary extensions are tests | Retain | A production match constructor supplies damage hooks |
| Target modifiers | Built-in permission helpers plus a test-only target-rule seam | Retain | Production composition supplies room-specific permission extensions |
| Replacement operations | Engine operation vocabulary initialized once; snapshots serialize operation IDs/data, not functions | Retain | An application/plugin composition phase defines operation vocabulary and snapshot compatibility before rooms load |
| Numeric queries | Shared schema vocabulary initialized before catalog validation and reused at runtime | Retain process-wide | Catalog composition defines and freezes a query vocabulary before blueprint publication |

Every disposer-returning test extension has a guaranteed `finally` or framework `afterEach`
cleanup path. These retain decisions do not claim that mutable globals are ideal; they state that
per-match migration is unsupported until a real construction owner exists.
```

- [ ] **Step 5: Update the repository map**

In `docs/MAP.md`, replace the blanket global-registry rough edge with a concise link to the audit
and this ownership rule:

```md
- **Rule extension registries are process-level vocabularies today.** Slice 9 retained combat,
  damage, target-modifier, replacement-operation, and numeric-query registries because current
  production composition has no per-match variants. Migrate one only when a real match/catalog
  constructor owns distinct instances; see the dated architecture audit.
```

- [ ] **Step 6: Check the decision record and commit**

Run:

```powershell
git diff --check
rg -n "Combat rules|Damage rules|Target modifiers|Replacement operations|Numeric queries|migration trigger" docs/architecture-audit-2026-10-19.md docs/MAP.md
```

Expected: all five decisions and migration triggers are present; diff check reports no errors.

Commit the documentation and only those test files actually changed in Step 2:

```powershell
git add docs/architecture-audit-2026-10-19.md docs/MAP.md tests/engine/combat-choices.test.ts tests/engine/combat-state.test.ts tests/engine/counter-events.test.ts tests/engine/damage-pipeline.test.ts tests/engine/m7-boundaries.test.ts tests/engine/object-resolution.test.ts tests/engine/proposed-events.test.ts tests/engine/replacement-transactions.test.ts tests/engine/source-information.test.ts tests/engine/target-groups.test.ts
git commit -m "docs: record rule registry ownership decisions"
```

---

### Task 4: Close, review, and verify the modernization roadmap

**Files:**
- Modify: `docs/architecture-modernization-roadmap-2026-10-19.md`
- Modify: `ARCHITECTURE.md`
- Modify: `docs/MAP.md`
- Modify: `docs/architecture-audit-2026-10-19.md`

**Interfaces:**
- Consumes: committed Tasks 1-3 and all nine modernization slices.
- Produces: a current architecture record, completed roadmap, independent review, and verified
  branch checkpoint.

- [ ] **Step 1: Mark Slice 9 complete without overstating migration**

In `docs/architecture-modernization-roadmap-2026-10-19.md`, change the heading to:

```md
### ✅ Slice 9 — reassess state/session separation and global rule registries
```

Append:

```md
Completed: the serializable setup contract now belongs to `src/types`, and an all-import
architecture rule prevents type declarations from depending on executable configuration.
`GameRoom` remains the serialized match/recovery aggregate because `RoomRuntime` already owns
engines, identities, timers, persistence coordination and transport ports. Each remaining registry
was assessed independently and retained with an explicit owner and migration trigger; current
production composition has no per-match rule-set variants, while numeric queries must exist before
catalog validation. No room-shape, registry API, mechanic, protocol or runtime behavior changed.
```

Update current test counts in `ARCHITECTURE.md` only after Step 2 reports the exact totals. Update
the closing status in `docs/MAP.md` and the audit's recommended-order list so Slice 9 is marked
complete.

- [ ] **Step 2: Run the complete verification gate**

Run:

```powershell
npx vitest run --pool=threads --maxWorkers=1 --silent=true --exclude tests/server/live-routing.test.ts
npx vitest run --pool=threads --maxWorkers=1 --silent=true tests/server/live-routing.test.ts
npm run test:architecture
npm run typecheck:server
npm run typecheck:client
npm run build
git diff --check
```

Run the live-routing command outside a restricted network sandbox when localhost WebSocket
connections are unavailable inside it. Expected:

- 1,342 non-live tests across 113 files;
- 49 live-routing tests;
- 14 architecture tests;
- both typechecks pass;
- production build passes with only the known Node 22.10 versus Vite 22.12+ warning;
- diff check reports no errors.

Use the actual reported totals in documentation if they differ because the repository gained tests
before execution.

- [ ] **Step 3: Request independent review of the complete Slice 9 range**

Set the review base to the Slice 8 documentation commit and head to current `HEAD`:

```powershell
git rev-parse 155b5d9
git rev-parse HEAD
git diff --stat 155b5d9..HEAD
git diff 155b5d9..HEAD
```

The reviewer must inspect:

- exact `SetupConfig` shape and source compatibility;
- absence of runtime or serialized changes;
- strength of the all-import `types -> config` rule;
- `GameRoom`/`RoomRuntime` evidence;
- all five registry call-site inventories;
- temporary registration cleanup;
- whether any retain decision hides a current per-match construction owner;
- documentation accuracy and unnecessary abstraction.

Fix every Critical or Important finding with a focused red-green test. Verify each fix before
requesting re-review. Minor documentation corrections may be applied directly and checked with
`git diff --check`.

- [ ] **Step 4: Commit the roadmap closure**

```powershell
git add ARCHITECTURE.md docs/MAP.md docs/architecture-audit-2026-10-19.md docs/architecture-modernization-roadmap-2026-10-19.md
git commit -m "docs: close architecture modernization roadmap"
```

- [ ] **Step 5: Re-run verification against committed state**

Repeat every command from Step 2 after review fixes and the documentation commit. Confirm:

```powershell
git status --short
git branch --show-current
git log --oneline 155b5d9..HEAD
```

Expected: status is empty, branch is `codex/architecture-boundaries`, and the range contains the
Slice 9 design, plan, implementation, evidence, and closure commits.

Report the modernization program as 9/9 complete, retain the branch as-is, and pause the standing
goal after the whole slice is verified.
