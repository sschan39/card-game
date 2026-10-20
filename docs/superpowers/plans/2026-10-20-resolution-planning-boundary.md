# Resolution Planning Boundary Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the runtime cycles between `effect-resolver.ts`, `bounded-reveal.ts`, and `resolution-choices.ts` without changing resolution behavior or existing public helper imports.

**Architecture:** Extract effect construction, target revalidation, and dynamic-parameter evaluation into `resolution-planning.ts`. The resolver and both helper modules depend downward on that module; `effect-resolver.ts` remains the orchestration facade and re-exports the moved helpers as the same function bindings.

**Tech Stack:** TypeScript, Vitest, Node.js source-graph checks, npm scripts.

## Global Constraints

- Preserve effect order, fizzle rules, target legality, dynamic values, reveal behavior, choices, continuation payloads, and serialized contracts.
- Do not redesign registries, numeric queries, replacements, directories, or dependency injection.
- Do not broadly migrate existing facade consumers.
- Keep `bounded-reveal.ts` and `resolution-choices.ts` as cohesive helper modules.
- Make no gameplay mechanic changes.

---

### Task 1: Extract reusable resolution planning primitives

**Files:**

- Create: `src/engine/resolution-planning.ts`
- Create: `tests/engine/resolution-planning-boundary.test.ts`
- Modify: `src/engine/effect-resolver.ts`
- Modify: `src/engine/bounded-reveal.ts`
- Modify: `src/engine/resolution-choices.ts`

**Interfaces:**

- Produces: `buildStackEffects(definitions, controllerId, source?) => StackEffect[]`
- Produces: `revalidateTargets(room, effect, controllerId, source?) => StackEffect`
- Produces: `buildDynamicParams(room, stackObj, effect) => Record<string, unknown>`
- Preserves: the same three named exports from `effect-resolver.ts`

- [ ] **Step 1: Write the failing boundary test**

Create `tests/engine/resolution-planning-boundary.test.ts`:

```ts
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');

describe('resolution planning boundary', () => {
  it('gives shared planning primitives a lower-level module', () => {
    expect(existsSync(resolve(process.cwd(), 'src/engine/resolution-planning.ts'))).toBe(true);
    expect(source('src/engine/effect-resolver.ts')).toMatch(
      /export\s*\{[^}]*buildStackEffects[^}]*buildDynamicParams[^}]*revalidateTargets[^}]*\}\s*from\s*['"]\.\/resolution-planning['"]/s,
    );
  });

  it.each([
    'src/engine/bounded-reveal.ts',
    'src/engine/resolution-choices.ts',
  ])('%s does not import the orchestration facade', path => {
    expect(source(path)).not.toMatch(/from\s+['"]\.\/effect-resolver['"]/);
  });
});
```

- [ ] **Step 2: Run the test to verify RED**

Run:

```powershell
npx vitest run --pool=threads --maxWorkers=1 tests/engine/resolution-planning-boundary.test.ts
```

Expected: three failed assertions because `resolution-planning.ts` is absent and both helper files
still import `effect-resolver.ts`.

- [ ] **Step 3: Move the three primitive implementations without semantic edits**

Create `src/engine/resolution-planning.ts` with the imports currently used only by the three moved
functions:

```ts
import { CardCharacteristicService } from './card-characteristic-service';
import type { CardInstance, CardSnapshot } from '../types/card.types';
import type { GameRoom } from '../types/game.room.types';
import type { EffectDefinition, StackEffect, StackObject, TargetPointer } from '../types/effect.types';
import { structuralTargetLegal, isExplicitTargeting, findTargetCard } from '../shared/target-legality';
import { matchesTargetFilter } from '../shared/target-utils';
import { ModifierRegistry } from './modifier-registry';
import { resolveSourceInformation } from './source-information';
import { readRulePath } from './rule-conditions';
import { evaluateNumericValue, hasNumericExpression } from './numeric-values';
import { createBoardNumericContext } from './numeric-characteristics';
import { roomCards } from './continuous-effects';
```

Move the complete existing implementations and comments for `buildStackEffects()`,
`revalidateTargets()`, and `buildDynamicParams()` from `effect-resolver.ts` into this file. Do not
change their signatures, branches, object shapes, ordering, or comments while moving them.

- [ ] **Step 4: Make the resolver consume and re-export the new boundary**

Remove imports from `effect-resolver.ts` that were used only by the moved functions. Add:

```ts
import { buildDynamicParams, revalidateTargets } from './resolution-planning';
export { buildStackEffects, buildDynamicParams, revalidateTargets } from './resolution-planning';
```

