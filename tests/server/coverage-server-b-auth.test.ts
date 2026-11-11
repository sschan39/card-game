import { describe, expect, it, vi } from 'vitest';
import { authConfig } from '@server/config';
import { InMemoryAccountStore, type AccountRecord } from '@server/auth/account-store';
import { SessionService } from '@server/auth/session';
import { verifyPassword } from '@server/auth/password';

const accountRecord = (overrides: Partial<AccountRecord> = {}): AccountRecord => ({
  id: 'account-one',
  username: 'one',
  role: 'player',
  passwordHash: 'stored-hash',
  disabled: false,
  createdAt: 1,
  ...overrides,
});

describe('session issuing and validation boundaries', () => {
  it('refuses privileged guests, missing accounts and non-admin admin scopes before writing rows', () => {
    const store = new InMemoryAccountStore();
    const sessions = new SessionService(store, authConfig);
    expect(() => sessions.issue({ kind: 'guest', id: 'guest-one' }, 'admin')).toThrow(
      'An account is required for admin access.',
    );
    expect(() => sessions.issue({ kind: 'account', id: 'missing' })).toThrow('Account is unavailable.');
    store.insertAccount(accountRecord());
    expect(() => sessions.issue({ kind: 'account', id: 'account-one' }, 'admin')).toThrow('Admin role required.');
    expect(store.sessions()).toEqual([]);
  });

  it('rejects a parent on a legacy session and browser sessions for guests', () => {
    const store = new InMemoryAccountStore();
    const sessions = new SessionService(store, authConfig);
    store.insertAccount(accountRecord({ role: 'admin' }));
    const browser = sessions.issue({ kind: 'account', id: 'account-one' }, 'game', { kind: 'browser' });
    expect(() =>
      sessions.issue({ kind: 'account', id: 'account-one' }, 'game', { parent: browser.record }),
    ).toThrow('Invalid session parent.');
    expect(() => sessions.issue({ kind: 'guest', id: 'guest-one' }, 'game', { kind: 'browser' })).toThrow(
      'Account session required.',
    );
    expect(sessions.validate(browser.token)?.kind).toBe('browser');
  });

  it('requires a live browser parent before opening a game tab', () => {
    const store = new InMemoryAccountStore();
    const sessions = new SessionService(store, authConfig);
    store.insertAccount(accountRecord());
    const browser = sessions.issue({ kind: 'account', id: 'account-one' }, 'game', { kind: 'browser' });
    store.deleteSession(browser.record.digest);
    expect(() =>
      sessions.issue({ kind: 'account', id: 'account-one' }, 'game', { kind: 'tab', parent: browser.record }),
    ).toThrow('Browser sign-in required.');
  });

  it('revokes a tab whose browser parent row disappeared', () => {
    const store = new InMemoryAccountStore();
    const sessions = new SessionService(store, authConfig);
    store.insertAccount(accountRecord());
    const browser = sessions.issue({ kind: 'account', id: 'account-one' }, 'game', { kind: 'browser' });
    const tab = sessions.issue({ kind: 'account', id: 'account-one' }, 'game', { kind: 'tab', parent: browser.record });
    expect(sessions.validate(tab.token)?.kind).toBe('tab');
    store.deleteSession(browser.record.digest);
    const revoked = vi.fn();
    sessions.onRevoke(revoked);
    expect(sessions.validateDigest(tab.record.digest)).toBeUndefined();
    expect(revoked).toHaveBeenCalledWith(expect.objectContaining({ digest: tab.record.digest }), 'expired');
    expect(store.findSession(tab.record.digest)).toBeUndefined();
  });

  it('prunes expired rows before checking capacity for a new session', () => {
    let now = 1_000;
    const store = new InMemoryAccountStore();
    const sessions = new SessionService(store, { ...authConfig, maxSessions: 10 }, () => now);
    const revoked = vi.fn();
    sessions.onRevoke(revoked);
    const expired = sessions.issue({ kind: 'guest', id: 'early' });
    now += authConfig.guestTtlMs + 1;
    const live = sessions.issue({ kind: 'guest', id: 'late' });
    expect(revoked).toHaveBeenCalledWith(expect.objectContaining({ digest: expired.record.digest }), 'expired');
    expect(store.findSession(expired.record.digest)).toBeUndefined();
    expect(store.findSession(live.record.digest)).toBeDefined();
  });
});

describe('password verification failure handling', () => {
  it('treats an unreadable stored digest as a failed verification instead of throwing', async () => {
    expect(await verifyPassword('not-an-argon2-digest', 'any-candidate-password')).toBe(false);
  });
});
