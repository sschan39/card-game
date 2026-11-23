import { createHmac, timingSafeEqual } from 'node:crypto';
import { Router, type Request, type Response, type RequestHandler } from 'express';
import { PROTOCOL_VERSION, RegisterRequestSchema, LoginRequestSchema, LogoutRequestSchema, BrowserIdentitySchema, BrowserTabRequestSchema, AuthResponseSchema, registrationPasswordError } from '@card-game/protocol';
import type { AuthService } from './service';
import type { ServerConfig } from '../config';
import { AuthError, AuthorityLogoutUnconfirmed } from './errors';
import { bearerToken } from './routes';
import { createPasswordLimiter } from './password-rate-limit';

export function browserCookieName(config: ServerConfig): string { return (config.profile === 'production' ? '__Host-' : '') + 'cardgame-' + config.navigation.instanceId; }
export function browserToken(request: Request, config: ServerConfig): string | undefined {
  const name = browserCookieName(config), values = (request.headers.cookie ?? '').split(';').map(value => value.trim()).filter(value => value.startsWith(name + '='));
  if (values.length !== 1) return;
  const token = values[0].slice(name.length + 1); return /^[A-Za-z0-9_-]{43}$/.test(token) ? token : undefined;
}
const csrfFor = (token: string) => createHmac('sha256', token).update('card-game/browser-csrf/v1').digest('base64url');
export function browserSession(auth: AuthService, request: Request, config: ServerConfig) {
  const session = auth.sessions.validate(browserToken(request, config));
  if (!session || session.kind !== 'browser' || session.scope !== 'game' || session.subject.kind !== 'account') throw new AuthError(401, 'Browser sign-in required.');
  return session;
}
export function browserWrite(request: Request, config: ServerConfig, token?: string): void {
  if (!request.headers.origin || !config.origins.includes(request.headers.origin) || request.headers['x-card-game-client'] !== 'browser-v1' || !request.is('application/json')) throw new AuthError(403, 'This browser request is not allowed.');
  if (token) {
    const actual = request.headers['x-csrf-token'], expected = csrfFor(token);
    if (typeof actual !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(actual) || !timingSafeEqual(Buffer.from(actual), Buffer.from(expected))) throw new AuthError(403, 'Refresh sign-in before retrying.');
  }
}
export function createBrowserRouter(auth: AuthService, config: ServerConfig, limited: RequestHandler = createPasswordLimiter(config.auth)): Router {
  const router = Router();
  const identity = async (request: Request) => {
    const token = browserToken(request, config), session = token ? auth.sessions.validate(token) : undefined;
    let browser = session?.kind === 'browser' && session.subject.kind === 'account' ? session : undefined;
    let labOperator = false;
    let authorityUnavailable = false;
    if (browser && auth.authority) {
      try { labOperator = (await auth.authorize(browser))?.rights.includes('lab.operate') === true; }
      catch (error) {
        if (!(error instanceof AuthError)) throw error;
        if (error.status === 401) browser = undefined;
        else if (error.status === 503) {
          browser = auth.sessions.validateDigest(browser.digest);
          authorityUnavailable = !!browser;
        } else throw error;
      }
    }
    const hasRoom = browser?.subject.kind === 'account' && auth.accountHasRoom(browser.subject.id);
    return BrowserIdentitySchema.parse({ protocolVersion: PROTOCOL_VERSION, session: browser ? auth.info(browser) : null,
      csrf: browser ? csrfFor(token!) : null, ...(hasRoom ? { accountHasRoom: true } : {}), ...(labOperator ? { labOperator: true } : {}),
      ...(authorityUnavailable ? { authorityUnavailable: true } : {}) });
  };
  const cookie = (response: Response, value: string, expiresAt: number) => response.cookie(browserCookieName(config), value, { httpOnly: true, sameSite: 'strict', secure: config.profile === 'production', path: '/', expires: new Date(expiresAt) });
  router.get('/me', (request, response, next) => { void identity(request).then(value => response.json(value)).catch(next); });
  for (const mode of ['login', 'register'] as const) router.post('/' + mode, limited, (request, response, next) => {
    try {
      browserWrite(request, config);
      if (mode === 'register' && typeof request.body?.password === 'string') {
        const issue = registrationPasswordError(request.body.password);
        if (issue) throw new AuthError(400, issue);
      }
      const parsed = (mode === 'login' ? LoginRequestSchema : RegisterRequestSchema).safeParse(request.body);
      if (!parsed.success || 'scope' in parsed.data && parsed.data.scope !== 'game' || parsed.data.roomId !== undefined) throw new AuthError(400, mode === 'register' ? 'Check your username and password to create an account.' : 'Invalid public sign-in request.');
      void auth[mode](parsed.data, browserToken(request, config), true).then(value => {
        cookie(response, value.token, value.expiresAt);
        response.status(mode === 'register' ? 201 : 200).json(BrowserIdentitySchema.parse({ protocolVersion: PROTOCOL_VERSION, session: auth.info(auth.sessions.validate(value.token)!), csrf: csrfFor(value.token) }));
      }).catch(next);
    } catch (error) { next(error); }
  });
  router.post('/tab', async (request, response, next) => {
    try {
      const parent = browserSession(auth, request, config); browserWrite(request, config, browserToken(request, config));
      const parsed = BrowserTabRequestSchema.safeParse(request.body); if (!parsed.success) throw new AuthError(400, 'Invalid game-tab request.');
      await auth.authorize(parent);
      response.json(AuthResponseSchema.parse(auth.gameTab(parent, bearerToken(request), parsed.data.roomId)));
    } catch (error) { next(error); }
  });
  for (const all of [false, true]) router.post(all ? '/logout-all' : '/logout', async (request, response, next) => {
    try {
      browserSession(auth, request, config);
      const token = browserToken(request, config);
      browserWrite(request, config, token);
      if (!LogoutRequestSchema.safeParse(request.body).success) throw new AuthError(400, 'Invalid sign-out request.');
      await auth.logoutAuthenticated(token, all, true);
      cookie(response, '', 0); response.json({ protocolVersion: PROTOCOL_VERSION, ok: true });
    } catch (error) {
      if (error instanceof AuthorityLogoutUnconfirmed) cookie(response, '', 0);
      next(error);
    }
  });
  return router;
}