Keep `findTargetCard`, `isExplicitTargeting`, `CardCharacteristicService`, and the types still used
by resolver orchestration and structural zone changes. Remove the three original function bodies.

- [ ] **Step 5: Point both focused helpers at the planning boundary**

In `bounded-reveal.ts`, replace:

```ts
import { buildStackEffects } from './effect-resolver';
```

with:

```ts
import { buildStackEffects } from './resolution-planning';
```

In `resolution-choices.ts`, replace:

```ts
import { buildStackEffects, buildDynamicParams, revalidateTargets } from './effect-resolver';
```

with:

```ts
import { buildStackEffects, buildDynamicParams, revalidateTargets } from './resolution-planning';
```

- [ ] **Step 6: Run focused behavior and boundary tests**

Run:

```powershell
npx vitest run --pool=threads --maxWorkers=1 tests/engine/resolution-planning-boundary.test.ts tests/engine/effect-resolver.test.ts tests/engine/bounded-reveal.test.ts tests/engine/pending-choices.test.ts tests/engine/target-groups.test.ts tests/engine/numeric-value-consumers.test.ts tests/engine/zone-transitions.test.ts tests/engine/resolution-outcomes.test.ts
npm run typecheck:server
```

Expected: all selected tests and the server typecheck pass.

- [ ] **Step 7: Commit the extraction**

```powershell
git add -- src/engine/resolution-planning.ts src/engine/effect-resolver.ts src/engine/bounded-reveal.ts src/engine/resolution-choices.ts tests/engine/resolution-planning-boundary.test.ts
git commit -m "refactor: extract resolution planning boundary"
```

### Task 2: Document and verify the resolved ownership boundary

**Files:**

- Modify: `ARCHITECTURE.md`
- Modify: `docs/MAP.md`
- Modify: `docs/architecture-audit-2026-10-19.md`
- Modify: `docs/architecture-modernization-roadmap-2026-10-19.md`

**Interfaces:**

- Consumes: the `resolution-planning.ts` ownership boundary from Task 1.
- Produces: current architecture documentation and full-repository verification evidence.

- [ ] **Step 1: Update current architecture documentation**

In `ARCHITECTURE.md`, identify `resolution-planning.ts` as the owner of `buildStackEffects()`,
`revalidateTargets()`, and dynamic-parameter planning. Keep `effect-resolver.ts` documented as the
ordered orchestration entry point.

In `docs/MAP.md`, change the resolve-time targeting owner from `engine/effect-resolver.ts` to
`engine/resolution-planning.ts` and retain `shared/target-legality.ts` / `target-utils.ts` as the
structural/filter helpers.

- [ ] **Step 2: Record Slice 3 completion without erasing history**

In `docs/architecture-audit-2026-10-19.md`, keep the original resolver-cycle observation and append
a Slice 3 remediation note explaining that all three modules now depend on
`resolution-planning.ts`. Mark recommended-order item 2 complete.

In `docs/architecture-modernization-roadmap-2026-10-19.md`, mark Slice 3 complete and state that the
public facade exports were preserved.

- [ ] **Step 3: Run the complete verification gate**

Run:

```powershell
npx vitest run --pool=threads --exclude tests/server/live-routing.test.ts
npx vitest run --pool=threads --maxWorkers=1 tests/server/live-routing.test.ts
npm run typecheck:server
npm run typecheck:client
npm run build
node .superpowers/sdd/import-graph-audit.cjs
git diff --check
```

Expected:

- all non-live and live Socket.IO tests pass;
- both TypeScript projects pass;
- the production build succeeds;
- the runtime graph contains only the characteristic/continuous-effect SCC and neither helper
  imports `effect-resolver.ts`;
- whitespace validation passes.

- [ ] **Step 4: Request independent review and address findings**

Review the full Slice 3 range against the design and plan. Require the reviewer to check semantic
preservation, facade compatibility, cycle removal, test adequacy, and documentation accuracy. Fix
all Critical and Important findings, then rerun affected tests.

- [ ] **Step 5: Commit the documentation**

```powershell
git add -- ARCHITECTURE.md docs/MAP.md docs/architecture-audit-2026-10-19.md docs/architecture-modernization-roadmap-2026-10-19.md
git commit -m "docs: record resolution planning boundary"
```

- [ ] **Step 6: Final verification and pause**

Repeat the complete verification gate on the committed state, confirm the worktree is clean, report
Slice 3's outcome and commits, and pause before Slice 4.
