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
  sourceRoots: ['apps', 'packages'],
  aliases: [
    { prefix: '@engine/', directory: 'packages/engine/src/engine' },
    { prefix: '@shared/', directory: 'packages/engine/src/types' },
    { prefix: '@rules/', directory: 'packages/engine/src/shared' },
    { prefix: '@library/', directory: 'packages/engine/src/library' },
    { prefix: '@client/', directory: 'apps/game-client' },
    { prefix: '@server/', directory: 'apps/server/src' },
    { prefix: '@card-game/engine/', directory: 'packages/engine/src' },
    { prefix: '@card-game/protocol/', directory: 'packages/protocol/src' },
    { prefix: '@card-game/protocol', directory: 'packages/protocol/src/index' },
    { prefix: '@card-game/ui', directory: 'packages/ui/src/index' },
    { prefix: '@config', directory: 'packages/engine/src/config' },
  ],
});

const clientEngineRuntimeExceptions: string[] = [];
const policy = architecturePolicyViolations(graph, clientEngineRuntimeExceptions);
const explicitRuntimeContextSources = [
  'packages/engine/src/library/card-factory.ts',
  'packages/engine/src/engine/room-factory.ts',
  'packages/engine/src/engine/game-engine.ts',
  'packages/engine/src/engine/mutation-committer.ts',
  'apps/server/src/rooms/room-runtime.ts',
];

describe('TypeScript import graph', () => {
  it('confines the native SQLite runtime dependency to its server storage adapter', () => {
    const users = [...graph.all.keys()].filter(file => parseSourceImports(readFileSync(file, 'utf8'), file)
      .some(dependency => dependency.runtime && dependency.specifier === 'better-sqlite3'));
    expect(users).toEqual(['apps/server/src/stores/sqlite-store.ts']);
  });
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

  it('resolves the client protocol contract without a runtime engine dependency', () => {
    expect(graph.all.get('apps/game-client/socket.ts')).toContain('packages/protocol/src/index.ts');
    expect(graph.runtime.get('apps/game-client/socket.ts')).not.toContain('packages/engine/src/engine/option-service.ts');
  });

  it('detects alternate direct runtime-provider access syntax', () => {
    expect(directRuntimeProviderAccess(`
      import legacyUuid = require('uuid');
      const commonJsUuid = require('uuid');
      const random = Math ['random'];
    `, 'fixture.ts')).toEqual(['Math.random', 'uuid']);
  });

  it('keeps the card parser independent of engine implementations', () => {
    const dependencies = [...graph.all.get('packages/engine/src/library/card-parser.ts') ?? []]
      .filter(target => target.startsWith('packages/engine/src/engine/'));

    expect(dependencies).toEqual([]);
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
        ['packages/engine/src/engine/rule.ts', new Set(['apps/server/src/index.ts'])],
        ['packages/engine/src/library/parser.ts', new Set(['packages/engine/src/engine/internal.ts'])],
        ['packages/engine/src/types/room.ts', new Set(['packages/engine/src/config.ts', 'packages/engine/src/config/index.ts'])],
        ['apps/server/src/index.ts', new Set([
          'packages/engine/src/engine/game-engine.ts',
          'packages/engine/src/engine/handlers/concrete.ts',
        ])],
      ]),
      runtime: new Map([
        ['packages/engine/src/engine/self-cycle.ts', new Set(['packages/engine/src/engine/self-cycle.ts'])],
        ['apps/game-client/extra.ts', new Set(['packages/engine/src/engine/query.ts'])],
      ]),
    };

    expect(architecturePolicyViolations(fixture, [
      'apps/game-client/expected.ts -> packages/engine/src/engine/query.ts',
    ])).toEqual({
      runtimeCycles: [['packages/engine/src/engine/self-cycle.ts']],
      appToApp: [],
      packageToApp: ['packages/engine/src/engine/rule.ts -> apps/server/src/index.ts'],
      cardContentToEngine: ['packages/engine/src/library/parser.ts -> packages/engine/src/engine/internal.ts'],
      typesToExecutableConfig: ['packages/engine/src/types/room.ts -> packages/engine/src/config.ts', 'packages/engine/src/types/room.ts -> packages/engine/src/config/index.ts'],
      engineToTransport: ['packages/engine/src/engine/rule.ts -> apps/server/src/index.ts'],
      transportToHandlers: ['apps/server/src/index.ts -> packages/engine/src/engine/handlers/concrete.ts'],
      transportEntryToEngine: [
        'apps/server/src/index.ts -> packages/engine/src/engine/game-engine.ts',
        'apps/server/src/index.ts -> packages/engine/src/engine/handlers/concrete.ts',
      ],
      unexpectedClientRuntimeEngine: ['apps/game-client/extra.ts -> packages/engine/src/engine/query.ts'],
      missingClientRuntimeEngine: ['apps/game-client/expected.ts -> packages/engine/src/engine/query.ts'],
    });
  });

  it('has no runtime import cycles', () => {
    expect(policy.runtimeCycles,
      `Runtime import cycles:\n${JSON.stringify(policy.runtimeCycles, null, 2)}`).toEqual([]);
  });

  it('keeps card content independent of engine implementations', () => {
    expect(policy.cardContentToEngine,
      `Card-content-to-engine imports:\n${policy.cardContentToEngine.join('\n')}`).toEqual([]);
  });

  it('keeps type declarations independent of executable configuration', () => {
    expect(policy.typesToExecutableConfig,
      `Type-to-config imports:\n${policy.typesToExecutableConfig.join('\n')}`).toEqual([]);
  });

  it('keeps engine imports independent of transport and multiplayer', () => {
    expect(policy.engineToTransport,
      `Engine-to-transport imports:\n${policy.engineToTransport.join('\n')}`).toEqual([]);
  });

  it('keeps transport independent of concrete rule handlers', () => {
    expect(policy.transportToHandlers,
      `Transport-to-handler imports:\n${policy.transportToHandlers.join('\n')}`).toEqual([]);
  });

  it('keeps apps independent of other apps', () => {
    expect(policy.appToApp,
      `App-to-app imports:\n${policy.appToApp.join('\n')}`).toEqual([]);
  });

  it('keeps packages independent of apps', () => {
    expect(policy.packageToApp,
      `Package-to-app imports:\n${policy.packageToApp.join('\n')}`).toEqual([]);
  });

  it('keeps the Socket.IO entry point behind the room runtime', () => {
    expect(policy.transportEntryToEngine,
      `Transport entry-point engine imports:\n${policy.transportEntryToEngine?.join('\n')}`).toEqual([]);
  });

  it('has no client runtime engine imports', () => {
    expect({
      unexpected: policy.unexpectedClientRuntimeEngine,
      missing: policy.missingClientRuntimeEngine,
    }, `Unexpected client runtime engine imports:\n${policy.unexpectedClientRuntimeEngine.join('\n')}\n`
      + `Missing documented client runtime engine imports:\n${policy.missingClientRuntimeEngine.join('\n')}`)
      .toEqual({ unexpected: [], missing: [] });
  });
});

