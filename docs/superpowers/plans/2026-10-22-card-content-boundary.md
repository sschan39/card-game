# Card Content Boundary Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove card-content imports of engine implementation files and publish recursively immutable, lazily cached catalog blueprints without changing card or match behavior.

**Architecture:** Move only pure schema/state contracts to `shared` or `library`, keep rule algorithms in `engine`, and add `card-catalog.ts` as the raw-data/cache owner. `card-factory.ts` remains the compatible instance API, while an import-graph rule enforces `library -> types/shared` and cached definitions are deeply frozen.

**Tech Stack:** TypeScript 6, Vitest 4, JSON module loading, existing TypeScript-AST architecture graph.

## Global Constraints

- Preserve every card JSON definition and accepted/rejected authoring shape.
- Preserve lazy normalization, one cached blueprint per card ID, and constant-time cached lookup.
- Preserve `CardInstance`, `CardBlueprint`, `CardState`, UUID, and serialized room contracts.
- Preserve all gameplay, setup, rules ordering, client behavior, and multiplayer events.
- Do not introduce a card plugin system, dependency-injection container, catalog service class, or new mechanic.
- Do not reorganize unrelated engine files merely to create a target folder diagram.
- Keep process-wide query/handler registry ownership unchanged; Slice 9 reassesses registries.
- Test-only definitions must clone or replace a blueprint before customization; production cached blueprints remain frozen.

---

### Task 1: Move card-definition validation behind a stable boundary

**Files:**
- Create: `src/shared/effect-scope-validation.ts`
- Create: `src/shared/mana-validation.ts`
- Create: `src/shared/numeric-values.ts`
- Create: `src/library/card-definition-validator.ts`
- Modify: `src/library/card-parser.ts`
- Modify: `src/engine/effect-scopes.ts`
- Modify: `src/engine/mana-pool.ts`
- Modify: `src/engine/numeric-values.ts`
- Modify: `src/engine/numeric-characteristics.ts`
- Modify: `src/engine/cost-composition.ts`
- Modify: `src/engine/announcement-values.ts`
- Modify: `src/engine/continuous-effects.ts`
- Delete: `src/engine/numeric-definitions.ts`
- Modify: `tests/architecture/import-boundaries.test.ts`
- Modify: `src/library/README.md`

**Interfaces:**
- Produces: `src/library/card-definition-validator.ts` with the same exported assertions as the current `engine/numeric-definitions.ts`.
- Produces: shared `validEffectScope`, `validManaAmounts`, `hasNumericExpression`, `validateNumericValue`, `evaluateNumericValue`, `registerNumericQuery`, and `characteristicNumericValue`.
- Preserves: existing engine import paths for numeric values through a compatibility re-export.

- [ ] **Step 1: Add a failing parser-boundary test**

In `tests/architecture/import-boundaries.test.ts`, add:

```ts
it('keeps the card parser independent of engine implementations', () => {
  const dependencies = [...graph.all.get('src/library/card-parser.ts') ?? []]
    .filter(target => target.startsWith('src/engine/'));
  expect(dependencies).toEqual([]);
});
```

- [ ] **Step 2: Run the architecture test and verify RED**

Run:

```powershell
npm run test:architecture
```

Expected: FAIL with `src/engine/numeric-definitions.ts` in the dependency list.

- [ ] **Step 3: Extract the pure shared validators without changing behavior**

Move `validEffectScope` unchanged from `engine/effect-scopes.ts` to
`shared/effect-scope-validation.ts`, and move `validManaAmounts` unchanged from
`engine/mana-pool.ts` to `shared/mana-validation.ts`. Keep compatibility exports:

```ts
// src/engine/effect-scopes.ts
export { validEffectScope } from '../shared/effect-scope-validation';

// src/engine/mana-pool.ts
import { validManaAmounts } from '../shared/mana-validation';
export { validManaAmounts } from '../shared/mana-validation';
```

Move the complete `engine/numeric-values.ts` implementation to `shared/numeric-values.ts`, change
its effect-scope import to `./effect-scope-validation`, and add the pure characteristic adapter:

