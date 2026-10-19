# Damage/reducer boundary implementation plan

> **For Codex:** Execute this plan one task at a time. Keep the refactor behavior-preserving and stop after Slice 2 is complete and verified.

**Goal:** Remove the runtime import cycle between `game-reducer.ts` and `damage-service.ts` by making the reducer own damage-batch state application.

**Architecture:** Damage rules continue to plan and validate assignments. `game-reducer.ts` gains a small exported `reduceDamageBatch()` helper that validates assignments, plans default result mutations when necessary, and applies result mutations in order through the authoritative reducer. Proposal previews use that same reducer-owned helper.

**Tech stack:** TypeScript, Vitest, Node.js source-graph assertion, npm scripts.

---

### Task 1: Move damage-batch reduction to the reducer boundary

**Files:**

- Create: `tests/engine/damage-reducer-boundary.test.ts`
- Modify: `src/engine/game-reducer.ts`
- Modify: `src/engine/damage-service.ts`
- Modify: `src/engine/proposed-events.ts`

**Step 1: Write the failing boundary tests**

Add focused tests that:

- dynamically inspect `game-reducer.ts` and require an exported `reduceDamageBatch` function;
- verify explicit result mutations execute in order;
- verify invalid assignments return the original room reference;
- read `damage-service.ts` and assert it does not import `./game-reducer`.

Use a valid player damage assignment from `createTestRoom()` and `captureSourceInformation()`. Supply two explicit `SET_LIFE` results whose order is observable in the final life total.

**Step 2: Run the tests to verify RED**

Run: `npx vitest run tests/engine/damage-reducer-boundary.test.ts`

Expected: FAIL because `reduceDamageBatch` is absent and `damage-service.ts` still imports `game-reducer.ts`.

**Step 3: Implement the minimal ownership move**

In `game-reducer.ts`:

- import `planDamageResults`, `DamageAssignment`, and `validDamageAssignments`;
- export `reduceDamageBatch(room, proposed, results?)` with the exact existing semantics;
- route `APPLY_DAMAGE_BATCH` through the helper.

In `damage-service.ts`:

- remove `gameReducer`, `planDamageResults`, and `GameMutation` imports used only for application;
- remove `applyDamageBatch`;
- preserve all planning, validation, and registry behavior.

In `proposed-events.ts`:

- import `reduceDamageBatch` beside `gameReducer`;
- replace preview/consequence calls to `applyDamageBatch` with `reduceDamageBatch`.

**Step 4: Run the focused boundary and damage tests**

Run:

```powershell
npx vitest run tests/engine/damage-reducer-boundary.test.ts tests/engine/damage-pipeline.test.ts tests/engine/proposed-events.test.ts tests/engine/operation-outcomes.test.ts
npm run typecheck:server
```

Expected: all selected tests and the server typecheck pass.

**Step 5: Commit**

```powershell
git add -- src/engine/game-reducer.ts src/engine/damage-service.ts src/engine/proposed-events.ts tests/engine/damage-reducer-boundary.test.ts
git commit -m "refactor: move damage reduction behind reducer boundary"
```

### Task 2: Record the resolved boundary and verify the whole repository

**Files:**

- Modify: `ARCHITECTURE.md`
- Modify: `docs/architecture-audit-2026-10-19.md`

**Step 1: Update architecture documentation**

State that:

- damage services own rule hooks, planning, and assignment validation;
- the game reducer owns atomic damage-batch state application;
- the audit's original SCC finding was resolved in Slice 2 without erasing the historical observation.

**Step 2: Run whole-repository verification**

Run:

```powershell
npm test
npm run typecheck:server
npm run typecheck:client
npm run build
node .superpowers/sdd/import-graph-audit.cjs
git diff --check
```

Expected:

- the full Vitest suite passes;
- both typechecks pass;
- the production build passes;
- the import audit reports two runtime SCCs, with no `game-reducer.ts` / `damage-service.ts` cycle;
- whitespace validation passes.

**Step 3: Review the complete Slice 2 diff**

Review `HEAD~1..HEAD` plus the documentation changes for behavior drift, accidental public API changes, and architecture contradictions. Correct any Critical or Important issue before completion.

**Step 4: Commit**

```powershell
git add -- ARCHITECTURE.md docs/architecture-audit-2026-10-19.md
git commit -m "docs: record damage reducer boundary"
```

**Step 5: Report and pause**

Report Slice 2's outcome, verification evidence, commits, and the next planned slice. Do not begin Slice 3 until the user explicitly resumes.
