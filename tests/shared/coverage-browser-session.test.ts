import { describe, expect, it, vi } from 'vitest';
import {
  PublicApiError,
  PublicSessionClient,
  resolvePublicRoute,
  safeReturnPath,
  verifyRoomResume,
} from '@card-game/browser-session';
import type { AuthResponse } from '@card-game/protocol';

const csrf = 'c'.repeat(43);
const sessionInfo = {
  protocolVersion: 1 as const,
  sessionId: 'session-1',
  expiresAt: Date.now() + 60_000,
  playerId: 'player-1',
  scope: 'game' as const,
  account: { id: 'account-1', username: 'alice', role: 'player' as const },
};
const identity = { protocolVersion: 1 as const, session: sessionInfo, csrf };
const signedOut = { protocolVersion: 1 as const, session: null, csrf: null };
const auth: AuthResponse = { ...sessionInfo, token: 't'.repeat(43) };

type FetchCall = { input: string; init?: RequestInit };
function harness(handler: (input: string, init?: RequestInit) => Promise<Response> | Response) {
  const calls: FetchCall[] = [];
  const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ input: String(input), init });
    return handler(String(input), init);
  }) as typeof fetch;
  return { client: new PublicSessionClient(fetcher), calls, fetcher };
}

const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), {
  status,
  headers: { 'Content-Type': 'application/json' },
});

describe('PublicSessionClient destinations and responses', () => {
  it('refuses destinations outside the public API and path tricks without calling fetch', async () => {
    let calls = 0;
    const client = new PublicSessionClient((async () => { calls++; return json({}); }) as typeof fetch);
    for (const path of [
      '/api/admin/me',
      '/api/browser\\me',
      '/api/browser/me\r\nX-Bad: 1',
      '/api/browser/./me',
      '/api/browser/a/../me',
      '/api/browser/%2e%2e/me',
      '/api/browser/%2fme',
      '/api/decks%2f..',
    ]) {
      await expect(client.request(path)).rejects.toThrow('Invalid public API destination');
    }
    expect(calls).toBe(0);
  });

  it('returns null for 204 and attaches protocol headers only to writes', async () => {
    const { client, calls } = harness((_input, init) => {
      if (init?.method === 'POST') return new Response(null, { status: 204 });
      return json({ ok: true });
    });
    (client as unknown as { csrf: string }).csrf = csrf;
    expect(await client.request('/api/browser/me')).toEqual({ ok: true });
    expect(await client.request('/api/decks', { method: 'POST', body: { hello: 'world' } })).toBeNull();
    expect(calls[0].init?.headers).not.toHaveProperty('X-Card-Game-Client');
    expect(calls[1].init?.headers).toMatchObject({
      'Content-Type': 'application/json',
      'X-Card-Game-Client': 'browser-v1',
    });
    expect(calls[1].init?.body).toBe('{"hello":"world"}');
  });

  it('fetches a CSRF token before an authenticated write and includes bearer tokens', async () => {
    const { client, calls } = harness((input, init) => {
      if (input === '/api/browser/me') return json(identity);
      if (init?.method === 'POST') return json({ ok: true });
      return json({ ok: true });
    });
    await expect(client.request('/api/decks', { method: 'POST', body: {} })).resolves.toEqual({ ok: true });
    expect(calls[0].input).toBe('/api/browser/me');
    expect(calls[1].init?.headers).toMatchObject({
      'X-CSRF-Token': csrf,
      'X-Card-Game-Client': 'browser-v1',
    });
    await client.request('/api/decks', { token: 'token-value' });
    expect(calls[2].init?.headers).toMatchObject({ Authorization: 'Bearer token-value' });
    expect(calls[2].init?.body).toBeUndefined();
  });

  it('rejects a write when there is no browser session', async () => {
    const { client } = harness(input => input === '/api/browser/me' ? json(signedOut) : json({}));
    await expect(client.request('/api/decks', { method: 'POST', body: {} })).rejects.toMatchObject({
      status: 401,
      message: 'Sign in to continue.',
    });
  });

  it('reports incompatible JSON and each structured error family', async () => {
    const broken = harness(() => new Response('{', { status: 200 }));
    await expect(broken.client.request('/api/browser/me')).rejects.toThrow('incompatible response');
    await expect(broken.client.request('/api/browser/me')).rejects.toMatchObject({ status: 200 });

    const deckError = harness(() => json({
      protocolVersion: 1,
      message: 'Deck is invalid.',
      issues: [
        { code: 'size', message: 'Use 60 cards.' },
        { code: 'duplicate', cardId: 'land-red', message: 'Use one entry per card definition.' },
      ],
    }, 400));
    await expect(deckError.client.request('/api/decks')).rejects.toThrow('Use 60 cards. Use one entry per card definition.');

    const authError = harness(() => json({ protocolVersion: 1, message: 'Invalid username or password.' }, 401));
    await expect(authError.client.request('/api/browser/me')).rejects.toThrow('Invalid username or password.');

    const generic = harness(() => json({ nope: true }, 500));
    await expect(generic.client.request('/api/browser/me')).rejects.toThrow('Request failed. Reload or retry.');
    await expect(generic.client.request('/api/browser/me')).rejects.toBeInstanceOf(PublicApiError);
  });
});

