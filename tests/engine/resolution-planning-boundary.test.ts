import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');

describe('resolution planning boundary', () => {
  it('gives shared planning primitives a lower-level module', () => {
    expect(existsSync(resolve(process.cwd(), 'src/engine/resolution-planning.ts'))).toBe(true);
    expect(source('src/engine/effect-resolver.ts')).toMatch(
      /export\s*\{[^}]*buildStackEffects[^}]*buildDynamicParams[^}]*revalidateTargets[^}]*\}\s*from\s*['"]\.\/resolution-planning['"]/s,
    );
  });

  it.each([
    'src/engine/bounded-reveal.ts',
    'src/engine/resolution-choices.ts',
  ])('%s does not import the orchestration facade', path => {
    expect(source(path)).not.toMatch(/from\s+['"]\.\/effect-resolver['"]/);
  });
});
