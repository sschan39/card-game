import { createHmac, timingSafeEqual } from 'node:crypto';
import { Router, type Request, type Response, type RequestHandler } from 'express';
import { PROTOCOL_VERSION, RegisterRequestSchema, LoginRequestSchema, LogoutRequestSchema, BrowserIdentitySchema, BrowserTabRequestSchema, AuthResponseSchema } from '@card-game/protocol';
import type { AuthService } from './service';
import type { ServerConfig } from '../config';
import { AuthError } from './errors';
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
  const identity = (request: Request) => {
    const token = browserToken(request, config), session = token ? auth.sessions.validate(token) : undefined;
    return BrowserIdentitySchema.parse({ protocolVersion: PROTOCOL_VERSION, session: session?.kind === 'browser' && session.subject.kind === 'account' ? auth.info(session) : null, csrf: session?.kind === 'browser' ? csrfFor(token!) : null });
  };
  const cookie = (response: Response, value: string, expiresAt: number) => response.cookie(browserCookieName(config), value, { httpOnly: true, sameSite: 'strict', secure: config.profile === 'production', path: '/', expires: new Date(expiresAt) });
  router.get('/me', (request, response) => response.json(identity(request)));
  for (const mode of ['login', 'register'] as const) router.post('/' + mode, limited, (request, response, next) => {
    try {
      browserWrite(request, config);
      const parsed = (mode === 'login' ? LoginRequestSchema : RegisterRequestSchema).safeParse(request.body);
      if (!parsed.success || 'scope' in parsed.data && parsed.data.scope !== 'game' || parsed.data.roomId !== undefined) throw new AuthError(400, 'Invalid public sign-in request.');
      void auth[mode](parsed.data, browserToken(request, config), true).then(value => {
        cookie(response, value.token, value.expiresAt);
        response.status(mode === 'register' ? 201 : 200).json(BrowserIdentitySchema.parse({ protocolVersion: PROTOCOL_VERSION, session: auth.info(auth.sessions.validate(value.token)!), csrf: csrfFor(value.token) }));
      }).catch(next);
    } catch (error) { next(error); }
  });
  router.post('/tab', (request, response, next) => {
    try {
      const parent = browserSession(auth, request, config); browserWrite(request, config, browserToken(request, config));
      const parsed = BrowserTabRequestSchema.safeParse(request.body); if (!parsed.success) throw new AuthError(400, 'Invalid game-tab request.');
      response.json(AuthResponseSchema.parse(auth.gameTab(parent, bearerToken(request), parsed.data.roomId)));
    } catch (error) { next(error); }
  });
  for (const all of [false, true]) router.post(all ? '/logout-all' : '/logout', (request, response, next) => {
    try {
      const parent = browserSession(auth, request, config); browserWrite(request, config, browserToken(request, config));
      if (!LogoutRequestSchema.safeParse(request.body).success) throw new AuthError(400, 'Invalid sign-out request.');
      if (all) auth.logoutAll(browserToken(request, config), true); else auth.logout(browserToken(request, config));
      cookie(response, '', 0); response.json({ protocolVersion: PROTOCOL_VERSION, ok: true });
    } catch (error) { next(error); }
  });
  return router;
}
