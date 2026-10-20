# Characteristic Evaluation Boundary Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the runtime cycle among characteristic evaluation, layer processing, and continuous-effect normalization without changing behavior or existing exports.

**Architecture:** Extract the existing pure room/effect-state queries into `continuous-effect-state.ts`. Layer evaluation and other read-only consumers depend directly on that lower-level module, while `continuous-effects.ts` keeps normalization ownership and re-exports the moved functions as identical bindings.

**Tech Stack:** TypeScript, Vitest, Node.js source-graph checks, npm scripts.

## Global Constraints

- Preserve layer order, dependency ordering, timestamps, scopes, last-known information, characteristic-defining abilities, and effect lifetimes.
- Preserve continuous-effect normalization, resolved recipient freezing, and numeric evaluation.
- Preserve existing named exports from `continuous-effects.ts` as the same function bindings.
- Keep `card-characteristic-service.ts`, `characteristic-layers.ts`, and `continuous-effects.ts` as separate cohesive modules.
- Make no gameplay mechanic, card, client, protocol, or serialized-contract changes.

---

### Task 1: Extract read-only continuous-effect state queries

**Files:**

- Create: `src/engine/continuous-effect-state.ts`
- Create: `tests/engine/characteristic-evaluation-boundary.test.ts`
- Modify: `src/engine/continuous-effects.ts`
- Modify: `src/engine/characteristic-layers.ts`
- Modify: `src/engine/mutation-committer.ts`
- Modify: `src/engine/replacement-rules.ts`
- Modify: `src/engine/resolution-planning.ts`
- Modify: `src/engine/resolution-outcomes.ts`
- Modify: `src/engine/rule-conditions.ts`
- Modify: `src/engine/state-based-planner.ts`

**Interfaces:**

- Produces: `roomCards(room: GameRoom): CardInstance[]`
- Produces: `effectSource(cards: CardInstance[], entry: ContinuousEffectEntry): CardInstance | undefined`
- Produces: `effectIsActive(cards: CardInstance[], entry: ContinuousEffectEntry): boolean`
- Preserves: the same three named exports from `continuous-effects.ts`

- [ ] **Step 1: Write the failing boundary and compatibility tests**

Create `tests/engine/characteristic-evaluation-boundary.test.ts`:

```ts
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');

describe('characteristic evaluation boundary', () => {
  it('gives read-only continuous-effect state queries a lower-level module', () => {
    expect(existsSync(resolve(process.cwd(), 'src/engine/continuous-effect-state.ts'))).toBe(true);
    expect(source('src/engine/continuous-effects.ts')).toMatch(
      /export\s*\{[^}]*roomCards[^}]*effectSource[^}]*effectIsActive[^}]*\}\s*from\s*['"]\.\/continuous-effect-state['"]/s,
    );
  });

  it.each([
    'src/engine/characteristic-layers.ts',
    'src/engine/continuous-effect-state.ts',
  ])('%s does not import normalization or the characteristic facade', path => {
    const contents = source(path);
    expect(contents).not.toMatch(/from\s+['"]\.\/continuous-effects['"]/);
    expect(contents).not.toMatch(/from\s+['"]\.\/card-characteristic-service['"]/);
  });

  it('preserves the compatibility exports as identical bindings', async () => {
    const [compatibility, state] = await Promise.all([
      import('../../src/engine/continuous-effects'),
      import('../../src/engine/continuous-effect-state'),
    ]);
    expect(compatibility.roomCards).toBe(state.roomCards);
    expect(compatibility.effectSource).toBe(state.effectSource);
    expect(compatibility.effectIsActive).toBe(state.effectIsActive);
  });
});
```

- [ ] **Step 2: Run the test to verify RED**

Run:

```powershell
npx vitest run --pool=threads --maxWorkers=1 tests/engine/characteristic-evaluation-boundary.test.ts
```

Expected: failures because `continuous-effect-state.ts` does not exist,
`characteristic-layers.ts` imports `continuous-effects.ts`, and compatibility re-exports are absent.

- [ ] **Step 3: Move the three query implementations without semantic edits**

Create `src/engine/continuous-effect-state.ts`:

```ts
import type { CardInstance } from '../types/card.types';
import type { ContinuousEffectEntry } from '../types/continuous-effect.types';
import type { GameRoom } from '../types/game.room.types';

export function roomCards(room: GameRoom): CardInstance[] {
  const cards = [...room.battlefield, ...room.stack.filter(s => s.type === 'spell').map(s => s.source),
    ...Object.values(room.players).flatMap(p => [...p.hand, ...p.graveyard, ...p.deck, ...p.exile ?? []])];
  return [...new Map(cards.map(c => [c.uuid, c])).values()];
}

export function effectSource(cards: CardInstance[], entry: ContinuousEffectEntry): CardInstance | undefined {
  return cards.find(c => c.uuid === entry.source && (entry.sourceRevision === undefined || (c.state.zoneRevision ?? 0) === entry.sourceRevision) &&
    (entry.requiredZone == null || c.state.zone === entry.requiredZone));
}

export function effectIsActive(cards: CardInstance[], entry: ContinuousEffectEntry): boolean {
  const sourceDuration = entry.duration === 'WHILE_ON_BATTLEFIELD' || entry.duration === 'WHILE_ATTACHED';
  if (sourceDuration) {
    const source = effectSource(cards, { ...entry, requiredZone: 'battlefield' });
    return !!source && (entry.duration !== 'WHILE_ATTACHED' || !!source.state.attachedTo);
  }
  if (entry.requiredZone === null || (entry.origin === 'resolved' && entry.requiredZone === undefined) || entry.source === 'global' || entry.source === 'emblem') return true;
  const source = effectSource(cards, { ...entry, requiredZone: entry.requiredZone ?? 'battlefield' });
  if (!source) return false;
  return true;
}
```

