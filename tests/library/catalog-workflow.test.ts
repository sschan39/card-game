import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, expect, it } from 'vitest';

const temporaryDirectories: string[] = [];
afterEach(() => temporaryDirectories.splice(0).forEach(path => rmSync(path, { recursive: true, force: true })));

it('discovers added, moved and removed definitions without hand-editing the catalog', () => {
  const root = mkdtempSync(join(tmpdir(), 'card-catalog-'));
  temporaryDirectories.push(root);
  const library = join(root, 'apps', 'server', 'src', 'catalog');
  const cards = join(library, 'cards');
  const group = join(cards, 'new-set');
  const tokens = join(library, 'tokens');
  const manifest = join(cards, 'manifest.generated.ts');
  const original = join(cards, 'existing.json');
  const added = join(group, 'different-filename.json');
  mkdirSync(group, { recursive: true });
  mkdirSync(tokens);
  mkdirSync(join(root, 'scripts'));
  const script = join(root, 'scripts', 'sync-card-catalog.mjs');
  copyFileSync(resolve('scripts/sync-card-catalog.mjs'), script);
  const sync = (...args: string[]) => spawnSync(process.execPath, [script, ...args], { encoding: 'utf8' });
  const definition = (id: string, name = id) => JSON.stringify({ schemaVersion: 1, id, name });
  writeFileSync(original, definition('existing'));
  expect(sync().status).toBe(0);
  const first = readFileSync(manifest, 'utf8');

  writeFileSync(added, definition('new-card'));
  expect(sync('--check').stderr).toContain('Card manifests are stale');
  expect(sync().status).toBe(0);
  const withAddition = readFileSync(manifest, 'utf8');
  expect(withAddition).toContain('["new-card"]');
  expect(withAddition).toContain('./new-set/different-filename.json');
  writeFileSync(added, definition('new-card', 'Edited title'));
  expect(sync('--check').status).toBe(0);

  writeFileSync(join(tokens, 'conflict.json'), definition('new-card'));
  expect(sync().stderr).toContain('Duplicate definition new-card');
  expect(readFileSync(manifest, 'utf8')).toBe(withAddition);
  unlinkSync(join(tokens, 'conflict.json'));

  const moved = join(cards, 'renamed-card.json');
  renameSync(added, moved);
  expect(sync('--check').stderr).toContain('Card manifests are stale');
  expect(sync().status).toBe(0);
  const afterMove = readFileSync(manifest, 'utf8');
  expect(afterMove).toContain('["new-card"]');
  expect(afterMove).toContain('./renamed-card.json');
  expect(afterMove).not.toContain('./new-set/different-filename.json');
  unlinkSync(moved);
  expect(sync().status).toBe(0);
  expect(readFileSync(manifest, 'utf8')).toBe(first);
});