describe('PublicSessionClient identity lifecycle', () => {
  it('rejects malformed sign-in identities', async () => {
    const client = new PublicSessionClient((async () => json({ protocolVersion: 1, session: null })) as typeof fetch);
    await expect(client.me()).rejects.toThrow('incompatible sign-in response');
  });

  it('caches the identity and CSRF token from a successful /me', async () => {
    const { client } = harness(() => json(identity));
    expect(await client.me()).toEqual(identity);
    expect((client as unknown as { csrf: string }).csrf).toBe(csrf);
  });

  it('does not let a generation invalidated response overwrite the signed-out identity', async () => {
    let release!: (response: Response) => void;
    const { client } = harness(() => new Promise<Response>(resolve => { release = resolve; }));
    const pending = client.me();
    client.invalidate();
    release(json(identity));
    expect(await pending).toEqual(signedOut);
  });

  it('handles a generation mismatch even before any identity was cached', async () => {
    let release!: (response: Response) => void;
    const { client } = harness(() => new Promise<Response>(resolve => { release = resolve; }));
    const pending = client.me();
    (client as unknown as { generation: number }).generation++;
    release(json(identity));
    expect(await pending).toEqual(signedOut);
  });

  it('keeps the newest identity when an older concurrent /me resolves last', async () => {
    const releases: ((response: Response) => void)[] = [];
    const { client } = harness(() => new Promise<Response>(resolve => { releases.push(resolve); }));
    const older = client.me();
    const newer = client.me();
    releases[1](json({ ...identity, session: { ...sessionInfo, sessionId: 'newer' } }));
    expect((await newer).session?.sessionId).toBe('newer');
    releases[0](json({ ...identity, session: { ...sessionInfo, sessionId: 'older' } }));
    expect((await older).session?.sessionId).toBe('newer');
  });

  it('returns the stale response when no newer identity has been committed yet', async () => {
    const releases: ((response: Response) => void)[] = [];
    const { client } = harness(() => new Promise<Response>(resolve => { releases.push(resolve); }));
    const first = client.me();
    const second = client.me();
    const third = client.me();
    releases[0](json({ ...identity, session: { ...sessionInfo, sessionId: 'first' } }));
    expect((await first).session?.sessionId).toBe('first');
    releases[1](json({ ...identity, session: { ...sessionInfo, sessionId: 'second' } }));
    expect((await second).session?.sessionId).toBe('second');
    releases[2](json({ ...identity, session: { ...sessionInfo, sessionId: 'third' } }));
    expect((await third).session?.sessionId).toBe('third');
  });

  it('authenticates anonymously and stores the returned browser identity', async () => {
    const { client, calls } = harness(() => json(identity));
    expect(await client.authenticate('register', 'alice', 'a long enough password')).toEqual(identity);
    expect(calls[0].input).toBe('/api/browser/register');
    expect(calls[0].init).toMatchObject({ method: 'POST' });
    expect(JSON.parse(String(calls[0].init?.body))).toMatchObject({
      protocolVersion: 1,
      username: 'alice',
      password: 'a long enough password',
    });
    expect((client as unknown as { csrf: string }).csrf).toBe(csrf);
  });

  it('rejects incomplete authentication responses', async () => {
    for (const response of [
      { protocolVersion: 1, session: null, csrf: null },
      { protocolVersion: 1, session: { ...sessionInfo, account: null }, csrf },
      { protocolVersion: 1, session: sessionInfo, csrf: null },
    ]) {
      const client = new PublicSessionClient((async () => json(response)) as typeof fetch);
      await expect(client.authenticate('login', 'alice', 'a long enough password'))
        .rejects.toThrow('incompatible sign-in response');
    }
  });

  it('exchanges a game tab, with an optional room and prior token', async () => {
    const { client, calls } = harness(input => input === '/api/browser/me' ? json(identity) : json(auth));
    expect(await client.tab()).toEqual(auth);
    await client.tab(auth, 'room-1');
    const tabCalls = calls.filter(call => call.input === '/api/browser/tab');
    expect(tabCalls[0].init?.headers).not.toHaveProperty('Authorization');
    expect(tabCalls[1].init?.headers).toMatchObject({ Authorization: 'Bearer ' + auth.token });
    expect(JSON.parse(String(tabCalls[1].init?.body))).toEqual({ protocolVersion: 1, roomId: 'room-1' });
  });

  it('invalidates local credentials even when logout fails', async () => {
    const client = new PublicSessionClient((async () => { throw new Error('offline'); }) as typeof fetch);
    await expect(client.logout()).rejects.toThrow('offline');
    expect((client as unknown as { csrf: string | null }).csrf).toBeNull();
    expect((client as unknown as { identity: unknown }).identity).toEqual(signedOut);
  });

  it('uses the global logout route and parses platform information', async () => {
    const platform = {
      protocolVersion: 1,
      navigation: {
        instanceId: 'dev', purpose: 'development', label: 'Development',
        home: '/home', play: '/play', decks: '/decks', admin: null, lab: null, extraPages: [],
      },
      capabilities: { scenarios: false },
    };
    const { client, calls } = harness(input => {
      if (input === '/api/browser/me') return json(identity);
      if (input === '/api/platform') return json(platform);
      return new Response(null, { status: 204 });
    });
    await client.logout(true);
    expect(calls.map(call => call.input)).toContain('/api/browser/logout-all');
    expect(await client.platform()).toEqual(platform);
  });
});

