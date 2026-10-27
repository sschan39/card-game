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
  it('loads later pages so changing page size cannot hide saved decks', async () => {
    const deck = (index: number) => ({ id: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`, name: 'Saved ' + index, format: 'standard', cards: [{ cardId: 'land-red', quantity: 60 }], createdAt: 1, updatedAt: 1 });
    const fetcher = vi.fn().mockResolvedValueOnce({ ok: true, json: async () => ({ protocolVersion: 1, decks: Array.from({ length: 100 }, (_, index) => deck(index)), total: 101, offset: 0, limit: 100 }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ protocolVersion: 1, decks: [deck(100)], total: 101, offset: 100, limit: 100 }) });
    vi.stubGlobal('fetch', fetcher); expect(await loadSavedDecks('token')).toHaveLength(101); expect(fetcher.mock.calls[1][0]).toBe('/api/decks?offset=100&limit=100');
  });
});