```ts
export function characteristicNumericValue(value: CharacteristicNumber): NumericValue {
  if (typeof value === 'number' || hasNumericExpression(value)) return value;
  return { numeric: { kind: 'add', left: { numeric: { kind: 'multiply',
    left: { numeric: { kind: 'query', id: 'count', args: { scope: value.count } } },
    right: value.multiply ?? 1 } }, right: value.add ?? 0 } };
}
```

Replace `engine/numeric-values.ts` with:

```ts
export * from '../shared/numeric-values';
```

Update `engine/numeric-characteristics.ts` to import the three numeric helpers from
`../shared/numeric-values` and re-export `characteristicNumericValue` for compatibility.

- [ ] **Step 4: Move the definition validator and remove engine-only dependencies**

Move `engine/numeric-definitions.ts` to `library/card-definition-validator.ts`. Use these imports:

```ts
import type { CardAbility, CardBlueprint } from '../types/card.types';
import { MANA_COLORS } from '../types/card.types';
import type { ContinuousEffect, StaticEffectDefinition } from '../types/continuous-effect.types';
import type { AuthoredActionCost, CostRoutes, EffectDefinition, ModeDefinition } from '../types/effect.types';
import type { NumericDeclaration } from '../types/numeric-value.types';
import type { RuleCondition } from '../types/rule.types';
import { safeRuleKey } from '../shared/rule-path';
import { characteristicNumericValue, hasNumericExpression, validateNumericValue } from '../shared/numeric-values';
import { validManaAmounts } from '../shared/mana-validation';
```

Replace the `abilityEffects` dependency with this private adapter:

```ts
const definitionEffects = (ability: Exclude<CardAbility, { type: 'static' }>): EffectDefinition[] =>
  ability.effects ?? (ability.effect ? [ability.effect] : []);
```

Move the current `assertAuthoredCostShape` and `assertCostRoutesShape` implementations from
`engine/cost-composition.ts` into this validator, using shared `validManaAmounts`. Keep all existing
exports and validation order, then delete `engine/numeric-definitions.ts`.

- [ ] **Step 5: Point consumers at the stable contracts**

Use these imports:

```ts
// library/card-parser.ts
import { assertAnnouncementCost, assertCostRoutes, assertNumericDeclarations,
  assertEffectNumericDefinition, assertAbilityNumericDefinition,
  assertBlueprintNumericDefinition } from './card-definition-validator';

// engine/announcement-values.ts and engine/continuous-effects.ts
import { /* existing assertion names */ } from '../library/card-definition-validator';
```

Remove the moved authored-cost assertion functions and their `validManaAmounts` dependency from
`engine/cost-composition.ts`. Update the numeric-definition link in `src/library/README.md` to
`card-definition-validator.ts`.

- [ ] **Step 6: Verify Task 1 and commit**

Run:

```powershell
npm run test:architecture
npx vitest run --pool=threads --maxWorkers=1 --silent=true tests/engine/numeric-values.test.ts tests/engine/announcement-bindings.test.ts tests/engine/cost-routes.test.ts tests/engine/continuous-layers.test.ts
npm run typecheck:server
git diff --check
```

Expected: all pass and the parser has no engine import. Commit:

```powershell
git add src/shared src/library/card-definition-validator.ts src/library/card-parser.ts src/library/README.md src/engine tests/architecture/import-boundaries.test.ts
git commit -m "refactor: separate card schema validation from engine"
```

---

### Task 2: Separate initial card state from zone rules and enforce the content boundary

**Files:**
- Create: `src/shared/card-state.ts`
- Modify: `src/library/card-factory.ts`
- Modify: `src/engine/zone-transitions.ts`
- Modify: `tests/architecture/import-graph.ts`
- Modify: `tests/architecture/import-boundaries.test.ts`
- Modify: `docs/architecture-import-policy.md`

**Interfaces:**
- Produces: `createCardState(blueprint, ownerId, controllerId, zone): CardState` in `shared/card-state.ts`.
- Produces: `ArchitecturePolicyViolations.cardContentToEngine`.
- Preserves: every zone transition, revision, timestamp, and instance-state field.

- [ ] **Step 1: Add the failing repository boundary rule**

Extend `ArchitecturePolicyViolations` and `architecturePolicyViolations()`:

```ts
cardContentToEngine: allEdges
  .filter(edge => edge.from.startsWith('src/library/') && edge.to.startsWith('src/engine/'))
  .map(renderEdge),
```

