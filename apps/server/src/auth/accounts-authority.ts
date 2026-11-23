import { createHash } from 'node:crypto';
import { z } from 'zod';
import { serverLogger } from '@card-game/engine/shared/game-logger';
import { ConfigurationError } from '../config';
import { AuthError } from './errors';

export interface AccountsAuthoritySettings {
  origin: string;
  projectId: string;
  credential: string;
}

const id = z.string().uuid();
const account = z.object({
  id,
  username: z.string().regex(/^[a-z0-9][a-z0-9_.-]{2,63}$/),
  role: z.enum(['user', 'tester', 'admin']),
  disabled: z.boolean(),
});
const remoteSession = z.string().regex(/^a4s_[a-f0-9]{32}\.[A-Za-z0-9_-]{43}$/);
const expiry = z.string().datetime({ offset: true }).transform(Date.parse);
const sessionView = z.object({
  account,
  rights: z.array(z.string().min(1).max(64)).max(32),
  expires_at: expiry,
  idle_expires_at: expiry,
});
const signedIn = sessionView.extend({ session: remoteSession });
const project = z.object({ id, status: z.literal('active') });
const errorCode = z.object({ code: z.string().optional() }).catch({});
const unavailable = () => new AuthError(503, 'Account service unavailable. Try again shortly.');
const misconfiguredProject = () => new ConfigurationError('4A rejected the configured project or server credential.');
const BREAKER_FAILURE_LIMIT = 5;
const BREAKER_COOLDOWN_MS = 30_000;

export type AuthorityAccount = z.infer<typeof account>;
export type AuthoritySessionView = z.infer<typeof sessionView>;

export function loadAccountsAuthority(environment: NodeJS.ProcessEnv, profile: string, fetcher?: typeof fetch,
  onProjectVerified?: (projectId: string) => void): AccountsAuthority | undefined {
  const { ACCOUNTS_URL: origin, ACCOUNTS_PROJECT_ID: projectId, ACCOUNTS_PROJECT_KEY: credential } = environment;
  if ([origin, projectId, credential].every(value => value === undefined)) return;
  if (!origin || !id.safeParse(projectId).success || !credential || !/^a4_[a-f0-9]{32}\.[A-Za-z0-9_-]{43}$/.test(credential))
    throw new ConfigurationError('Set all ACCOUNTS_ settings with a project UUID and server credential.');
  let url: URL;
  try { url = new URL(origin); } catch { throw new ConfigurationError('ACCOUNTS_URL must be an origin.'); }
  if (url.origin !== origin || url.username || url.password)
    throw new ConfigurationError('ACCOUNTS_URL must be an origin without a path or credentials.');
  const local = profile !== 'production' && url.protocol === 'http:' &&
    ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.protocol !== 'https:' && !local) throw new ConfigurationError('ACCOUNTS_URL must use HTTPS.');
  return new AccountsAuthority({ origin, projectId: projectId!.toLowerCase(), credential }, fetcher, Date.now, onProjectVerified);
}

/** Only this transport boundary handles remotely issued secrets or wire-format identity data. */
export class AccountsAuthority {
  private projectCheck?: Promise<void>;
  private consecutiveFailures = 0;
  private openUntil = 0;
  private generation = 0;
  private probing = false;
  constructor(private readonly config: AccountsAuthoritySettings, private readonly fetcher: typeof fetch = fetch,
    private readonly now = Date.now, private readonly onProjectVerified?: (projectId: string) => void) {}

  get projectId(): string { return this.config.projectId; }