describe('Milestone 1 protocol boundary', () => {
  it('keeps the deck builder and shared UI independent of the engine and other applications', () => {
    const edges = [...graph.all].flatMap(([from, targets]) => [...targets].filter(to =>
      (from.startsWith('apps/deck-builder/') || from.startsWith('packages/ui/')) &&
      (to.startsWith('packages/engine/') || to.startsWith('apps/') && !to.startsWith('apps/deck-builder/'))
    ).map(to => from + ' -> ' + to));
    expect(edges).toEqual([]);
    expect(graph.all.get('apps/game-client/components/CardComponent.tsx')).toContain('packages/ui/src/index.ts');
    expect(graph.all.get('apps/deck-builder/App.tsx')).toContain('packages/ui/src/index.ts');
  });
  it('keeps the admin application independent of the engine and other applications', () => {
    const edges = [...graph.all].flatMap(([from, targets]) => [...targets].filter(to => from.startsWith('apps/admin/') && (to.startsWith('packages/engine/') || to.startsWith('apps/') && !to.startsWith('apps/admin/'))).map(to => from + ' -> ' + to));
    expect(edges).toEqual([]);
  });
  it('keeps every client import independent of the engine package', () => {
    const edges = [...graph.all].flatMap(([from, targets]) => [...targets].filter(to => from.startsWith('apps/game-client/') && to.startsWith('packages/engine/')).map(to => from + ' -> ' + to));
    expect(edges).toEqual([]);
  });
  it('allows only type-only protocol dependencies on engine', () => {
    const edges = [...graph.runtime].flatMap(([from, targets]) => [...targets].filter(to => from.startsWith('packages/protocol/') && to.startsWith('packages/engine/')).map(to => from + ' -> ' + to));
    expect(edges).toEqual([]);
  });
});