Add `src/library/parser.ts -> src/engine/internal.ts` to the existing policy fixture and assert it is
reported. Add a repository assertion expecting `policy.cardContentToEngine` to equal `[]`.

- [ ] **Step 2: Run the architecture test and verify RED**

Run `npm run test:architecture`.

Expected: FAIL on `src/library/card-factory.ts -> src/engine/zone-transitions.ts`.

- [ ] **Step 3: Move only initial-state construction**

Create `src/shared/card-state.ts`:

```ts
import type { CardBlueprint, CardState, CardZone } from '../types/card.types';

export function createCardState(
  _blueprint: CardBlueprint,
  ownerId: string,
  controllerId: string,
  zone: CardZone,
): CardState {
  return {
    zone, ownerId, controllerId, isTapped: false, damageTaken: 0, counters: {},
    attackedThisTurn: false,
    summoningSickness: zone === 'battlefield',
  };
}
```

Import it from `../shared/card-state` in both `library/card-factory.ts` and
`engine/zone-transitions.ts`; remove the old function from zone transitions. Do not move any zone
lookup, movement, snapshot, or revision logic.

- [ ] **Step 4: Document and verify the enforced direction**

Add architecture-policy rule 7: all runtime and type-only imports from `src/library/**` to
`src/engine/**` are forbidden; content may use `types` and `shared`, while engine may consume
library APIs.

Run:

```powershell
npm run test:architecture
npx vitest run --pool=threads --maxWorkers=1 --silent=true tests/library/card-factory.test.ts tests/engine/zone-transitions.test.ts
npm run typecheck:server
git diff --check
```

Expected: all pass and the repository reports no content-to-engine imports. Commit:

```powershell
git add src/shared/card-state.ts src/library/card-factory.ts src/engine/zone-transitions.ts tests/architecture docs/architecture-import-policy.md
git commit -m "refactor: separate card state construction from zone rules"
```

---

### Task 3: Publish a deeply immutable cached catalog

**Files:**
- Create: `src/library/card-catalog.ts`
- Modify: `src/library/card-factory.ts`
- Modify: `tests/library/card-factory.test.ts`
- Modify: `tests/server/live-routing.test.ts`
- Modify: `tests/engine/action-validator.test.ts`
- Modify: `tests/engine/combat-integration.test.ts`
- Modify: `tests/engine/declare-attackers-handler.test.ts`
- Modify: `tests/engine/declare-blockers-handler.test.ts`
- Modify: `tests/engine/effect-resolver.test.ts`
- Modify: `tests/engine/option-service.test.ts`
- Modify: `tests/engine/play-card-handler.test.ts`
- Modify: `tests/engine/pending-choices.test.ts`
- Modify: `tests/engine/rps-play-handler.test.ts`

**Interfaces:**
- Produces: `card-catalog.getBlueprint(cardId): CardBlueprint`.
- Preserves: `card-factory.getBlueprint` as a re-export and `instantiateCard(cardId, context?)`.
- Guarantees: one recursively frozen cached definition reference per card ID.

- [ ] **Step 1: Write failing cache and immutability tests**

Expand `tests/library/card-factory.test.ts`:

```ts
import { getBlueprint, instantiateCard } from '../../src/library/card-factory';

it('shares one cached blueprint across lookups and instances', () => {
  const blueprint = getBlueprint('empire-servant');
  expect(getBlueprint('empire-servant')).toBe(blueprint);
  expect(instantiateCard('empire-servant').blueprint).toBe(blueprint);
});

it('recursively freezes cached blueprints', () => {
  const blueprint = getBlueprint('empire-servant');
  expect(Object.isFrozen(blueprint)).toBe(true);
  expect(Object.isFrozen(blueprint.cardTypes)).toBe(true);
  expect(Object.isFrozen(blueprint.castRequirements)).toBe(true);
  expect(Object.isFrozen(blueprint.abilities)).toBe(true);
  expect(() => blueprint.cardTypes.push('Artifact')).toThrow(TypeError);
  expect(getBlueprint('empire-servant').cardTypes).not.toContain('Artifact');
});
```

- [ ] **Step 2: Run the card-factory tests and verify RED**

