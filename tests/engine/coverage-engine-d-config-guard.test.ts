import { afterEach, describe, expect, it, vi } from 'vitest';

const diagnosticsPath = '../../packages/engine/src/config/diagnostics.json';

afterEach(() => {
  vi.doUnmock(diagnosticsPath);
  vi.resetModules();
});

describe('engine diagnostic configuration guard', () => {
  it('refuses to load the engine with an unsupported diagnostic mode', async () => {
    vi.resetModules();
    vi.doMock(diagnosticsPath, () => ({
      default: { debugMode: 'trace', logging: { actions: true, appliedEvents: true } },
    }));

    await expect(import('@config')).rejects.toThrow('Invalid engine diagnostic/element configuration');
  });
});
