# Automated Architecture Checks Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the clean runtime graph and proven layer boundaries fail automatically in the normal Vitest suite when they regress.

**Architecture:** Add a TypeScript-AST import-graph helper under `tests/architecture/` and apply four explicit repository policies in a focused Vitest file. Runtime edges exclude type-only imports/exports, while layer boundaries use all imports where dependency direction matters; client runtime rule queries use an exact documented allowlist.

**Tech Stack:** TypeScript compiler API, Vitest, Node.js filesystem/path APIs, npm scripts.

## Global Constraints

- Add no runtime dependency and change no production behavior.
- Scan `src/**/*.ts` and `src/**/*.tsx` with the TypeScript AST.
- Distinguish type-only imports/exports from runtime edges.
- Enforce only the four roadmap policies: no runtime cycles; no engine-to-transport/multiplayer imports; no transport-to-concrete-handler imports; exact documented client runtime rule-query exceptions.
- Resolve relative imports plus `@engine/* -> src/engine/*` and `@shared/* -> src/types/*`.
- Keep diagnostics deterministic and path-based.
- Make no gameplay mechanic, card, client behavior, protocol, or serialized-contract changes.

---

### Task 1: Add the AST import graph and executable architecture policy

**Files:**

- Create: `tests/architecture/import-graph.ts`
- Create: `tests/architecture/import-boundaries.test.ts`
- Modify: `package.json`

**Interfaces:**

- Produces: `parseSourceImports(sourceText, fileName): ParsedImport[]`
- Produces: `buildImportGraph(options?): ImportGraph`
- Produces: `graphEdges(graph): ImportEdge[]`
- Produces: `stronglyConnectedComponents(graph): string[][]`
- Produces: `npm run test:architecture`

- [ ] **Step 1: Write the failing parser and policy tests**

Create `tests/architecture/import-boundaries.test.ts` with these imports, fixtures, and policies:

```ts
import { describe, expect, it } from 'vitest';
import {
  buildImportGraph,
  graphEdges,
  parseSourceImports,
  stronglyConnectedComponents,
  type ImportGraphMap,
} from './import-graph';

const graph = buildImportGraph({
  repoRoot: process.cwd(),
  sourceRoot: 'src',
  aliases: [
    { prefix: '@engine/', directory: 'src/engine' },
    { prefix: '@shared/', directory: 'src/types' },
  ],
});

const clientEngineRuntimeExceptions = [
  'src/client/components/CardComponent.tsx -> src/engine/card-characteristic-service.ts',
  'src/client/store/combatSelection.ts -> src/engine/card-characteristic-service.ts',
  'src/client/store/gameStore.ts -> src/engine/card-characteristic-service.ts',
  'src/client/targeting.ts -> src/engine/ability-effects.ts',
  'src/client/targeting.ts -> src/engine/card-characteristic-service.ts',
].sort();

const isTransport = (path: string) => path === 'src/server.ts'
  || path.startsWith('src/server/') || path.startsWith('src/multiplayer/');
const render = (from: string, to: string) => `${from} -> ${to}`;

describe('TypeScript import graph', () => {
  it('distinguishes type-only syntax from runtime imports', () => {
    const imports = parseSourceImports(`
      import type { A } from './type-only';
      import { type B, runtime } from './mixed';
      import './side-effect';
      export type { C } from './export-type';
      export { type D, runtimeExport } from './export-mixed';
      const lazy = import('./dynamic');
      const commonJs = require('./required');
      import legacy = require('./legacy');
    `, 'fixture.ts');

    expect(imports.filter(item => item.runtime).map(item => item.specifier).sort()).toEqual([
      './dynamic', './export-mixed', './legacy', './mixed', './required', './side-effect',
    ]);
    expect(imports.map(item => item.specifier).sort()).toEqual([
      './dynamic', './export-mixed', './export-type', './legacy', './mixed', './required', './side-effect', './type-only',
    ]);
  });

  it('detects runtime strongly connected components', () => {
    const fixture: ImportGraphMap = new Map([
      ['a.ts', new Set(['b.ts'])],
      ['b.ts', new Set(['c.ts'])],
      ['c.ts', new Set(['a.ts'])],
      ['outside.ts', new Set()],
    ]);
    expect(stronglyConnectedComponents(fixture)).toEqual([['a.ts', 'b.ts', 'c.ts']]);
  });

  it('resolves the client engine alias without treating its type-only import as runtime', () => {
    expect(graph.all.get('src/client/socket.ts')).toContain('src/engine/option-service.ts');
    expect(graph.runtime.get('src/client/socket.ts')).not.toContain('src/engine/option-service.ts');
  });
});

describe('repository architecture policy', () => {
  it('has no runtime import cycles', () => {
    expect(stronglyConnectedComponents(graph.runtime)).toEqual([]);
  });

  it('keeps engine imports independent of transport and multiplayer', () => {
    const violations = graphEdges(graph.all)
      .filter(edge => edge.from.startsWith('src/engine/') && isTransport(edge.to))
      .map(edge => render(edge.from, edge.to));
    expect(violations).toEqual([]);
  });

  it('keeps transport independent of concrete rule handlers', () => {
    const violations = graphEdges(graph.all)
      .filter(edge => isTransport(edge.from) && edge.to.startsWith('src/engine/handlers/'))
      .map(edge => render(edge.from, edge.to));
    expect(violations).toEqual([]);
  });

  it('allows only documented client runtime rule queries', () => {
    const actual = graphEdges(graph.runtime)
      .filter(edge => edge.from.startsWith('src/client/') && edge.to.startsWith('src/engine/'))
      .map(edge => render(edge.from, edge.to));
    expect(actual).toEqual(clientEngineRuntimeExceptions);
  });
});
```