Run:

```powershell
npx vitest run --pool=threads --maxWorkers=1 tests/library/card-factory.test.ts
```

Expected: cache-sharing passes, while recursive freeze assertions fail.

- [ ] **Step 3: Add the catalog owner and freeze before publication**

Create `src/library/card-catalog.ts` with the current raw JSON lookup/cache and this private helper:

```ts
function deepFreeze<T>(value: T, seen = new Set<object>()): T {
  if (!value || typeof value !== 'object' || seen.has(value as object)) return value;
  seen.add(value as object);
  for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child, seen);
  return Object.freeze(value);
}
```

Normalize lazily and store `deepFreeze(normalizeCard(raw))`. Keep the current unknown-ID error
exactly. In `card-factory.ts`, import `getBlueprint` from `./card-catalog`, re-export it, and leave
instance UUID/state construction unchanged.

- [ ] **Step 4: Replace test-only writes to shared definitions**

For every listed test file, replace nested writes such as:

```ts
card.blueprint.cardTypes = ['Creature'];
```

with whole-fixture replacement:

```ts
card.blueprint = { ...card.blueprint, cardTypes: ['Creature'] };
```

Likewise replace direct `abilities`, `onCastEffects`, `modes`, `castRequirements`, `keywords`,
`power`, and `id` writes with a new object. Preserve temporary restore behavior by assigning a new
object for both the changed and restored definitions. Do not clone in production or weaken the
freeze.

- [ ] **Step 5: Verify Task 3 and commit**

Run:

```powershell
npx vitest run --pool=threads --maxWorkers=1 --silent=true tests/library/card-factory.test.ts tests/engine/action-validator.test.ts tests/engine/combat-integration.test.ts tests/engine/declare-attackers-handler.test.ts tests/engine/declare-blockers-handler.test.ts tests/engine/effect-resolver.test.ts tests/engine/option-service.test.ts tests/engine/play-card-handler.test.ts tests/engine/pending-choices.test.ts tests/engine/rps-play-handler.test.ts
npm run typecheck:server
npm run test:architecture
git diff --check
```

Expected: all pass. Commit:

```powershell
git add src/library/card-catalog.ts src/library/card-factory.ts tests/library tests/engine tests/server/live-routing.test.ts
git commit -m "refactor: publish immutable card catalog blueprints"
```

---

### Task 4: Document, review, and verify Slice 8

**Files:**
- Modify: `ARCHITECTURE.md`
- Modify: `docs/MAP.md`
- Modify: `docs/architecture-audit-2026-10-19.md`
- Modify: `docs/architecture-modernization-roadmap-2026-10-19.md`

**Interfaces:**
- Consumes: Tasks 1-3 committed state.
- Produces: current architecture documentation and a verified Slice 8 checkpoint.

- [ ] **Step 1: Update current documentation**

Document `card-catalog.ts`, the `library -> shared/types` dependency rule, recursive cached
blueprint immutability, and the supported test-fixture clone/replace pattern. Preserve the audit's
original mutable-blueprint finding and append the Slice 8 resolution. Mark roadmap Slice 8
complete. Do not claim a `GameRoom` split or registry redesign.

- [ ] **Step 2: Run complete verification**

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

Expected: all tests and static gates pass. The known Node 22.10/Vite 22.12+ warning may remain
while the build succeeds.

- [ ] **Step 3: Review the complete Slice 8 range**

Review from commit `a4e9717` through `HEAD`. Require checks for parser validation parity, shared
query-registry identity, cache laziness/reference equality, recursive freezing, test-only mutation
removal, serialized compatibility, architecture-gate strength, and unnecessary movement. Fix all
Critical and Important findings with focused red-green tests.

- [ ] **Step 4: Commit documentation and re-verify committed state**

```powershell
git add ARCHITECTURE.md docs/MAP.md docs/architecture-audit-2026-10-19.md docs/architecture-modernization-roadmap-2026-10-19.md
git commit -m "docs: record card content boundary"
```

Repeat Step 2 after review fixes. Confirm `git status --short` is empty, report Slice 8 as 8/9
complete, identify Slice 9 as the state/session and registry reassessment, keep branch
`codex/architecture-boundaries` as-is, and pause the standing goal.
