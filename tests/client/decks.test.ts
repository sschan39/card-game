import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadSavedDecks } from '@client/decks';

afterEach(() => vi.unstubAllGlobals());
describe('saved deck selector data', () => {
  it('uses account bearer authorization, a bounded page and cancellation', async () => {
    const fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ protocolVersion: 1, decks: [], total: 0, offset: 0, limit: 100 }) });
    vi.stubGlobal('fetch', fetcher); const controller = new AbortController();
    expect(await loadSavedDecks('opaque-account-token', controller.signal)).toEqual([]);
    expect(fetcher).toHaveBeenCalledWith('/api/decks?offset=0&limit=100', { headers: { Authorization: 'Bearer opaque-account-token' }, signal: controller.signal });
  });
  it('rejects denied access and incompatible wire data', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false })); await expect(loadSavedDecks('token')).rejects.toThrow('Unable');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ protocolVersion: 999, decks: [] }) }));
    await expect(loadSavedDecks('token')).rejects.toThrow('incompatible');
  });
});
