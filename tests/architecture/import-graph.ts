import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

export interface ParsedImport {
  specifier: string;
  runtime: boolean;
}

export interface ImportEdge {
  from: string;
  to: string;
}

export type ImportGraphMap = Map<string, Set<string>>;

export interface ImportGraph {
  all: ImportGraphMap;
  runtime: ImportGraphMap;
}

export interface ImportAlias {
  prefix: string;
  directory: string;
}

export interface ImportGraphOptions {
  repoRoot?: string;
  sourceRoot?: string;
  sourceRoots?: string[];
  aliases?: ImportAlias[];
}

export interface ArchitecturePolicyViolations {
  runtimeCycles: string[][];
  appToApp: string[];
  packageToApp: string[];
  cardContentToEngine: string[];
  typesToExecutableConfig: string[];
  engineToTransport: string[];
  transportToHandlers: string[];
  transportEntryToEngine: string[];
  unexpectedClientRuntimeEngine: string[];
  missingClientRuntimeEngine: string[];
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
        || clause.namedBindings.elements.length === 0
        || clause.namedBindings.elements.some(element => !element.isTypeOnly)));
      add(statement.moduleSpecifier, runtime);
    } else if (ts.isExportDeclaration(statement) && statement.moduleSpecifier) {
      const runtime = !statement.isTypeOnly && (!statement.exportClause
        || ts.isNamespaceExport(statement.exportClause)
        || statement.exportClause.elements.length === 0
        || statement.exportClause.elements.some(element => !element.isTypeOnly));
      add(statement.moduleSpecifier, runtime);
    } else if (ts.isImportEqualsDeclaration(statement)
      && ts.isExternalModuleReference(statement.moduleReference)) {
      add(statement.moduleReference.expression, !statement.isTypeOnly);
    }
  }

  const visit = (node: ts.Node) => {
    if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)) {
      add(node.argument.literal, false);
    } else if (ts.isCallExpression(node) && node.arguments.length === 1) {
      if (node.expression.kind === ts.SyntaxKind.ImportKeyword) add(node.arguments[0], true);
      else if (ts.isIdentifier(node.expression) && node.expression.text === 'require') add(node.arguments[0], true);
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(source, visit);
  return imports;
}

export function directRuntimeProviderAccess(sourceText: string, fileName: string): string[] {
  const providers = new Set<string>();
  if (parseSourceImports(sourceText, fileName)
    .some(dependency => dependency.runtime && dependency.specifier === 'uuid')) {
    providers.add('uuid');
  }

  const source = ts.createSourceFile(fileName, sourceText, ts.ScriptTarget.Latest, true,
    fileName.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const visit = (node: ts.Node) => {
    const directPropertyAccess = ts.isPropertyAccessExpression(node)
      && ts.isIdentifier(node.expression)
      && node.expression.text === 'Math'
      && node.name.text === 'random';
    const directElementAccess = ts.isElementAccessExpression(node)
      && ts.isIdentifier(node.expression)
      && node.expression.text === 'Math'
      && !!node.argumentExpression
      && ts.isStringLiteralLike(node.argumentExpression)
      && node.argumentExpression.text === 'random';
    if (directPropertyAccess || directElementAccess) providers.add('Math.random');
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(source, visit);
  return [...providers].sort();
}

const normalized = (value: string) => value.replaceAll('\\', '/');

const ignoredDirectories = new Set(['node_modules', '.git', 'dist', 'coverage']);

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true })
    .sort((left, right) => left.name.localeCompare(right.name))
    .flatMap(entry => {
      if (entry.isDirectory() && ignoredDirectories.has(entry.name)) return [];
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
  const aliases = options.aliases ?? [];
  const roots = options.sourceRoots ?? [options.sourceRoot ?? 'src'];
  const files = roots.flatMap(root => sourceFiles(path.resolve(repoRoot, root)))
    .map(file => path.normalize(file));
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

const isTransport = (file: string) => file === 'apps/server/src/index.ts'
  || file.startsWith('apps/server/src/');
const appName = (file: string) => (file.startsWith('apps/') ? file.split('/')[1] : undefined);
const isPackageSource = (file: string) => file.startsWith('packages/');
const renderEdge = ({ from, to }: ImportEdge) => `${from} -> ${to}`;

export function architecturePolicyViolations(graph: ImportGraph,
  allowedClientRuntimeEngine: string[]): ArchitecturePolicyViolations {
  const allEdges = graphEdges(graph.all);
  const clientRuntimeEngine = graphEdges(graph.runtime)
    .filter(edge => edge.from.startsWith('apps/game-client/') && edge.to.startsWith('packages/engine/src/engine/'))
    .map(renderEdge);
  const actualClientEdges = new Set(clientRuntimeEngine);
  const allowedClientEdges = new Set(allowedClientRuntimeEngine);

  return {
    runtimeCycles: stronglyConnectedComponents(graph.runtime),
    appToApp: allEdges
      .filter(edge => {
        const fromApp = appName(edge.from);
        const toApp = appName(edge.to);
        return !!fromApp && !!toApp && fromApp !== toApp;
      })
      .map(renderEdge),
    packageToApp: allEdges
      .filter(edge => isPackageSource(edge.from) && !!appName(edge.to))
      .map(renderEdge),
    cardContentToEngine: allEdges
      .filter(edge => edge.from.startsWith('packages/engine/src/library/') && edge.to.startsWith('packages/engine/src/engine/'))
      .map(renderEdge),
    typesToExecutableConfig: allEdges
      .filter(edge => edge.from.startsWith('packages/engine/src/types/') && (edge.to === 'packages/engine/src/config.ts' || edge.to.startsWith('packages/engine/src/config/')))
      .map(renderEdge),
    engineToTransport: allEdges
      .filter(edge => edge.from.startsWith('packages/engine/src/engine/') && isTransport(edge.to))
      .map(renderEdge),
    transportToHandlers: allEdges
      .filter(edge => isTransport(edge.from) && edge.to.startsWith('packages/engine/src/engine/handlers/'))
      .map(renderEdge),
    transportEntryToEngine: allEdges
      .filter(edge => ['apps/server/src/index.ts', 'apps/server/src/application.ts'].includes(edge.from) && edge.to.startsWith('packages/engine/src/engine/'))
      .map(renderEdge),
    unexpectedClientRuntimeEngine: clientRuntimeEngine.filter(edge => !allowedClientEdges.has(edge)),
    missingClientRuntimeEngine: [...allowedClientEdges].filter(edge => !actualClientEdges.has(edge)).sort(),
  };
}