  async register(username: string, password: string): Promise<AuthorityAccount> {
    await this.requireProject();
    // Stable for retry across browser reloads or game process restarts. The provider
    // still compares the username and password before replaying an existing signup.
    const hash = createHash('sha256').update(`signup:${this.projectId}:${username}`).digest('hex');
    const key = `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-8${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
    return this.request('/v1/accounts', account.extend({ role: z.literal('user') }), {
      body: { username, password }, idempotencyKey: key, userCanBeDenied: true,
    });
  }

  async signIn(username: string, password: string) {
    await this.requireProject();
    return this.request('/v1/sessions', signedIn, { body: { username, password } });
  }

  async verify(session: string): Promise<AuthoritySessionView> {
    await this.requireProject();
    return this.request('/v1/sessions/verify', sessionView, { session });
  }

  async activity(session: string, kind: 'player_command' | 'board_edit'): Promise<AuthoritySessionView> {
    await this.requireProject();
    return this.request('/v1/sessions/activity', sessionView, { session, body: { kind }, userCanBeDenied: true });
  }

  async logout(session: string): Promise<void> {
    await this.requireProject();
    await this.request('/v1/sessions/logout', z.undefined(), { session });
  }

  probeProject(): Promise<void> {
    this.projectCheck ??= this.request(`/v1/projects/${this.projectId}`, project).then(result => {
      if (result.id !== this.projectId) throw misconfiguredProject();
      this.onProjectVerified?.(result.id);
    }).catch(error => {
      this.projectCheck = undefined;
      throw error;
    });
    return this.projectCheck;
  }

  private async requireProject(): Promise<void> {
    try { await this.probeProject(); }
    catch (error) { if (error instanceof ConfigurationError) throw unavailable(); throw error; }
  }

  private async request<T>(
    path: string, schema: z.ZodType<T>,
    options?: { body?: object; session?: string; idempotencyKey?: string; userCanBeDenied?: true },
  ): Promise<T> {
    const recovery = this.openUntil !== 0;
    if (recovery && (this.now() < this.openUntil || this.probing)) throw unavailable();
    if (recovery) this.probing = true;
    const generation = this.generation;
    let response: Response;
    let payload: unknown;
    let code: string | undefined;
    try {
      response = await this.fetcher(this.config.origin + path, {
        method: options ? 'POST' : 'GET', redirect: 'error', signal: AbortSignal.timeout(2000),
        headers: {
          Authorization: `Bearer ${this.config.credential}`,
          Accept: 'application/json',
          ...(options?.session ? { 'X-Accounts-Session': options.session } : {}),
          ...(options?.idempotencyKey ? { 'Idempotency-Key': options.idempotencyKey } : {}),
          ...(options?.body ? { 'Content-Type': 'application/json' } : {}),
        },
        ...(options?.body ? { body: JSON.stringify(options.body) } : {}),
      });
      if (response.status >= 500) throw unavailable();
      const projectProbeRejected = !options && [401, 403, 404].includes(response.status);
      if (response.status !== 204 && !projectProbeRejected) payload = await response.json();
      if (!response.ok) code = errorCode.parse(payload).code;
      const userUnauthorized = path === '/v1/sessions' && code === 'invalid_credentials' ||
        !!options?.session && code === 'invalid_session';
      if (options && (response.status === 401 && !userUnauthorized ||
          response.status === 403 && (code === 'project_forbidden' || !options.userCanBeDenied))) {
        if (this.consecutiveFailures === 0)
          serverLogger.warn('auth:project:rejected', '4A rejected the game server credential or its permissions', { path });
        throw unavailable();
      }
      if (generation === this.generation) {
        this.consecutiveFailures = 0;
        this.openUntil = 0;
      }
    } catch {
      if (generation === this.generation && (recovery || ++this.consecutiveFailures >= BREAKER_FAILURE_LIMIT)) {
        this.generation++;
        this.openUntil = this.now() + BREAKER_COOLDOWN_MS;
      }
      throw unavailable();
    } finally {
      if (recovery) this.probing = false;
    }
    if (!options && [401, 403, 404].includes(response.status)) throw misconfiguredProject();
    if (!response.ok) {
      if (response.status === 401 && (code === 'invalid_credentials' || code === 'invalid_session'))
        throw new AuthError(401, code === 'invalid_session' ? 'Sign in again.' : 'Invalid username or password.');
      if (response.status === 403 && code === 'forbidden') throw new AuthError(403, 'Account operation is not allowed.');
      if (response.status === 400) throw new AuthError(400, 'Check your account details and password.');
      if (response.status === 409) throw new AuthError(409, 'Username or signup request is unavailable.');
      if (response.status === 429) throw new AuthError(429, 'Too many attempts. Try again shortly.');
      throw unavailable();
    }
    const parsed = schema.safeParse(payload);
    if (!parsed.success) throw unavailable();
    return parsed.data;
  }
}