describe('room resume verification', () => {
  it('rejects malformed room references before any request', async () => {
    const fetcher = vi.fn() as unknown as typeof fetch;
    await expect(verifyRoomResume('../room', auth, undefined, fetcher)).rejects.toThrow('Invalid room reference');
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('reports an unavailable room', async () => {
    const fetcher = (async () => json({ message: 'no' }, 404)) as typeof fetch;
    await expect(verifyRoomResume('room-1', auth, undefined, fetcher)).rejects.toThrow('unavailable');
  });

  it('reports incompatible JSON and mismatched identities', async () => {
    const badJson = (async () => new Response('{', { status: 200 })) as typeof fetch;
    await expect(verifyRoomResume('room-1', auth, undefined, badJson)).rejects.toThrow('incompatible room identity');

    const mismatchRoom = (async () => json({ protocolVersion: 1, sessionId: auth.sessionId, roomId: 'other', playerId: 'p' })) as typeof fetch;
    await expect(verifyRoomResume('room-1', auth, undefined, mismatchRoom)).rejects.toThrow('incompatible room identity');

    const mismatchSession = (async () => json({ protocolVersion: 1, sessionId: 'other', roomId: 'room-1', playerId: 'p' })) as typeof fetch;
    await expect(verifyRoomResume('room-1', auth, undefined, mismatchSession)).rejects.toThrow('incompatible room identity');
  });

  it('returns the verified resume payload', async () => {
    let captured: { url: string; init?: RequestInit } | undefined;
    const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
      captured = { url: String(input), init };
      return json({ protocolVersion: 1, sessionId: auth.sessionId, roomId: 'room-1', playerId: 'player-1' });
    }) as typeof fetch;
    await expect(verifyRoomResume('room-1', auth, undefined, fetcher)).resolves.toMatchObject({ roomId: 'room-1' });
    expect(captured?.url).toBe('/api/rooms/room-1/resume');
    expect(captured?.init?.headers).toMatchObject({ Authorization: 'Bearer ' + auth.token });
  });
});

describe('default network bindings', () => {
  it('uses the global fetch for the session client and room verification', async () => {
    const calls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      calls.push(String(input));
      return json({ protocolVersion: 1, sessionId: auth.sessionId, roomId: 'room-1', playerId: 'player-1' });
    }));
    try {
      const client = new PublicSessionClient();
      await expect(client.request('/api/browser/me')).resolves.toMatchObject({ protocolVersion: 1 });
      await expect(verifyRoomResume('room-1', auth)).resolves.toMatchObject({ roomId: 'room-1' });
      expect(calls).toEqual(['/api/browser/me', '/api/rooms/room-1/resume']);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('public navigation helpers', () => {  it('resolves every public route shape', () => {
    expect(resolvePublicRoute('/home')).toEqual({ kind: 'home' });
    expect(resolvePublicRoute('/home/')).toEqual({ kind: 'home' });
    expect(resolvePublicRoute('/')).toEqual({ kind: 'play' });
    expect(resolvePublicRoute('/play')).toEqual({ kind: 'play' });
    expect(resolvePublicRoute('/play/')).toEqual({ kind: 'play' });
    expect(resolvePublicRoute('/play/rooms/abc_123')).toEqual({ kind: 'room', roomId: 'abc_123' });
    expect(resolvePublicRoute('/play/rooms/abc_123/')).toEqual({ kind: 'room', roomId: 'abc_123' });
    expect(resolvePublicRoute('/play/rooms/%61bc')).toEqual({ kind: 'room', roomId: 'abc' });
    expect(resolvePublicRoute('/play/rooms/%E0%A4%A')).toEqual({ kind: 'invalid' });
    expect(resolvePublicRoute('/play/rooms/..')).toEqual({ kind: 'invalid' });
    expect(resolvePublicRoute('/unknown')).toEqual({ kind: 'invalid' });
  });

  it('only returns same-origin known destinations from a return path', () => {
    expect(safeReturnPath(null)).toBe('/home');
    expect(safeReturnPath('https://evil.example/')).toBe('/home');
    expect(safeReturnPath('//evil.example/')).toBe('/home');
    expect(safeReturnPath('/home?x=1')).toBe('/home');
    expect(safeReturnPath('/home#x')).toBe('/home');
    expect(safeReturnPath('/home\\x')).toBe('/home');
    expect(safeReturnPath('/unknown')).toBe('/home');
    expect(safeReturnPath('/deck-builder')).toBe('/deck-builder');
    expect(safeReturnPath('/deck-builder/')).toBe('/deck-builder/');
    expect(safeReturnPath('/play/rooms/room-1')).toBe('/play/rooms/room-1');
    expect(safeReturnPath('/')).toBe('/');
  });
});