- [ ] **Step 2: Run the test to verify RED**

Run:

```powershell
npx vitest run --pool=threads --maxWorkers=1 tests/architecture/import-boundaries.test.ts
```

Expected: FAIL because `tests/architecture/import-graph.ts` does not exist.

- [ ] **Step 3: Implement the AST parser and graph builder**

Create `tests/architecture/import-graph.ts`. Use these public types and functions:

```ts
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

export interface ParsedImport { specifier: string; runtime: boolean }
export interface ImportEdge { from: string; to: string }
export type ImportGraphMap = Map<string, Set<string>>;
export interface ImportGraph { all: ImportGraphMap; runtime: ImportGraphMap }
export interface ImportAlias { prefix: string; directory: string }
export interface ImportGraphOptions {
  repoRoot?: string;
  sourceRoot?: string;
  aliases?: ImportAlias[];
}

export function parseSourceImports(sourceText: string, fileName: string): ParsedImport[] {
  const source = ts.createSourceFile(fileName, sourceText, ts.ScriptTarget.Latest, true,
    fileName.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const imports: ParsedImport[] = [];
  const add = (specifier: ts.Expression | undefined, runtime: boolean) => {
    if (specifier && ts.isStringLiteralLike(specifier)) imports.push({ specifier: specifier.text, runtime });
  };

  for (const statement of source.statements) {
    if (ts.isImportDeclaration(statement)) {
      const clause = statement.importClause;
      const runtime = !clause || (!clause.isTypeOnly && (!!clause.name
        || !clause.namedBindings || ts.isNamespaceImport(clause.namedBindings)
        || clause.namedBindings.elements.some(element => !element.isTypeOnly)));
      add(statement.moduleSpecifier, runtime);
    } else if (ts.isExportDeclaration(statement) && statement.moduleSpecifier) {
      const runtime = !statement.isTypeOnly && (!statement.exportClause
        || ts.isNamespaceExport(statement.exportClause)
        || statement.exportClause.elements.some(element => !element.isTypeOnly));
      add(statement.moduleSpecifier, runtime);
    } else if (ts.isImportEqualsDeclaration(statement)
      && ts.isExternalModuleReference(statement.moduleReference)) {
      add(statement.moduleReference.expression, !statement.isTypeOnly);
    }
  }

  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node) && node.arguments.length === 1) {
      if (node.expression.kind === ts.SyntaxKind.ImportKeyword) add(node.arguments[0], true);
      else if (ts.isIdentifier(node.expression) && node.expression.text === 'require') add(node.arguments[0], true);
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(source, visit);
  return imports;
}
```

