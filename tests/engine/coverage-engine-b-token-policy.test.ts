import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * `token-policy.ts` validates its bundled configuration at module load. The
 * only way to reach the rejection path is to reload the module against a
 * different `tokens.json`, so each case mocks the JSON module and re-imports.
 */
async function loadWithPolicy(policy: Record<string, unknown>) {
  vi.resetModules();
  vi.doMock('@config/tokens.json', () => ({ default: policy }));
  try {
    return await import('@rules/token-policy');
  } finally {
    vi.doUnmock('@config/tokens.json');
    vi.resetModules();
  }
}

afterEach(() => {
  vi.doUnmock('@config/tokens.json');
  vi.resetModules();
});

describe('tokenPolicy configuration guard', () => {
  it('freezes the shipped policy when it is valid', async () => {
    const module = await loadWithPolicy({ maxCreatedPerInstruction: 8 });
    expect(module.tokenPolicy).toEqual({ maxCreatedPerInstruction: 8 });
    expect(Object.isFrozen(module.tokenPolicy)).toBe(true);
  });

  it('rejects a policy with unexpected keys', async () => {
    await expect(loadWithPolicy({ maxCreatedPerInstruction: 8, extra: true })).rejects.toThrow('Invalid token creation limits');
  });

  it('rejects a non-integer limit', async () => {
    await expect(loadWithPolicy({ maxCreatedPerInstruction: 1.5 })).rejects.toThrow('Invalid token creation limits');
  });

  it('rejects a limit below one', async () => {
    await expect(loadWithPolicy({ maxCreatedPerInstruction: 0 })).rejects.toThrow('Invalid token creation limits');
  });

  it('rejects a limit above the hard cap', async () => {
    await expect(loadWithPolicy({ maxCreatedPerInstruction: 257 })).rejects.toThrow('Invalid token creation limits');
  });
});
