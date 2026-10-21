# Deterministic Runtime Dependencies Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Route authoritative UUID generation and setup randomness through one explicit runtime context while preserving production behavior and serialized contracts.

**Architecture:** Add a two-capability `RuntimeContext` with UUID v4 and `Math.random` defaults. Thread it through existing constructor/function seams in card setup, `GameEngine`, `MutationCommitter`, and `RoomRuntime`; keep the effect pipeline's narrower random-only interface and all existing cohesive subsystems intact.

**Tech Stack:** TypeScript 6, Vitest 4, UUID 11, Express/Socket.IO server.

## Global Constraints

- Production UUIDs remain UUID v4 and production randomness remains `Math.random`.
- Existing callers may omit dependencies and retain current behavior.
- Runtime dependencies never enter `GameRoom`, snapshots, continuations, deltas, or logs.
- Preserve the existing `StateStore`, `SyncService`, reconnect, action registry, and rules modules.
- Do not add clock injection, a dependency container, global mutable configuration, seeded-RNG policy, replay infrastructure, or gameplay mechanics.
- Client UUIDs, observational timestamps, card-catalog immutability, `GameRoom` separation, and global registries remain outside Slice 7.
- Follow red-green-refactor for every production change and commit each task independently.

---

### Task 1: Establish the runtime context and deterministic card setup

**Files:**
- Create: `src/shared/runtime-context.ts`
- Modify: `src/engine/effect-context.ts`
- Modify: `src/library/card-factory.ts`
- Modify: `src/engine/room-factory.ts`
- Create: `tests/library/card-factory.test.ts`
- Modify: `tests/engine/room-factory.test.ts`

**Interfaces:**
- Produces: `RuntimeContext`, `defaultRuntimeContext`.
- Produces: `instantiateCard(cardId, context?)` with a UUID-only capability.
- Produces: optional context parameters on `setupRPS`, `buildTestDeck`, and `buildStartingCardMutations`.
- Preserves: all existing one-argument card-factory and room-factory call sites.

- [ ] **Step 1: Write the failing card UUID test**

Create `tests/library/card-factory.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { instantiateCard } from '../../src/library/card-factory';

describe('instantiateCard runtime dependencies', () => {
  it('uses the supplied UUID capability', () => {
    const card = instantiateCard('empire-servant', { uuid: () => 'card-1' });
    expect(card.uuid).toBe('card-1');
  });
});
```

- [ ] **Step 2: Run the card test and verify RED**

Run:

```powershell
npx vitest run --pool=threads --maxWorkers=1 tests/library/card-factory.test.ts
```

Expected: FAIL because `instantiateCard` ignores the supplied capability and returns a UUID v4.

- [ ] **Step 3: Add the context and card-factory seam**

Create `src/shared/runtime-context.ts`:

```ts
import { v4 as uuidv4 } from 'uuid';

export interface RuntimeContext {
  uuid(): string;
  random(): number;
}

export const defaultRuntimeContext: RuntimeContext = {
  uuid: uuidv4,
  random: Math.random,
};
```

Update `effect-context.ts` so its existing contract remains random-only and its default delegates to
`defaultRuntimeContext.random`. Update `instantiateCard` to accept
`Pick<RuntimeContext, 'uuid'> = defaultRuntimeContext` and call `context.uuid()`.

- [ ] **Step 4: Run the card test and verify GREEN**

Run the Step 2 command. Expected: 1 test passes.

- [ ] **Step 5: Write failing deterministic setup tests**

In `tests/engine/room-factory.test.ts`, replace the global `Math.random` spy test with an injected
context test:

```ts
it('uses injected UUIDs and randomness while preserving the configured multiset', () => {
  const uuid = vi.fn(() => `card-${uuid.mock.calls.length}`);
  const random = vi.fn(() => 0);
  const setup = { ...gameConfig.setup, shuffleDevelopmentDeck: true };
  const deck = buildTestDeck('p1', setup, { uuid, random });

  expect(uuid).toHaveBeenCalledTimes(setup.developmentDeck.length);
  expect(random).toHaveBeenCalledTimes(setup.developmentDeck.length - 1);
  expect(deck.map(card => card.uuid).sort()).toEqual(
    Array.from({ length: setup.developmentDeck.length }, (_, index) => `card-${index + 1}`).sort(),
  );
  expect(deck.map(card => card.blueprint.id).sort()).toEqual([...setup.developmentDeck].sort());
});
```

Add an RPS test using a fresh UUID sequence and assert the six dealt cards receive exactly those six
IDs.

- [ ] **Step 6: Run room-factory tests and verify RED**

Run:

```powershell
npx vitest run --pool=threads --maxWorkers=1 tests/engine/room-factory.test.ts
```

Expected: the injected setup tests fail because room-factory does not yet forward dependencies.

- [ ] **Step 7: Thread context through room setup**