Delete only these three function bodies from `continuous-effects.ts`. Import the functions needed
by normalization and timestamp allocation, then re-export the exact bindings:

```ts
import { roomCards } from './continuous-effect-state';
export { roomCards, effectSource, effectIsActive } from './continuous-effect-state';
```

- [ ] **Step 4: Point layer evaluation at the lower-level owners**

Replace the `continuous-effects.ts` import in `characteristic-layers.ts` with:

```ts
import { effectIsActive, effectSource, roomCards } from './continuous-effect-state';
import { characteristicScope, scopeMatches } from './effect-scopes';
```

Do not alter any layer-evaluation function bodies.

- [ ] **Step 5: Point read-only engine consumers at the state module**

Change imports of `roomCards` and `effectIsActive` from `./continuous-effects` to
`./continuous-effect-state` in:

```text
src/engine/mutation-committer.ts
src/engine/replacement-rules.ts
src/engine/resolution-planning.ts
src/engine/resolution-outcomes.ts
src/engine/rule-conditions.ts
src/engine/state-based-planner.ts
```

Leave timestamp, sequence, and normalization consumers on `continuous-effects.ts`.

- [ ] **Step 6: Run focused behavior and boundary tests**

Run:

```powershell
npx vitest run --pool=threads --maxWorkers=1 tests/engine/characteristic-evaluation-boundary.test.ts tests/engine/card-characteristic-service.test.ts tests/engine/continuous-layers.test.ts tests/engine/continuous-lifetime.test.ts tests/engine/effective-characteristic-consumers.test.ts tests/engine/characteristic-permissions.test.ts tests/engine/numeric-value-consumers.test.ts
npm run typecheck:server
node .superpowers/sdd/import-graph-audit.cjs
```

Expected: all selected tests and server typecheck pass, and `RUNTIME_CYCLES` is empty.

- [ ] **Step 7: Commit the extraction**

```powershell
git add -- src/engine/continuous-effect-state.ts src/engine/continuous-effects.ts src/engine/characteristic-layers.ts src/engine/mutation-committer.ts src/engine/replacement-rules.ts src/engine/resolution-planning.ts src/engine/resolution-outcomes.ts src/engine/rule-conditions.ts src/engine/state-based-planner.ts tests/engine/characteristic-evaluation-boundary.test.ts
git commit -m "refactor: extract continuous effect state queries"
```

### Task 2: Document and verify the characteristic ownership boundary

**Files:**

- Modify: `ARCHITECTURE.md`
- Modify: `docs/MAP.md`
- Modify: `docs/architecture-audit-2026-10-19.md`
- Modify: `docs/architecture-modernization-roadmap-2026-10-19.md`

**Interfaces:**

- Consumes: the `continuous-effect-state.ts` ownership boundary from Task 1.
- Produces: current architecture documentation and full-repository verification evidence.

- [ ] **Step 1: Update current architecture documentation**

In `ARCHITECTURE.md`, document `continuous-effect-state.ts` as the owner of room-card enumeration,
source lookup, and lifetime checks. Keep `continuous-effects.ts` as the owner of timestamps,
sequence allocation, and normalization; keep `characteristic-layers.ts` as the evaluator and
`card-characteristic-service.ts` as the facade.

In `docs/MAP.md`, update the characteristic/continuous-effect rows and remove the resolved runtime
cycle from current rough edges.

- [ ] **Step 2: Record Slice 4 completion without erasing history**

In `docs/architecture-audit-2026-10-19.md`, retain the original cycle observation and append a
Slice 4 remediation note. Mark the corresponding recommended-order item complete.

In `docs/architecture-modernization-roadmap-2026-10-19.md`, mark Slice 4 complete and state that
normalization and facade behavior remain unchanged.

- [ ] **Step 3: Run the complete verification gate**

Run:

```powershell
npx vitest run --pool=threads --maxWorkers=1 --exclude tests/server/live-routing.test.ts
npx vitest run --pool=threads --maxWorkers=1 --silent=true tests/server/live-routing.test.ts
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
- `RUNTIME_CYCLES` is empty;
- whitespace validation passes.

- [ ] **Step 4: Request independent review and address findings**

Review the full Slice 4 range against the design and plan. Require the reviewer to check semantic
preservation, facade compatibility, cycle removal, test adequacy, and documentation accuracy. Fix
all Critical and Important findings, then rerun affected tests.

- [ ] **Step 5: Commit the documentation**

```powershell
git add -- ARCHITECTURE.md docs/MAP.md docs/architecture-audit-2026-10-19.md docs/architecture-modernization-roadmap-2026-10-19.md
git commit -m "docs: record characteristic evaluation boundary"
```

- [ ] **Step 6: Final verification and pause**

Repeat the complete verification gate on the committed state, confirm the worktree is clean, report
Slice 4's outcome and commits, and pause before Slice 5.
