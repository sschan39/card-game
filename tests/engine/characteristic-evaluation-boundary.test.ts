import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');

describe('characteristic evaluation boundary', () => {
  it('gives read-only continuous-effect state queries a lower-level module', () => {
    const path = 'packages/engine/src/engine/continuous-effect-state.ts';
    expect(existsSync(resolve(process.cwd(), path))).toBe(true);
    if (!existsSync(resolve(process.cwd(), path))) return;

    const contents = source(path);
    expect(contents).not.toMatch(/from\s+['"]\.\/continuous-effects['"]/);
    expect(contents).not.toMatch(/from\s+['"]\.\/characteristic-layers['"]/);
    expect(contents).not.toMatch(/from\s+['"]\.\/card-characteristic-service['"]/);
  });

  it('keeps layer evaluation independent of normalization and its public facade', () => {
    const contents = source('packages/engine/src/engine/characteristic-layers.ts');
    expect(contents).not.toMatch(/from\s+['"]\.\/continuous-effects['"]/);
    expect(contents).not.toMatch(/from\s+['"]\.\/card-characteristic-service['"]/);
  });

  it('preserves continuous-effects compatibility exports as direct bindings', () => {
    expect(source('packages/engine/src/engine/continuous-effects.ts')).toMatch(
      /export\s*\{[^}]*roomCards[^}]*effectSource[^}]*effectIsActive[^}]*\}\s*from\s*['"]\.\/continuous-effect-state['"]/s,
    );
  });

  it('preserves the compatibility exports as identical runtime bindings', async () => {
    const [compatibility, state] = await Promise.all([
      import('@engine/continuous-effects'),
      import('@engine/continuous-effect-state'),
    ]);

    expect(compatibility.roomCards).toBe(state.roomCards);
    expect(compatibility.effectSource).toBe(state.effectSource);
    expect(compatibility.effectIsActive).toBe(state.effectIsActive);
  });
});
