import { describe, expect, it, vi } from 'vitest';
import { AccountsAuthority, loadAccountsAuthority } from '@server/auth/accounts-authority';

const projectId = '3c209c39-138e-4024-8845-c4180acf9e3a';
const account = { id: '64934bef-d344-4afa-8495-7e9adf3a07e9', username: 'tester', role: 'tester', disabled: false };
const key = 'a4_' + '1'.repeat(32) + '.' + 'k'.repeat(43);
const session = 'a4s_' + '2'.repeat(32) + '.' + 's'.repeat(43);
const identity = { account, rights: ['lab.operate', 'play'], expires_at: '2027-01-01T00:00:00Z', idle_expires_at: '2026-12-31T23:30:00Z' };
const settings = { origin: 'https://identity.example', projectId, credential: key };
const response = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status });

describe('game-owned account API adapter', () => {
  it('keeps machine credentials and user sessions server-side, with bounded requests and no redirects', async () => {
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(response({ id: projectId, slug: 'game', status: 'active' }))
      .mockResolvedValueOnce(response({ session, ...identity }, 201))
      .mockResolvedValueOnce(response(identity));
    const authority = new AccountsAuthority(settings, fetcher);
    const result = await authority.signIn('tester', 'synthetic-password');
    expect(result).toMatchObject({ account, session, rights: ['lab.operate', 'play'] });
    expect(await authority.verify(session)).toMatchObject({ account });
    expect(fetcher.mock.calls[0]?.[0]).toBe(`https://identity.example/v1/projects/${projectId}`);
    expect(fetcher.mock.calls[1]?.[1]).toMatchObject({
      redirect: 'error',
      headers: { Authorization: `Bearer ${key}` },
      body: JSON.stringify({ username: 'tester', password: 'synthetic-password' }),
    });
    expect(fetcher.mock.calls[1]?.[1]?.signal).toBeInstanceOf(AbortSignal);
    expect(fetcher.mock.calls[2]?.[1]).toMatchObject({ headers: { 'X-Accounts-Session': session } });
  });

  it('uses the same signup key for retries and rejects an unapproved project', async () => {
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(response({ id: projectId, slug: 'game', status: 'active' }))
      .mockImplementation(async () => response({ ...account, role: 'user' }, 201));
    const authority = new AccountsAuthority(settings, fetcher);
    await authority.register('tester', 'synthetic-password');
    await authority.register('tester', 'synthetic-password');
    const header = (call: number) => new Headers(fetcher.mock.calls[call]?.[1]?.headers).get('Idempotency-Key');
    expect(header(1)).toMatch(/^[a-f0-9-]{36}$/);
    expect(header(1)).toBe(header(2));

    const foreign = vi.fn<typeof fetch>().mockResolvedValue(response({ id: account.id, slug: 'other', status: 'active' }));
    await expect(new AccountsAuthority(settings, foreign).verify(session)).rejects.toMatchObject({ status: 503 });
    expect(foreign).toHaveBeenCalledTimes(1);
  });

  it('distinguishes rejection from outage and rejects untrusted payloads', async () => {
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(response({ id: projectId, slug: 'game', status: 'active' }))
      .mockResolvedValueOnce(response({ code: 'invalid_session' }, 401))
      .mockRejectedValueOnce(new Error(key))
      .mockResolvedValueOnce(response({ ...identity, account: { ...account, role: 'owner' } }));
    const authority = new AccountsAuthority(settings, fetcher);
    await expect(authority.verify(session)).rejects.toMatchObject({ status: 401 });
    await expect(authority.verify(session)).rejects.toMatchObject({ status: 503, message: 'Account service unavailable. Try again shortly.' });
    await expect(authority.verify(session)).rejects.toMatchObject({ status: 503 });
  });

  it('separates a project permission failure from an intentional signup policy', async () => {
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(response({ id: projectId, status: 'active' }))
      .mockResolvedValueOnce(response({ code: 'forbidden' }, 403))
      .mockResolvedValueOnce(response({ code: 'project_forbidden' }, 403))
      .mockResolvedValueOnce(response({ code: 'forbidden' }, 403))
      .mockResolvedValueOnce(response({ code: 'invalid_session' }, 401));
    const authority = new AccountsAuthority(settings, fetcher);
    await expect(authority.verify(session)).rejects.toMatchObject({ status: 503 });
    await expect(authority.register('tester', 'synthetic-password')).rejects.toMatchObject({ status: 503 });
    await expect(authority.register('tester', 'synthetic-password')).rejects.toMatchObject({ status: 403 });
    await expect(authority.verify(session)).rejects.toMatchObject({ status: 401 });
  });

  it('rejects a wrong project at startup and retries a temporary outage', async () => {
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(response({}, 404))
      .mockResolvedValueOnce(response({}, 503))
      .mockResolvedValueOnce(response({ id: projectId, status: 'active' }));
    const confirmed = vi.fn();
    const authority = new AccountsAuthority(settings, fetcher, Date.now, confirmed);
    await expect(authority.probeProject()).rejects.toThrow('4A rejected the configured project');
    await expect(authority.probeProject()).rejects.toMatchObject({ status: 503 });
    expect(confirmed).not.toHaveBeenCalled();
    await expect(authority.probeProject()).resolves.toBeUndefined();
    expect(confirmed).toHaveBeenCalledExactlyOnceWith(projectId);
  });

  it('backs off after five failures and allows only one recovery check', async () => {
    let now = 1000;
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(response({ id: projectId, status: 'active' }))
      .mockImplementation(async () => response({}, 503));
    const authority = new AccountsAuthority(settings, fetcher, () => now);
    for (let failure = 0; failure < 6; failure++)
      await expect(authority.verify(session)).rejects.toMatchObject({ status: 503 });
    expect(fetcher).toHaveBeenCalledTimes(6);
    now += 30_000;
    let recover!: (value: Response) => void;
    fetcher.mockImplementationOnce(() => new Promise(resolve => { recover = resolve; }));
    const first = authority.verify(session);
    await expect(authority.verify(session)).rejects.toMatchObject({ status: 503 });
    recover(response(identity));
    await expect(first).resolves.toMatchObject({ account });
    expect(fetcher).toHaveBeenCalledTimes(7);
    fetcher.mockResolvedValueOnce(response(identity));
    await expect(authority.verify(session)).resolves.toMatchObject({ account });
  });

  it('treats missing configuration separately from invalid configuration', () => {
    expect(loadAccountsAuthority({}, 'development')).toBeUndefined();
    const env = { ACCOUNTS_URL: 'http://127.0.0.1:8087', ACCOUNTS_PROJECT_ID: projectId, ACCOUNTS_PROJECT_KEY: key };
    expect(loadAccountsAuthority(env, 'development')).toBeInstanceOf(AccountsAuthority);
    expect(() => loadAccountsAuthority(env, 'production')).toThrow('HTTPS');
    expect(() => loadAccountsAuthority({ ACCOUNTS_URL: env.ACCOUNTS_URL }, 'test')).toThrow('ACCOUNTS_');
    expect(() => loadAccountsAuthority({ ...env, ACCOUNTS_URL: 'https://identity.example/other' }, 'test')).toThrow('origin');
  });
});