Implement these compatible signatures:

```ts
export function setupRPS(
  room: GameRoom,
  context: Pick<RuntimeContext, 'uuid'> = defaultRuntimeContext,
): void;

export function buildTestDeck(
  playerId: PlayerId,
  setup: SetupConfig = gameConfig.setup,
  context: RuntimeContext = defaultRuntimeContext,
): CardInstance[];

export function buildStartingCardMutations(
  room: GameRoom,
  context: RuntimeContext = defaultRuntimeContext,
): GameMutation[];
```

Use `instantiateCard(id, context)` and `context.random()` in Fisher-Yates. Remove the unused direct
UUID import from `room-factory.ts`.

- [ ] **Step 8: Verify Task 1 and commit**

Run:

```powershell
npx vitest run --pool=threads --maxWorkers=1 tests/library/card-factory.test.ts tests/engine/room-factory.test.ts
npm run typecheck:server
git diff --check
```

Expected: all pass. Commit:

```powershell
git add src/shared/runtime-context.ts src/engine/effect-context.ts src/library/card-factory.ts src/engine/room-factory.ts tests/library/card-factory.test.ts tests/engine/room-factory.test.ts
git commit -m "refactor: inject deterministic room setup dependencies"
```

---

### Task 2: Route engine and commit identities through the context

**Files:**
- Modify: `src/engine/game-engine.ts`
- Modify: `src/engine/mutation-committer.ts`
- Create: `tests/engine/runtime-context.test.ts`

**Interfaces:**
- Consumes: `RuntimeContext`, `defaultRuntimeContext` from Task 1.
- Produces: `GameEngine(room, Partial<RuntimeContext>?, actionRegistry?)`.
- Preserves: existing `{ random }` callers and action-registry constructor position.

- [ ] **Step 1: Write failing command and batch identity tests**

Create `tests/engine/runtime-context.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { GameEngine } from '../../src/engine/game-engine';
import { createTestRoom } from '../helpers/test-room-factory';

describe('GameEngine runtime context', () => {
  it('uses one injected UUID source for implicit command and batch identities', () => {
    const ids = ['command-1', 'batch-1'];
    const engine = new GameEngine(createTestRoom(), { uuid: () => ids.shift()! });

    engine.withCommandContext('test', 'player1', () => {
      engine.applyMutations([{ type: 'SET_LIFE', playerId: 'player1', amount: 19 }]);
    });

    const [batch] = engine.drainEventBatches();
    expect(batch.command?.commandId).toBe('command-1');
    expect(batch.batchId).toBe('batch-1');
    engine.dispose();
  });

  it('keeps caller-supplied command IDs without consuming a UUID', () => {
    let calls = 0;
    const engine = new GameEngine(createTestRoom(), { uuid: () => `generated-${++calls}` });
    engine.withCommandContext('test', 'player1', () => undefined, 'supplied-command');
    expect(calls).toBe(0);
    engine.dispose();
  });
});
```

- [ ] **Step 2: Run the tests and verify RED**

Run:

```powershell
npx vitest run --pool=threads --maxWorkers=1 tests/engine/runtime-context.test.ts
```

Expected: the implicit command/batch test fails because both paths still call UUID v4 directly.

- [ ] **Step 3: Resolve and use the engine context**

In `GameEngine`, replace `Partial<EffectContext>` with `Partial<RuntimeContext>`, merge it once with
`defaultRuntimeContext`, pass `{ random: runtimeContext.random }` to the effect pipeline, and make
`generateUuid()` plus implicit command IDs call the resolved UUID capability.

In `MutationCommitter`, replace the direct `uuidv4()` batch ID with `this.generateUuid()` and remove
the direct UUID import. Do not change its constructor because it already receives the correct
callback.

- [ ] **Step 4: Verify Task 2 and commit**

Run:

```powershell
npx vitest run --pool=threads --maxWorkers=1 tests/engine/runtime-context.test.ts tests/engine/operation-outcomes.test.ts tests/engine/game-engine.test.ts
npm run typecheck:server
git diff --check
```

Expected: all pass. Commit:

```powershell
git add src/engine/game-engine.ts src/engine/mutation-committer.ts tests/engine/runtime-context.test.ts
git commit -m "refactor: inject engine identity generation"
```

---

### Task 3: Compose one context through the multiplayer runtime

**Files:**
- Modify: `src/server/room-runtime.ts`
- Modify: `tests/server/room-runtime.test.ts`
- Modify: `tests/architecture/import-boundaries.test.ts`
- Modify: `docs/architecture-import-policy.md`

**Interfaces:**
- Consumes: Tasks 1-2 runtime context and compatible setup/engine APIs.
- Produces: optional fourth `RoomRuntime` constructor argument `Partial<RuntimeContext>`.
- Preserves: the existing third `gracePeriodMs` argument and all transport/event contracts.

