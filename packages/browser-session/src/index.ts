import { AuthErrorSchema, AuthResponseSchema, BrowserIdentitySchema, PlatformResponseSchema, RoomResumeResponseSchema, DeckValidationErrorSchema, PROTOCOL_VERSION, type BrowserIdentity, type AuthResponse, type PlatformInfo } from '@card-game/protocol';
export class PublicApiError extends Error { constructor(message: string, readonly status: number) { super(message); } }

/** No credential storage/bridge: the host-only HttpOnly cookie is managed by the browser. */
export class PublicSessionClient {
  private csrf: string | null = null;
  private generation = 0;
  private readRevision = 0;
  private identityRevision = 0;
  private identity?: BrowserIdentity;
  constructor(private readonly fetcher: typeof fetch = (...args) => fetch(...args)) {}
  invalidate(): void { this.generation++; this.csrf = null; this.identityRevision = ++this.readRevision; this.identity = { protocolVersion: PROTOCOL_VERSION, session: null, csrf: null }; }
  async request(path: string, options: { method?: string; body?: unknown; token?: string; signal?: AbortSignal; anonymous?: boolean } = {}): Promise<unknown> {
    if (!/^\/api\/(?:browser(?:\/|$)|decks(?:\/|\?|$)|cards(?:\?|$)|platform$)/.test(path) || /[\\\r\n]/.test(path)) throw new Error('Invalid public API destination.');
    const normalized = new URL(path, 'https://public.invalid');
    if (normalized.pathname + normalized.search !== path || /(?:^|\/)\.{1,2}(?:\/|$)/.test(path) || /%2e|%2f|%5c/i.test(path)) throw new Error('Invalid public API destination.');
    const method = options.method ?? 'GET', write = !['GET', 'HEAD'].includes(method);
    let csrf = this.csrf;
    if (write && !options.anonymous && !csrf) { const value = await this.me(options.signal); if (!value.session) throw new PublicApiError('Sign in to continue.', 401); csrf = value.csrf; }
    const response = await this.fetcher(path, { method, credentials: 'include', signal: options.signal,
      headers: { ...(write ? { 'Content-Type': 'application/json', 'X-Card-Game-Client': 'browser-v1' } : {}),
        ...(write && !options.anonymous && csrf ? { 'X-CSRF-Token': csrf } : {}), ...(options.token ? { Authorization: 'Bearer ' + options.token } : {}) },
      ...(write ? { body: JSON.stringify(options.body ?? { protocolVersion: PROTOCOL_VERSION }) } : {}),
    });
    if (response.status === 204) return null;
    let value: unknown;
    try { value = await response.json(); } catch { throw new PublicApiError('The server returned an incompatible response. Reload or retry.', response.status); }
    if (!response.ok) { const invalid = DeckValidationErrorSchema.safeParse(value), parsed = AuthErrorSchema.safeParse(value); throw new PublicApiError(invalid.success ? invalid.data.issues.map(issue => issue.message).join(' ') : parsed.success ? parsed.data.message : 'Request failed. Reload or retry.', response.status); }
    return value;
  }
  async me(signal?: AbortSignal): Promise<BrowserIdentity> {
    const generation = this.generation, revision = ++this.readRevision, parsed = BrowserIdentitySchema.safeParse(await this.request('/api/browser/me', { signal }));
    if (!parsed.success) throw new Error('The server returned an incompatible sign-in response.');
    if (generation !== this.generation) return this.identity ?? { protocolVersion: PROTOCOL_VERSION, session: null, csrf: null };
    if (revision === this.readRevision) { this.csrf = parsed.data.csrf; this.identity = parsed.data; this.identityRevision = revision; }
    else if (this.identity && this.identityRevision > revision) return this.identity;
    return parsed.data;
  }
  async authenticate(mode: 'login' | 'register', username: string, password: string): Promise<BrowserIdentity> {
    ++this.generation;
    const parsed = BrowserIdentitySchema.safeParse(await this.request('/api/browser/' + mode, { method: 'POST', anonymous: true, body: { protocolVersion: PROTOCOL_VERSION, username, password } }));
    if (!parsed.success || !parsed.data.session?.account || !parsed.data.csrf) throw new Error('The server returned an incompatible sign-in response.');
    this.csrf = parsed.data.csrf; this.identity = parsed.data; this.identityRevision = ++this.readRevision; return parsed.data;
  }
  async tab(prior?: AuthResponse | null, roomId?: string | null): Promise<AuthResponse> {
    return AuthResponseSchema.parse(await this.request('/api/browser/tab', { method: 'POST', token: prior?.token, body: { protocolVersion: PROTOCOL_VERSION, ...(roomId ? { roomId } : {}) } }));
  }
  async logout(all = false): Promise<void> {
    try { await this.request(all ? '/api/browser/logout-all' : '/api/browser/logout', { method: 'POST' }); }
    finally { this.invalidate(); }
  }
  async platform(signal?: AbortSignal): Promise<PlatformInfo> { return PlatformResponseSchema.parse(await this.request('/api/platform', { signal })); }
}
export const publicSession = new PublicSessionClient();

export async function verifyRoomResume(roomId: string, session: AuthResponse, signal?: AbortSignal, fetcher: typeof fetch = (...args) => fetch(...args)) {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(roomId)) throw new Error('Invalid room reference.');
  const response = await fetcher('/api/rooms/' + encodeURIComponent(roomId) + '/resume', { headers: { Authorization: 'Bearer ' + session.token }, signal });
  if (!response.ok) throw new Error('This room is unavailable for this game tab. Use the lobby or the original game tab.');
  let value: unknown; try { value = await response.json(); } catch { throw new Error('The server returned an incompatible room identity.'); }
  const parsed = RoomResumeResponseSchema.safeParse(value);
  if (!parsed.success || parsed.data.roomId !== roomId || parsed.data.sessionId !== session.sessionId) throw new Error('The server returned an incompatible room identity.');
  return parsed.data;
}

export type PublicRoute = { kind: 'home' | 'play' } | { kind: 'room'; roomId: string } | { kind: 'invalid' };
export function resolvePublicRoute(pathname: string): PublicRoute {
  if (pathname === '/home' || pathname === '/home/') return { kind: 'home' };
  if (['/', '/play', '/play/'].includes(pathname)) return { kind: 'play' };
  const match = /^\/play\/rooms\/([^/]+)\/?$/.exec(pathname);
  if (match) {
    try { const id = decodeURIComponent(match[1]); if (/^[A-Za-z0-9_-]{1,128}$/.test(id)) return { kind: 'room', roomId: id }; } catch { /* Invalid encoding. */ }
  }
  return { kind: 'invalid' };
}
/** Only this origin's known public pages can be a post-login return destination. */
export function safeReturnPath(value: string | null): string {
  if (!value || /[\\?#]/.test(value) || !value.startsWith('/') || value.startsWith('//')) return '/home';
  return resolvePublicRoute(value).kind !== 'invalid' || ['/deck-builder/', '/deck-builder'].includes(value) ? value : '/home';
}
