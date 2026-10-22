# Card Content Boundary Design

## Goal

Keep catalog loading and card-definition normalization independent from engine implementation files,
and make every cached catalog blueprint recursively immutable, without changing card behavior,
authoring syntax, lookup performance, or match serialization.

## Verified Problems

- `src/library/card-parser.ts` imports `src/engine/numeric-definitions.ts`, so loading declarative
  card content depends on an engine implementation module.
- `src/library/card-factory.ts` imports `createCardState` from
  `src/engine/zone-transitions.ts`, coupling instance construction to the full zone-rules module.
- `getBlueprint()` caches and shares normalized definitions, but the returned object graph remains
  mutable. One accidental nested write can therefore alter later instances and matches.
- The architecture gate does not currently prevent new `src/library/** -> src/engine/**` imports.

These are ownership and isolation problems. The JSON definitions, parser behavior, engine rule
algorithms, and existing instance shape are otherwise cohesive and remain unchanged.

## Constraints

- Preserve every card JSON definition and accepted/rejected authoring shape.
- Preserve lazy normalization, one cached blueprint per card ID, and constant-time cached lookup.
- Preserve `CardInstance`, `CardBlueprint`, `CardState`, UUID, and serialized room contracts.
- Preserve all gameplay, setup, rules ordering, client behavior, and multiplayer events.
- Do not introduce a card plugin system, dependency-injection container, catalog service class, or
  new mechanic.
- Do not reorganize unrelated engine files merely to create a target folder diagram.
- Test-only blueprint customization remains supported by replacing a blueprint with a cloned or
  newly normalized fixture; mutating the shared cached object is no longer supported.

## Chosen Boundary

### Catalog ownership

Add `src/library/card-catalog.ts` as the single owner of raw JSON loading, lazy normalization, the
blueprint cache, and recursive freezing. Its public API is:

```ts
export function getBlueprint(cardId: string): CardBlueprint;
```

`src/library/card-factory.ts` remains the instance-construction API. It imports the catalog lookup
and re-exports `getBlueprint` for source compatibility, while `instantiateCard()` continues to
share the cached definition reference and create a fresh UUID/state object.

The cache freezes each normalized blueprint before publishing it. Freezing is recursive across
arrays and nested definition objects, so `Object.isFrozen()` and strict-mode mutation failures
cover the whole shared graph rather than only top-level properties.

### Stable schema contracts

Move the existing card/numeric-definition validator from `src/engine/` to
`src/library/card-definition-validator.ts`. The parser and engine announcement/continuous-effect
validation both consume this one contract, preserving identical validation behavior.

The validator's small reusable prerequisites become shared domain contracts rather than imports
back into the engine:

- numeric expression validation/evaluation and its existing query registry live in
  `src/shared/numeric-values.ts`;
- effect-scope shape validation lives in `src/shared/effect-scope-validation.ts`;
- mana amount shape validation lives in `src/shared/mana-validation.ts`.
- action-cost and authored-cost-route shape validation lives in
  `src/shared/action-cost-validation.ts`.

Existing engine modules continue to expose their current APIs where compatibility is useful, but
delegate to these shared implementations. This is a relocation of stable pure contracts, not a
redesign of numeric evaluation or registry ownership. Reassessing process-wide registries remains
Slice 9 work.

### Card-state construction

Move `createCardState()` to `src/shared/card-state.ts`. Both `card-factory.ts` and
`zone-transitions.ts` use that function. Zone validation, movement, snapshots, timestamps, and
revision behavior stay in the existing cohesive zone-rules module.

## Dependency Direction

```text
types + shared validation/state contracts
             ↑
library/card-definition-validator
             ↑
library/card-parser → library/card-catalog → library/card-factory
             ↑                                  ↑
       engine validators                  room/setup callers
```

`src/library/**` may depend on `src/types/**` and `src/shared/**`, but not on
`src/engine/**`. Engine modules may consume the content APIs and validators. A TypeScript import
graph rule enforces this direction for runtime and type-only imports.

## Error and Compatibility Behavior

- Unknown card IDs retain the current `[CardFactory]` error.
- Parser and numeric-definition errors retain their current messages and validation order.
- `getBlueprint()` and `instantiateCard()` retain their public signatures.
- Repeated lookups and instances retain reference equality for the same cached blueprint.
- Attempts to mutate any cached blueprint layer fail in strict-mode code instead of contaminating
  the cache. Tests requiring synthetic definitions clone or replace the blueprint first.
- `normalizeCard()` continues to return a normal mutable value for isolated fixtures; only
  published catalog entries are frozen.

## Tests and Enforcement

- Prove repeated catalog lookups and instances share the same cached blueprint.
- Prove the blueprint and representative nested arrays/objects are frozen and that rejected
  mutation leaves later lookups unchanged.
- Keep parser/numeric validation suites green to prove normalization behavior is preserved.
- Keep card-state and zone-transition suites green to prove construction/reset behavior is
  unchanged.
- Add an architecture fixture and repository gate forbidding all
  `src/library/** -> src/engine/**` imports.
- Update test fixtures that currently mutate a shared catalog blueprint so they first clone or
  replace it; do not weaken the production freeze for test convenience.
- Run the full non-live and live suites, both typechecks, architecture tests, and production build.

## Non-goals

- No JSON schema replacement or new authoring format.
- No eager whole-catalog compilation.
- No conversion of every nested TypeScript field to a new deep-readonly type in this slice.
- No rules-module relocation beyond the stable validation contracts required to remove the
  content-to-engine dependency.
- No `GameRoom`/session split or per-match registry ownership changes (Slice 9).
