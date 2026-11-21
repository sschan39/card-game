import { Router, type Request, type RequestHandler } from 'express';
import { z } from 'zod';
import { combatPracticeScenario, OperatorTestRoomsSchema, PlaytestCredentialsSchema, PROTOCOL_VERSION } from '@card-game/protocol';
import { browserSession, browserToken, browserWrite } from '../auth/browser-routes';
import type { AuthService } from '../auth/service';
import type { SessionRecord } from '../auth/account-store';
import type { ServerConfig } from '../config';
import { AuthError } from '../auth/errors';
import type { ScenarioService } from '../scenarios/service';

const requestVersion = z.object({ protocolVersion: z.literal(PROTOCOL_VERSION) }).strict();
const roomId = z.string().uuid();

export function createOperatorPlaytestRouter(service: ScenarioService, auth: AuthService, config: ServerConfig) {
  const router = Router();
  const requireOperator = async (request: Request, write = false) => {
    const operator = browserSession(auth, request, config);
    if (write) {
      browserWrite(request, config, browserToken(request, config));
      if (!requestVersion.safeParse(request.body).success) throw new AuthError(400, 'Invalid Test Room request.');
    }
    await service.authorizeOperator(operator);
    return operator;
  };
  const write = (action: (request: Request, operator: SessionRecord) => unknown, status = 200): RequestHandler =>
    async (request, response, next) => {
      try { response.status(status).json(action(request, await requireOperator(request, true))); }
      catch (error) { next(error); }
    };
  const id = (request: Request) => {
    const parsed = roomId.safeParse(request.params.id);
    if (!parsed.success) throw new AuthError(404, 'Test room unavailable.');
    return parsed.data;
  };
  router.get('/', async (request, response, next) => {
    try {
      const operator = await requireOperator(request);
      response.json(OperatorTestRoomsSchema.parse({ protocolVersion: PROTOCOL_VERSION, rooms: service.ownedPlaytests(operator) }));
    } catch (error) { next(error); }
  });
  router.post('/', write((_request, operator) => PlaytestCredentialsSchema.parse(service.launchOwnedPlaytest(combatPracticeScenario(), operator)), 201));
  router.post('/:id/resume', write((request, operator) => PlaytestCredentialsSchema.parse(service.resumeOwnedPlaytest(id(request), operator))));
  router.delete('/:id', write((request, operator) => {
    service.stopOwnedPlaytest(id(request), operator);
    return { protocolVersion: PROTOCOL_VERSION, ok: true };
  }));
  return router;
}