Complete the same file with deterministic directory walking, path resolution, graph construction,
sorted edge emission, and Tarjan SCC detection:

```ts
const normalized = (value: string) => value.replaceAll('\\', '/');

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true })
    .sort((left, right) => left.name.localeCompare(right.name))
    .flatMap(entry => {
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) return sourceFiles(fullPath);
      return /\.tsx?$/.test(entry.name) ? [fullPath] : [];
    });
}

function resolveImport(from: string, specifier: string, known: Set<string>, repoRoot: string,
  aliases: ImportAlias[]): string | undefined {
  let base: string | undefined;
  if (specifier.startsWith('.')) base = path.resolve(path.dirname(from), specifier);
  else {
    const alias = aliases.find(candidate => specifier.startsWith(candidate.prefix));
    if (alias) base = path.resolve(repoRoot, alias.directory, specifier.slice(alias.prefix.length));
  }
  if (!base) return undefined;

  const candidates = [base, `${base}.ts`, `${base}.tsx`, path.join(base, 'index.ts'), path.join(base, 'index.tsx')];
  return candidates.map(candidate => path.normalize(candidate)).find(candidate => known.has(candidate));
}

export function buildImportGraph(options: ImportGraphOptions = {}): ImportGraph {
  const repoRoot = path.resolve(options.repoRoot ?? process.cwd());
  const root = path.resolve(repoRoot, options.sourceRoot ?? 'src');
  const aliases = options.aliases ?? [];
  const files = sourceFiles(root).map(file => path.normalize(file));
  const known = new Set(files);
  const relative = (file: string) => normalized(path.relative(repoRoot, file));
  const all: ImportGraphMap = new Map(files.map(file => [relative(file), new Set<string>()]));
  const runtime: ImportGraphMap = new Map(files.map(file => [relative(file), new Set<string>()]));

  for (const file of files) {
    const from = relative(file);
    for (const dependency of parseSourceImports(readFileSync(file, 'utf8'), file)) {
      const target = resolveImport(file, dependency.specifier, known, repoRoot, aliases);
      if (!target) continue;
      const to = relative(target);
      all.get(from)!.add(to);
      if (dependency.runtime) runtime.get(from)!.add(to);
    }
  }
  return { all, runtime };
}

export function graphEdges(graph: ImportGraphMap): ImportEdge[] {
  return [...graph.entries()]
    .flatMap(([from, targets]) => [...targets].map(to => ({ from, to })))
    .sort((left, right) => left.from.localeCompare(right.from) || left.to.localeCompare(right.to));
}

export function stronglyConnectedComponents(graph: ImportGraphMap): string[][] {
  let nextIndex = 0;
  const indices = new Map<string, number>();
  const lowLinks = new Map<string, number>();
  const stack: string[] = [];
  const onStack = new Set<string>();
  const components: string[][] = [];

  const visit = (node: string) => {
    indices.set(node, nextIndex);
    lowLinks.set(node, nextIndex);
    nextIndex += 1;
    stack.push(node);
    onStack.add(node);

    for (const target of graph.get(node) ?? []) {
      if (!indices.has(target)) {
        visit(target);
        lowLinks.set(node, Math.min(lowLinks.get(node)!, lowLinks.get(target)!));
      } else if (onStack.has(target)) {
        lowLinks.set(node, Math.min(lowLinks.get(node)!, indices.get(target)!));
      }
    }

    if (lowLinks.get(node) !== indices.get(node)) return;
    const component: string[] = [];
    let current: string;
    do {
      current = stack.pop()!;
      onStack.delete(current);
      component.push(current);
    } while (current !== node);

    if (component.length > 1 || graph.get(node)?.has(node)) components.push(component.sort());
  };

  for (const node of [...graph.keys()].sort()) if (!indices.has(node)) visit(node);
  return components.sort((left, right) => left.join('\0').localeCompare(right.join('\0')));
}
```

