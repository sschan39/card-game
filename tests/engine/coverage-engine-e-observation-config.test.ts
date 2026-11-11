import { afterEach, describe, expect, it, vi } from 'vitest';

describe('observation limit configuration guard', () => {
  afterEach(() => {
    vi.doUnmock('@config/observations.json');
    vi.resetModules();
  });

  it('refuses to load a configuration outside the supported bounds', async () => {
    vi.resetModules();
    vi.doMock('@config/observations.json', () => ({ default: { maxWindowCards: 4, historyLimit: 128 } }));
    await expect(import('@rules/observation-policy')).rejects.toThrow('Invalid observation limits');
  });
});
