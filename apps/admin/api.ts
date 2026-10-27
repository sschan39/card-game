import { PROTOCOL_VERSION, AuthErrorSchema, type AuthResponse } from '@card-game/protocol';
import { validAdminSession } from './session';

interface Schema<T> { safeParse(input: unknown): { success: true; data: T } | { success: false } }
export class AdminApi {
  constructor(private readonly session: () => AuthResponse | null, private readonly ended: () => void, private readonly fetcher: typeof fetch = fetch, private readonly now = Date.now) {}
  private async failure(response: Response, expectedSessionId?: string): Promise<Error> {
    if (response.status === 401 && expectedSessionId && this.session()?.sessionId === expectedSessionId) this.ended();
    try { const parsed = AuthErrorSchema.safeParse(await response.json()); if (parsed.success) return new Error(parsed.data.message); } catch {}
    return new Error(response.status === 401 ? 'Your admin session ended. Sign in again.' : 'The request could not be completed.');
  }
  async login(username: string, password: string): Promise<AuthResponse> {
    const response = await this.fetcher('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ protocolVersion: PROTOCOL_VERSION, username, password, scope: 'admin' }) });
    if (!response.ok) throw await this.failure(response);
    const result = validAdminSession(await response.json(), this.now());
    if (!result) throw new Error('An administrator session is required.'); return result;
  }
  async get<T>(path: string, schema: Schema<T>, signal?: AbortSignal): Promise<T> { return this.request(path, schema, { signal }); }
  async post<T>(path: string, schema: Schema<T>, body: unknown): Promise<T> { return this.request(path, schema, { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } }); }
  private async request<T>(path: string, schema: Schema<T>, options: RequestInit): Promise<T> {
    if (!path.startsWith('/api/admin/')) throw new Error('Invalid administrator request destination.');
    const current = validAdminSession(this.session(), this.now());
    if (!current) { this.ended(); throw new Error('Your admin session ended. Sign in again.'); }
    const response = await this.fetcher(path, { ...options, headers: { ...options.headers, Authorization: 'Bearer ' + current.token } });
    if (!response.ok) throw await this.failure(response, current.sessionId);
    const parsed = schema.safeParse(await response.json());
    if (!parsed.success) throw new Error('The server returned an incompatible admin response.'); return parsed.data;
  }
  async logout(): Promise<void> {
    const current = validAdminSession(this.session(), this.now());
    try { if (current) await this.fetcher('/api/auth/logout', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + current.token }, body: JSON.stringify({ protocolVersion: PROTOCOL_VERSION }) }); }
    finally { if (!current || this.session()?.sessionId === current.sessionId) this.ended(); }
  }
}
