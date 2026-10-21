import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  architecturePolicyViolations,
  buildImportGraph,
  directRuntimeProviderAccess,
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
const policy = architecturePolicyViolations(graph, clientEngineRuntimeExceptions);
const explicitRuntimeContextSources = [
  'src/library/card-factory.ts',
  'src/engine/room-factory.ts',
  'src/engine/game-engine.ts',
  'src/engine/mutation-committer.ts',
  'src/server/room-runtime.ts',
];

describe('TypeScript import graph', () => {
  it('distinguishes type-only syntax from runtime imports', () => {
    const imports = parseSourceImports(`
      import type { A } from './type-only';
      import { type B, runtime } from './mixed';
      import {} from './empty-runtime';
      import './side-effect';
      export type { C } from './export-type';
      export { type D, runtimeExport } from './export-mixed';
      type ImportedType = import('./import-type').ImportedType;
      const lazy = import('./dynamic');
      const commonJs = require('./required');
      import legacy = require('./legacy');
    `, 'fixture.ts');

    expect(imports.filter(item => item.runtime).map(item => item.specifier).sort()).toEqual([
      './dynamic', './empty-runtime', './export-mixed', './legacy', './mixed', './required', './side-effect',
    ]);
    expect(imports.map(item => item.specifier).sort()).toEqual([
      './dynamic', './empty-runtime', './export-mixed', './export-type', './import-type', './legacy', './mixed', './required', './side-effect', './type-only',
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

  it('detects alternate direct runtime-provider access syntax', () => {
    expect(directRuntimeProviderAccess(`
      import legacyUuid = require('uuid');
      const commonJsUuid = require('uuid');
      const random = Math ['random'];
    `, 'fixture.ts')).toEqual(['Math.random', 'uuid']);
  });
});

describe('repository architecture policy', () => {
  it('keeps authoritative nondeterminism behind RuntimeContext', () => {
    const violations = explicitRuntimeContextSources.flatMap(source => {
      const text = readFileSync(source, 'utf8');
      return directRuntimeProviderAccess(text, source)
        .map(provider => `${source} -> ${provider}`);
    });

    expect(violations, `Direct authoritative nondeterminism:\n${violations.join('\n')}`).toEqual([]);
  });

  it('reports violating edges, missing exceptions, and runtime self-cycles', () => {
    const fixture = {
      all: new Map([
        ['src/engine/rule.ts', new Set(['src/server.ts'])],
        ['src/server.ts', new Set([
          'src/engine/game-engine.ts',
          'src/engine/handlers/concrete.ts',
        ])],
      ]),
      runtime: new Map([
        ['src/engine/self-cycle.ts', new Set(['src/engine/self-cycle.ts'])],
        ['src/client/extra.ts', new Set(['src/engine/query.ts'])],
      ]),
    };

    expect(architecturePolicyViolations(fixture, [
      'src/client/expected.ts -> src/engine/query.ts',
    ])).toEqual({
      runtimeCycles: [['src/engine/self-cycle.ts']],
      engineToTransport: ['src/engine/rule.ts -> src/server.ts'],
      transportToHandlers: ['src/server.ts -> src/engine/handlers/concrete.ts'],
      transportEntryToEngine: [
        'src/server.ts -> src/engine/game-engine.ts',
        'src/server.ts -> src/engine/handlers/concrete.ts',
      ],
      unexpectedClientRuntimeEngine: ['src/client/extra.ts -> src/engine/query.ts'],
      missingClientRuntimeEngine: ['src/client/expected.ts -> src/engine/query.ts'],
    });
  });

  it('has no runtime import cycles', () => {
    expect(policy.runtimeCycles,
      `Runtime import cycles:\n${JSON.stringify(policy.runtimeCycles, null, 2)}`).toEqual([]);
  });

  it('keeps engine imports independent of transport and multiplayer', () => {
    expect(policy.engineToTransport,
      `Engine-to-transport imports:\n${policy.engineToTransport.join('\n')}`).toEqual([]);
  });

  it('keeps transport independent of concrete rule handlers', () => {
    expect(policy.transportToHandlers,
      `Transport-to-handler imports:\n${policy.transportToHandlers.join('\n')}`).toEqual([]);
  });

  it('keeps the Socket.IO entry point behind the room runtime', () => {
    expect(policy.transportEntryToEngine,
      `Transport entry-point engine imports:\n${policy.transportEntryToEngine?.join('\n')}`).toEqual([]);
  });

  it('allows only documented client runtime rule queries', () => {
    expect({
      unexpected: policy.unexpectedClientRuntimeEngine,
      missing: policy.missingClientRuntimeEngine,
    }, `Unexpected client runtime engine imports:\n${policy.unexpectedClientRuntimeEngine.join('\n')}\n`
      + `Missing documented client runtime engine imports:\n${policy.missingClientRuntimeEngine.join('\n')}`)
      .toEqual({ unexpected: [], missing: [] });
  });
});
