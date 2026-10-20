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
      import {} from './empty-runtime';
      import './side-effect';
      export type { C } from './export-type';
      export { type D, runtimeExport } from './export-mixed';
      const lazy = import('./dynamic');
      const commonJs = require('./required');
      import legacy = require('./legacy');
    `, 'fixture.ts');

    expect(imports.filter(item => item.runtime).map(item => item.specifier).sort()).toEqual([
      './dynamic', './empty-runtime', './export-mixed', './legacy', './mixed', './required', './side-effect',
    ]);
    expect(imports.map(item => item.specifier).sort()).toEqual([
      './dynamic', './empty-runtime', './export-mixed', './export-type', './legacy', './mixed', './required', './side-effect', './type-only',
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
    const cycles = stronglyConnectedComponents(graph.runtime);
    expect(cycles, `Runtime import cycles:\n${JSON.stringify(cycles, null, 2)}`).toEqual([]);
  });

  it('keeps engine imports independent of transport and multiplayer', () => {
    const violations = graphEdges(graph.all)
      .filter(edge => edge.from.startsWith('src/engine/') && isTransport(edge.to))
      .map(edge => render(edge.from, edge.to));
    expect(violations, `Engine-to-transport imports:\n${violations.join('\n')}`).toEqual([]);
  });

  it('keeps transport independent of concrete rule handlers', () => {
    const violations = graphEdges(graph.all)
      .filter(edge => isTransport(edge.from) && edge.to.startsWith('src/engine/handlers/'))
      .map(edge => render(edge.from, edge.to));
    expect(violations, `Transport-to-handler imports:\n${violations.join('\n')}`).toEqual([]);
  });

  it('allows only documented client runtime rule queries', () => {
    const actual = graphEdges(graph.runtime)
      .filter(edge => edge.from.startsWith('src/client/') && edge.to.startsWith('src/engine/'))
      .map(edge => render(edge.from, edge.to));
    expect(actual, `Client runtime engine imports:\n${actual.join('\n')}`).toEqual(clientEngineRuntimeExceptions);
  });
});
