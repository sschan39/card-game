# Explicit Action Registry Construction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove process-global action-handler registration and give each game engine an explicit, isolated action registry.

**Architecture:** Convert the action registry into an instance value, centralize built-in handlers in an engine-owned default factory, and inject one registry into both `GameEngine` validation and `ActionService` execution. Preserve the existing action-handler, mutation, checkpoint, and transport contracts.

**Tech Stack:** TypeScript 6, Node.js, Vitest 4, Express, Socket.IO

## Global Constraints

- Preserve all current gameplay behavior, action IDs, payloads, mutations, rules ordering, and multiplayer events.
- Do not modify the reducer, mutation committer, rules checkpoint, or concrete handler behavior in this slice.
- Do not add a dependency-injection framework or generic plugin framework.
- Keep direct `new GameEngine(room, effectContext)` construction compatible.
- Use test-first red-green-refactor cycles.

---

### Task 1: Per-instance action registry

**Files:**
- Modify: `src/engine/action-registry.ts`
- Modify: `tests/engine/action-registry.test.ts`

**Interfaces:**
- Produces: `new ActionRegistry(handlers?)`, `registry.get(actionType)`, `registry.has(actionType)`, and `registry.with(actionType, handler)`.
- Consumes: the existing `ActionHandler`, `ActionData`, and `ActionResult` contracts unchanged.

- [ ] **Step 1: Write the failing registry tests**

Replace mutation-of-global tests with tests equivalent to:

```ts
const original = new ActionRegistry({ cast_spell: mockHandler });
const extended = original.with('addon', addonHandler);

expect(original.get('cast_spell')).toBe(mockHandler);
expect(original.has('addon')).toBe(false);
expect(extended.get('addon')).toBe(addonHandler);
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `npx vitest run tests/engine/action-registry.test.ts`

Expected: FAIL because the exported value is not constructable and has no
`get`, `has`, or `with` methods.

- [ ] **Step 3: Implement the minimal registry value object**

Implement an `ActionRegistry` class that copies the supplied handler record,
queries without exposing mutable state, and derives a new registry from
`with()`:

```ts
export type ActionHandlerMap = Readonly<Record<ActionType, ActionHandler>>;

export class ActionRegistry {
  private readonly handlers: ReadonlyMap<ActionType, ActionHandler>;

  constructor(handlers: ActionHandlerMap = {}) {
    this.handlers = new Map(Object.entries(handlers));
  }

  get(type: ActionType): ActionHandler | undefined {
    return this.handlers.get(type);
  }

  has(type: ActionType): boolean {
    return this.handlers.has(type);
  }

  with(type: ActionType, handler: ActionHandler): ActionRegistry {
    return new ActionRegistry(Object.fromEntries([...this.handlers, [type, handler]]));
  }
}
```

- [ ] **Step 4: Run the focused test and verify GREEN**

Run: `npx vitest run tests/engine/action-registry.test.ts`

Expected: PASS with all registry tests green.

- [ ] **Step 5: Commit**

```bash
git add src/engine/action-registry.ts tests/engine/action-registry.test.ts
git commit -m "refactor: make action registry instance-scoped"
```

### Task 2: Default engine composition and isolation

**Files:**
- Create: `src/engine/default-action-registry.ts`
- Modify: `src/engine/action-service.ts`
- Modify: `src/engine/game-engine.ts`
- Modify: `src/server.ts`
- Modify: `tests/engine/action-service.test.ts`
- Modify: `tests/engine/game-engine.test.ts`

**Interfaces:**
- Consumes: `ActionRegistry` from Task 1 and all existing concrete action handlers.
- Produces: `createDefaultActionRegistry(): ActionRegistry` and engine constructor injection through the optional third `actionRegistry` parameter.

- [ ] **Step 1: Write the failing isolation regression test**

Construct two engines over independent rooms, passing different registries as
the constructor's third argument. Register a test-only `addon` handler in only
one registry. Assert that the first engine can route `addon` while the second
returns `No handler registered for action: addon`.

- [ ] **Step 2: Run the focused engine tests and verify RED**

Run: `npx vitest run tests/engine/action-service.test.ts tests/engine/game-engine.test.ts`

Expected: FAIL because `ActionService` still reads process-global state and
`GameEngine` does not accept an action registry.

- [ ] **Step 3: Add the complete built-in registry factory**

Create `src/engine/default-action-registry.ts` with a compile-time-complete
mapping for every built-in action except `choose`, then return a new registry:

```ts
const DEFAULT_ACTION_HANDLERS: Record<Exclude<ActionId, typeof ACTION_IDS.choose>, ActionHandler> = {
  [ACTION_IDS.castSpell]: playCardHandler,
  [ACTION_IDS.playLand]: playLandHandler,
  [ACTION_IDS.activateAbility]: activateAbilityHandler,
  [ACTION_IDS.declareAttackers]: declareAttackersHandler,
  [ACTION_IDS.declareBlockers]: declareBlockersHandler,
  [ACTION_IDS.tapForMana]: tapForManaHandler,
  [ACTION_IDS.enterBattle]: enterBattleHandler,
  [ACTION_IDS.endTurn]: endTurnHandler,
  [ACTION_IDS.passPriority]: passPriorityHandler,
  [ACTION_IDS.resolveStack]: resolveStackHandler,
  [ACTION_IDS.rpsPlay]: rpsPlayHandler,
};