- [ ] **Step 1: Write failing runtime-context tests**

Add a local runtime constructor helper in `tests/server/room-runtime.test.ts` that can supply a
partial context. Add tests that:

1. create a room with `uuid: () => 'room-1'` and expect `roomId === 'room-1'`;
2. execute a missing-room packet without `commandId` and expect the injected next UUID;
3. supply `commandId: 'client-command'` and assert the UUID provider is not called for that command;
4. create and join using a sequence and assert all six RPS card UUIDs come from the same sequence.

- [ ] **Step 2: Run the runtime tests and verify RED**

Run:

```powershell
npx vitest run --pool=threads --maxWorkers=1 tests/server/room-runtime.test.ts
```

Expected: new deterministic assertions fail because `RoomRuntime` still calls UUID v4 directly and
does not forward a context.

- [ ] **Step 3: Add a failing static regression gate**

In `tests/architecture/import-boundaries.test.ts`, read these authoritative sources:

```ts
const explicitRuntimeContextSources = [
  'src/library/card-factory.ts',
  'src/engine/room-factory.ts',
  'src/engine/game-engine.ts',
  'src/engine/mutation-committer.ts',
  'src/server/room-runtime.ts',
];
```

Assert none contains a runtime import from `uuid` or a `Math.random` member access. Verify the test
fails on `src/server/room-runtime.ts` before its final direct calls are removed, then passes
afterward. Document the exact protected
scope and allowed production default in `docs/architecture-import-policy.md`.

- [ ] **Step 4: Thread the resolved context through RoomRuntime**

Keep constructor compatibility:

```ts
constructor(
  private readonly store: StateStore,
  private readonly ports: RoomRuntimePorts,
  private readonly gracePeriodMs = 30_000,
  dependencies: Partial<RuntimeContext> = {},
) {
  this.runtimeContext = { ...defaultRuntimeContext, ...dependencies };
}
```

Use `runtimeContext.uuid()` for room/fallback command IDs. Pass the same context to every
`GameEngine`, `setupRPS`, and `buildStartingCardMutations` call. Remove the direct UUID import.

- [ ] **Step 5: Verify Task 3 and commit**

Run:

```powershell
npx vitest run --pool=threads --maxWorkers=1 tests/server/room-runtime.test.ts
npm run test:architecture
npm run typecheck:server
git diff --check
```

Expected: all pass. Commit:

```powershell
git add src/server/room-runtime.ts tests/server/room-runtime.test.ts tests/architecture/import-boundaries.test.ts docs/architecture-import-policy.md
git commit -m "refactor: compose deterministic multiplayer runtime"
```

---

### Task 4: Document and verify Slice 7

**Files:**
- Modify: `ARCHITECTURE.md`
- Modify: `docs/MAP.md`
- Modify: `docs/architecture-audit-2026-10-19.md`
- Modify: `docs/architecture-modernization-roadmap-2026-10-19.md`

**Interfaces:**
- Consumes: committed Tasks 1-3.
- Produces: current documentation and a verified Slice 7 checkpoint.

- [ ] **Step 1: Update current documentation**

Document the runtime-context flow and exact two capabilities. Preserve the audit's original
determinism finding and append its Slice 7 resolution. Mark audit recommendation 6 and roadmap
Slice 7 complete. Do not claim deterministic wall time, replay seeds, client IDs, Slice 8 catalog
immutability, or Slice 9 aggregate/registry work.

- [ ] **Step 2: Run complete verification**

Run:

```powershell
npx vitest run --pool=threads --maxWorkers=1 --exclude tests/server/live-routing.test.ts
npx vitest run --pool=threads --maxWorkers=1 --silent=true tests/server/live-routing.test.ts
npm run test:architecture
npm run typecheck:server
npm run typecheck:client
npm run build
git diff --check
```

Expected: all tests and static gates pass. The existing Node 22.10/Vite 22.12+ warning may remain
while the build succeeds.

- [ ] **Step 3: Review the complete Slice 7 range**

Inspect the full range against the design and this plan. Require checks for default behavior,
single-context propagation, UUID consumption order, caller-supplied command IDs, setup randomness,
serialization boundaries, compatibility, static-gate scope, and test strength. Fix all Critical and
Important findings with focused red-green tests.

- [ ] **Step 4: Commit documentation and re-verify committed state**

```powershell
git add ARCHITECTURE.md docs/MAP.md docs/architecture-audit-2026-10-19.md docs/architecture-modernization-roadmap-2026-10-19.md
git commit -m "docs: record deterministic runtime boundary"
```

Repeat the full Step 2 verification after all review fixes. Confirm `git status --short` is empty,
report Slice 7 as 7/9 complete, identify Slice 8 as the card-content boundary, keep branch
`codex/architecture-boundaries` as-is, and pause the standing goal.
