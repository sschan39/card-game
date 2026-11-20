#!/usr/bin/env node
/**
 * Frontend string inventory for the i18n proof of concept.
 *
 * The point is a number, not a perfect list: how many user-facing strings live in
 * the four frontends, and which of them sit outside JSX text (tool functions,
 * error messages) where a naive extractor would miss them. The CSV feeds the
 * translation batches described in docs/i18n-design.md.
 *
 * Usage (from the repository root): node scripts/i18n/inventory.mjs
 * Output: output/<yyyy-mm-dd>/<hhmmss>/i18n-inventory.csv
 */
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import ts from 'typescript';

const REPO = path.resolve(import.meta.dirname, '..', '..');
const ROOTS = [
  { dir: 'apps/game-client', namespace: 'player' },
  { dir: 'apps/deck-builder', namespace: 'builder' },
  { dir: 'apps/admin', namespace: 'admin' },
  { dir: 'packages/ui/src', namespace: 'ui' },
];
const SKIP_DIRS = new Set(['node_modules', 'dist', 'build', 'coverage', '.git']);
/** JSX attributes whose value is read by a person. */
const TEXT_ATTRIBUTES = new Set([
  'title',
  'alt',
  'placeholder',
  'label',
  'aria-label',
  'aria-description',
  'aria-roledescription',
  'aria-valuetext',
]);
const CJK = /[\u4e00-\u9fff]/;

function stamp() {
  const now = new Date();
  const pad = (value) => String(value).padStart(2, '0');
  const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const time = `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  return { date, time };
}

function* walk(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) yield* walk(path.join(directory, entry.name));
      continue;
    }
    if (/\.tsx?$/.test(entry.name)) yield path.join(directory, entry.name);
  }
}

function slug(value) {
  const normalised = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return normalised || 'text';
}

function fileSlug(relative) {
  const base = path.basename(relative).replace(/\.tsx?$/, '');
  return slug(base.replace(/([a-z0-9])([A-Z])/g, '$1-$2'));
}

/** Prose heuristics: single identifiers, class names and paths are not copy. */
function looksLikeCopy(value) {
  const text = value.trim();
  if (text.length < 4 || text.length > 300) return false;
  if (CJK.test(text)) return true;
  if (!/[A-Za-z]/.test(text)) return false;
  if (!/\s/.test(text)) return false;
  if (/^(https?:|\/|\.\/|\.\.\/)/.test(text)) return false;
  if (/^[a-z0-9-]+$/.test(text)) return false;
  if (/--/.test(text)) return false;
  if (/\$\{/.test(text)) return false;
  return /[A-Z]|[,.?!:]/.test(text) || text.split(/\s+/).length >= 3;
}

function isNonCopyContext(node) {
  const parent = node.parent;
  if (!parent) return false;
  if (ts.isImportDeclaration(parent) || ts.isExportDeclaration(parent) || ts.isImportTypeNode(parent)) return true;
  if (ts.isPropertyAssignment(parent) && parent.name === node) return true;
  if (ts.isPropertyAccessExpression(parent) && parent.name === node) return true;
  if (ts.isElementAccessExpression(parent) && parent.argumentExpression === node) return true;
  if (ts.isVariableDeclaration(parent) && parent.name === node) return true;
  if (ts.isPropertySignature(parent) || ts.isMethodSignature(parent)) return true;
  if (ts.isCaseClause(parent) || ts.isLiteralTypeNode(parent)) return true;
  return false;
}

function isTextAttributeValue(node) {
  const parent = node.parent;
  if (!parent || !ts.isJsxAttribute(parent) || parent.initializer !== node) return false;
  return ts.isIdentifier(parent.name) && TEXT_ATTRIBUTES.has(parent.name.text);
}

function csvCell(value) {
  return `"${String(value).replace(/"/g, '""')}"`;
}

function scanFile(file, namespace, rows) {
  const relative = path.relative(REPO, file).replace(/\\/g, '/');
  const base = fileSlug(relative);
  const text = fs.readFileSync(file, 'utf8');
  const scriptKind = file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, scriptKind);
  const lineOf = (position) => source.getLineAndCharacterOfPosition(position).line + 1;
  const push = (type, value, position) => {
    rows.push({
      file: relative,
      line: lineOf(position),
      kind: type,
      text: value,
      chars: [...value].length,
      suggestedKey: `${namespace}.${base}.${slug(value)}`,
    });
  };
  const visit = (node) => {
    if (ts.isJsxText(node)) {
      const value = node.text.replace(/\s+/g, ' ').trim();
      if (value && /[A-Za-z\u4e00-\u9fff]/.test(value)) push('jsx-text', value, node.getStart(source));
    } else if (ts.isJsxAttribute(node) && ts.isIdentifier(node.name) && TEXT_ATTRIBUTES.has(node.name.text)) {
      const initializer = node.initializer;
      if (initializer && ts.isStringLiteral(initializer) && initializer.text.trim()) {
        push('jsx-attr', initializer.text, initializer.getStart(source));
      }
    } else if (ts.isStringLiteral(node) && looksLikeCopy(node.text) && !isNonCopyContext(node) && !isTextAttributeValue(node)) {
      push('literal', node.text, node.getStart(source));
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
}

function main() {
  const started = process.hrtime.bigint();
  console.log('[1/4] scanning frontend sources');
  const roots = ROOTS.map((root) => ({ ...root, absolute: path.join(REPO, root.dir) }))
    .filter((root) => fs.existsSync(root.absolute));
  if (!roots.length) throw new Error(`No frontend roots found under ${REPO}`);

  const rows = [];
  let fileCount = 0;
  for (const root of roots) {
    let files = 0;
    for (const file of walk(root.absolute)) {
      scanFile(file, root.namespace, rows);
      files += 1;
    }
    fileCount += files;
    console.log(`      ${root.dir}: ${files} files`);
  }

  console.log(`[2/4] classified ${rows.length} candidate strings`);
  const { date, time } = stamp();
  const directory = path.join(REPO, 'output', date, time);
  fs.mkdirSync(directory, { recursive: true });
  const target = path.join(directory, 'i18n-inventory.csv');
  const header = 'file,line,kind,text,chars,suggestedKey';
  const body = rows.map((row) => [
    csvCell(row.file), row.line, csvCell(row.kind), csvCell(row.text), row.chars, csvCell(row.suggestedKey),
  ].join(','));
  fs.writeFileSync(target, `${[header, ...body].join('\n')}\n`, 'utf8');

  console.log('[3/4] wrote inventory');
  const counts = rows.reduce((totals, row) => {
    totals[row.kind] = (totals[row.kind] ?? 0) + 1;
    totals.chars += row.chars;
    return totals;
  }, { chars: 0 });
  console.log(`      ${path.relative(REPO, target).replace(/\\/g, '/')}`);
  const detail = `jsx-text ${counts['jsx-text'] ?? 0} · jsx-attr ${counts['jsx-attr'] ?? 0} · literal ${counts.literal ?? 0}`;
  console.log(`      ${detail} · ${counts.chars} chars total`);

  const elapsed = Number(process.hrtime.bigint() - started) / 1e6;
  console.log(`[4/4] done in ${elapsed.toFixed(0)}ms · ${fileCount} files · ${rows.length} strings`);
}

main();