export const createDefaultActionRegistry = (): ActionRegistry =>
  new ActionRegistry(DEFAULT_ACTION_HANDLERS);
```

- [ ] **Step 4: Inject one registry into engine validation and execution**

Keep the existing effect-context argument and add an optional third constructor
argument:

```ts
constructor(
  room: GameRoom,
  dependencies: Partial<EffectContext> = {},
  private readonly actionRegistry = createDefaultActionRegistry(),
) { /* existing setup */ }
```

Pass that instance to `ActionService`. Replace direct global lookup in both
`ActionService.handleAction()` and `GameEngine.readyCommandError()` with
`get()`/`has()` calls on the injected instance.

- [ ] **Step 5: Remove transport-owned rule registration**

Delete the concrete handler imports, action-handler map, and registration loop
from `src/server.ts`. Keep room-engine construction otherwise unchanged so
external transport behavior is preserved.

- [ ] **Step 6: Run focused tests and verify GREEN**

Run: `npx vitest run tests/engine/action-registry.test.ts tests/engine/action-service.test.ts tests/engine/game-engine.test.ts tests/server/live-routing.test.ts`

Expected: PASS; the server routes built-in actions without registration side
effects and engine registries are isolated.

- [ ] **Step 7: Commit**

```bash
git add src/engine/default-action-registry.ts src/engine/action-service.ts src/engine/game-engine.ts src/server.ts tests/engine/action-service.test.ts tests/engine/game-engine.test.ts
git commit -m "refactor: construct action handlers inside the engine"
```

### Task 3: Remove global-registry test coupling and verify the slice

**Files:**
- Modify: every test returned by `rg -l "ActionRegistry|registerAction" tests`
- Modify: `ARCHITECTURE.md`

**Interfaces:**
- Consumes: default per-engine registry and explicit custom registries from Tasks 1-2.
- Produces: tests whose engine dependencies are local to each fixture and documentation of the new construction boundary.

- [ ] **Step 1: Migrate remaining tests**

Remove global registry snapshot/clear/restore hooks and redundant built-in
`registerAction` calls. For a test that intentionally changes routing, derive
and pass a local registry:

```ts
const actions = createDefaultActionRegistry().with('addon', addonHandler);
const engine = new GameEngine(room, {}, actions);
```

- [ ] **Step 2: Prove no global registration remains**

Run: `rg -n "registerAction|Object\.keys\(ActionRegistry\)|ActionRegistry\[" src tests`

Expected: no matches. References to the `ActionRegistry` class and constructor
are allowed.

- [ ] **Step 3: Update architecture documentation**

Document that built-in action handlers are assembled by
`createDefaultActionRegistry()`, each engine owns its registry, and transport
creates engines without importing concrete rules handlers.

- [ ] **Step 4: Run complete verification**

Run:

```bash
npm run typecheck:server
npm run typecheck:client
npm test
npm run build
```

Expected: all commands exit 0 with no test failures or TypeScript errors.

- [ ] **Step 5: Review the diff for scope**

Run: `git diff --check` and `git diff --stat HEAD~2..HEAD`

Confirm that no reducer, rules-checkpoint, mutation, card-definition, or
transport-event behavior changed.

- [ ] **Step 6: Commit**

```bash
git add tests ARCHITECTURE.md
git commit -m "test: isolate action registry fixtures"
```
