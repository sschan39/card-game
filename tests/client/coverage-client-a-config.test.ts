import { afterEach, describe, expect, it, vi } from 'vitest';

const DIAGNOSTICS = '@client/config/diagnostics.json';
const UI = '@client/config/ui.json';

function mockDiagnostics(actions: unknown) {
  vi.doMock(DIAGNOSTICS, () => ({ default: { logging: { actions } } }));
}
function mockUi(overrides: Record<string, unknown>) {
  vi.doMock(UI, () => ({ default: { savedDeckPageSize: 100, gameLogMaxEntries: 100, gameLogSummaryMaxLength: 8000, ...overrides } }));
}

afterEach(() => {
  vi.doUnmock(DIAGNOSTICS);
  vi.doUnmock(UI);
  vi.resetModules();
});

describe('client interface configuration', () => {
  it('exposes the shipped diagnostics flag and a frozen UI policy', async () => {
    vi.resetModules();
    const config = await import('@client/config');
    expect(config.clientFlags).toEqual({ logging: { actions: true } });
    expect(config.clientUi).toEqual({ savedDeckPageSize: 100, gameLogMaxEntries: 100, gameLogSummaryMaxLength: 8000 });
    expect(Object.isFrozen(config.clientUi)).toBe(true);
    expect(Object.isFrozen(config.clientFlags)).toBe(false);
  });

  it('refuses a non-boolean action logging flag', async () => {
    vi.resetModules();
    mockDiagnostics('verbose');
    await expect(import('@client/config')).rejects.toThrow('Invalid player interface configuration');
  });

  it('refuses a saved deck page size outside the supported range', async () => {
    vi.resetModules();
    mockUi({ savedDeckPageSize: 0 });
    await expect(import('@client/config')).rejects.toThrow('Invalid player interface configuration');
  });

  it('refuses an oversized saved deck page size', async () => {
    vi.resetModules();
    mockUi({ savedDeckPageSize: 101 });
    await expect(import('@client/config')).rejects.toThrow('Invalid player interface configuration');
  });

  it('refuses a game log entry limit outside the supported range', async () => {
    vi.resetModules();
    mockUi({ gameLogMaxEntries: 501 });
    await expect(import('@client/config')).rejects.toThrow('Invalid game log configuration');
  });

  it('refuses a game log summary budget below the readable minimum', async () => {
    vi.resetModules();
    mockUi({ gameLogSummaryMaxLength: 99 });
    await expect(import('@client/config')).rejects.toThrow('Invalid game log configuration');
  });
});
