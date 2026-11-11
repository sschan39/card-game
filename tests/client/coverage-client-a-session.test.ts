import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PROTOCOL_VERSION, type AuthResponse } from '@card-game/protocol';
import {
  clearStoredRoomId,
  getOrCreatePlayerId,
  getStoredAuth,
  getStoredRoomId,
  setStoredAuth,
  setStoredRoomId,
} from '@client/session';

const session: AuthResponse = {
  protocolVersion: PROTOCOL_VERSION,
  scope: 'game',
  sessionId: 'session',
  token: 'A'.repeat(43),
  expiresAt: Date.now() + 60_000,
  playerId: 'player1',
  account: null,
};

function createStorage(): Storage {
  const data = new Map<string, string>();
  return {
    get length() { return data.size; },
    clear: () => data.clear(),
    getItem: (key: string) => data.get(key) ?? null,
    key: (index: number) => Array.from(data.keys())[index] ?? null,
    removeItem: (key: string) => { data.delete(key); },
    setItem: (key: string, value: string) => { data.set(key, String(value)); },
  } as Storage;
}

beforeEach(() => {
  vi.stubGlobal('sessionStorage', createStorage());
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('per-tab player identity', () => {
  it('creates the stable player id with the platform UUID generator exactly once', () => {
    const randomUUID = vi.fn(() => '11111111-1111-4111-8111-111111111111');
    vi.stubGlobal('crypto', { randomUUID });

    const created = getOrCreatePlayerId();
    expect(created).toBe('11111111-1111-4111-8111-111111111111');
    expect(sessionStorage.getItem('cardgame.playerId')).toBe(created);
    expect(getOrCreatePlayerId()).toBe(created);
    expect(randomUUID).toHaveBeenCalledTimes(1);
  });

  it('falls back to a masked random UUID when the platform generator is missing', () => {
    vi.stubGlobal('crypto', {});
    vi.spyOn(Math, 'random').mockReturnValue(0.5);

    expect(getOrCreatePlayerId()).toBe('88888888-8888-4888-8888-888888888888');
  });

  it('falls back when the crypto global itself is unavailable', () => {
    vi.stubGlobal('crypto', undefined);
    vi.spyOn(Math, 'random').mockReturnValue(0.0625);

    expect(getOrCreatePlayerId()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});

describe('tab-local session persistence', () => {
  it('stores a validated credential and room id in sessionStorage', () => {
    setStoredAuth(session);
    expect(getStoredAuth()).toEqual(session);
    setStoredRoomId('room-1');
    expect(getStoredRoomId()).toBe('room-1');
    clearStoredRoomId();
    expect(getStoredRoomId()).toBeNull();
    setStoredAuth(null);
    expect(getStoredAuth()).toBeNull();
    expect(sessionStorage.getItem('cardgame.authSession')).toBeNull();
  });

  it('rejects a credential that does not satisfy the protocol shape and keeps the last safe value', () => {
    setStoredAuth(session);
    sessionStorage.setItem('cardgame.authSession', JSON.stringify({ ...session, token: 'short' }));
    expect(getStoredAuth()).toEqual(session);
    sessionStorage.setItem('cardgame.authSession', '{not-json');
    expect(getStoredAuth()).toEqual(session);
  });

  it('keeps working in memory when the tab storage is unavailable', () => {
    vi.stubGlobal('sessionStorage', {
      getItem() { throw new Error('denied'); },
      setItem() { throw new Error('denied'); },
      removeItem() { throw new Error('denied'); },
    });

    setStoredAuth(session);
    setStoredRoomId('memory-room');
    expect(getStoredAuth()).toEqual(session);
    expect(getStoredRoomId()).toBe('memory-room');
    clearStoredRoomId();
    expect(getStoredRoomId()).toBeNull();
    setStoredAuth(null);
    expect(getStoredAuth()).toBeNull();
  });

  it('uses the in-memory copies when there is no sessionStorage at all', () => {
    vi.stubGlobal('sessionStorage', undefined);
    setStoredAuth(session);
    setStoredRoomId('memory-room');
    expect(getStoredAuth()).toEqual(session);
    expect(getStoredRoomId()).toBe('memory-room');
    setStoredAuth(null);
    expect(getStoredAuth()).toBeNull();
    clearStoredRoomId();
    expect(getStoredRoomId()).toBeNull();
  });
});