- [ ] **Step 4: Run the focused test and fix only implementation defects**

Run:

```powershell
npx vitest run --pool=threads --maxWorkers=1 tests/architecture/import-boundaries.test.ts
```

Expected: 7 tests pass. If a policy assertion fails, inspect the reported edge before changing
policy; do not add an exception merely to make the test green.

- [ ] **Step 5: Add the explicit package gate**

Add this script to `package.json` after `test`:

```json
"test:architecture": "vitest run --pool=threads --maxWorkers=1 tests/architecture/import-boundaries.test.ts",
```

Run:

```powershell
npm run test:architecture
npm run typecheck:server
```

Expected: 7 architecture tests and server typecheck pass.

- [ ] **Step 6: Commit the executable policy**

```powershell
git add -- package.json tests/architecture/import-graph.ts tests/architecture/import-boundaries.test.ts
git commit -m "test: enforce architecture import boundaries"
```

### Task 2: Document, review, and verify the automated policy

**Files:**

- Create: `docs/architecture-import-policy.md`
- Modify: `ARCHITECTURE.md`
- Modify: `docs/MAP.md`
- Modify: `docs/architecture-audit-2026-10-19.md`
- Modify: `docs/architecture-modernization-roadmap-2026-10-19.md`

**Interfaces:**

- Consumes: the executable import policy from Task 1.
- Produces: a maintained exception register and full-repository verification evidence.

- [ ] **Step 1: Add the maintained import policy**

Create `docs/architecture-import-policy.md` with:

- the runtime/type-only distinction;
- source and alias scope;
- the three zero-exception rules;
- a table containing the exact five client runtime edges from Task 1;
- one shared rationale: the client currently queries effective characteristics and ability effects
  directly for rendering/selection;
- one removal condition: replace these edges with a shared projection/query contract, then remove
  the edge and its allowlist row together;
- the command `npm run test:architecture`.

- [ ] **Step 2: Update current and historical architecture documentation**

In `ARCHITECTURE.md`, link the policy and identify the Vitest gate near the dependency-direction
description.

In `docs/MAP.md`, add the five client rule-query imports as a documented current rough edge and
link the policy.

In `docs/architecture-audit-2026-10-19.md`, mark recommended-order item 4 complete and add a Slice 5
note without erasing the original observations.

In `docs/architecture-modernization-roadmap-2026-10-19.md`, mark Slice 5 complete and list the four
enforced policies.

- [ ] **Step 3: Run the complete verification gate**

Run:

```powershell
npm run test:architecture
npx vitest run --pool=threads --maxWorkers=1 --exclude tests/server/live-routing.test.ts
npx vitest run --pool=threads --maxWorkers=1 --silent=true tests/server/live-routing.test.ts
npm run typecheck:server
npm run typecheck:client
npm run build
git diff --check
```

Expected:

- 7 architecture tests pass;
- all non-live and live Socket.IO tests pass;
- both TypeScript projects pass;
- the production build succeeds;
- whitespace validation passes.

- [ ] **Step 4: Request independent review and address findings**

Review Slice 5 against the design and plan. Require the reviewer to inspect AST classification,
path/alias resolution, SCC correctness, policy scope, diagnostics, exception exactness,
documentation, and regression coverage. Fix all Critical and Important findings and rerun affected
tests.

- [ ] **Step 5: Commit the documentation**

```powershell
git add -- docs/architecture-import-policy.md ARCHITECTURE.md docs/MAP.md docs/architecture-audit-2026-10-19.md docs/architecture-modernization-roadmap-2026-10-19.md
git commit -m "docs: record automated architecture policy"
```

- [ ] **Step 6: Final verification and pause**

Repeat the complete verification gate on the committed state, confirm the worktree is clean, report
Slice 5's outcome and commits, keep `codex/architecture-boundaries` as-is, and pause before Slice 6.
