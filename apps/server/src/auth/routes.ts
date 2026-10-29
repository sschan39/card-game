import { Router, type Request, type RequestHandler } from 'express';
import { rateLimit } from 'express-rate-limit';
import { PROTOCOL_VERSION, RegisterRequestSchema, LoginRequestSchema, LogoutRequestSchema, GuestRequestSchema, AuthResponseSchema, SessionInfoSchema, LogoutResponseSchema } from '@card-game/protocol';
import type { AuthConfig } from '../config';
import type { AuthService } from './service';
import { AuthError } from './errors';
import { createPasswordLimiter } from './password-rate-limit';

export function bearerToken(request: Pick<Request, 'headers'>): string | undefined {
  const authorization = request.headers.authorization;
  return typeof authorization === 'string' && /^Bearer [A-Za-z0-9_-]{43}$/i.test(authorization) ? authorization.slice(7) : undefined;
}
export function requireSession(auth: AuthService, request: Request) {
  const session = auth.sessions.validate(bearerToken(request));
  if (!session) throw new AuthError(401, 'Authentication required.');
  if (session.kind === 'browser') throw new AuthError(403, 'Use the browser-session interface.');
  return session;
}
export function inspectorIdentity(auth: AuthService, request: Request) {
  const session = auth.sessions.validate(bearerToken(request));
  const account = session?.scope === 'admin' && session.subject.kind === 'account' ? auth.repository.findAccount(session.subject.id) : undefined;
  return account && !account.disabled ? { accountId: account.id, roles: [account.role] } : null;
}
export function createAuthRouter(auth: AuthService, config: AuthConfig, limited: RequestHandler = createPasswordLimiter(config)): Router {
  const router = Router();
  router.use((_request, response, next) => { response.setHeader('Cache-Control', 'no-store'); next(); });
  const guests = rateLimit({ ...config.guestRateLimit, standardHeaders: 'draft-8', legacyHeaders: false,
    handler: (_request, response) => response.status(429).json({ protocolVersion: PROTOCOL_VERSION, message: 'Too many guest sessions. Try again later.' }) });
  router.post('/guest', guests, (request, response, next) => {
    if (!GuestRequestSchema.safeParse(request.body).success) { next(new AuthError(400, 'Invalid guest request.')); return; }
    try { response.status(201).json(AuthResponseSchema.parse(auth.guest())); } catch (error) { next(error); }
  });
  router.post('/register', limited, (request, response, next) => {
    const parsed = RegisterRequestSchema.safeParse(request.body);
    if (!parsed.success) { next(new AuthError(400, 'Invalid registration. Use a 3–32 character username and a 15–128 character password.')); return; }
    void auth.register(parsed.data, bearerToken(request)).then(value => response.status(201).json(AuthResponseSchema.parse(value))).catch(next);
  });
  router.post('/login', limited, (request, response, next) => {
    const parsed = LoginRequestSchema.safeParse(request.body);
    if (!parsed.success) { next(new AuthError(400, 'Invalid login request.')); return; }
    void auth.login(parsed.data, bearerToken(request)).then(value => response.json(AuthResponseSchema.parse(value))).catch(next);
  });
  router.post('/logout', (request, response, next) => {
    if (!LogoutRequestSchema.safeParse(request.body).success) { next(new AuthError(400, 'Invalid logout request.')); return; }
    try { auth.logout(bearerToken(request)); response.json(LogoutResponseSchema.parse({ protocolVersion: PROTOCOL_VERSION, ok: true })); } catch (error) { next(error); }
  });
  router.get('/me', (request, response, next) => {
    try { response.json(SessionInfoSchema.parse(auth.info(requireSession(auth, request)))); } catch (error) { next(error); }
  });
  router.post('/logout-all', (request, response, next) => {
    try {
      if (!LogoutRequestSchema.safeParse(request.body).success) throw new AuthError(400, 'Invalid sign-out request.');
      auth.logoutAll(bearerToken(request)); response.json(LogoutResponseSchema.parse({ protocolVersion: PROTOCOL_VERSION, ok: true }));
    } catch (error) { next(error); }
  });
  return router;
}
