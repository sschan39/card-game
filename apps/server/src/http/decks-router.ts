import { Router } from 'express';
import { DeckIdSchema, DeckListResponseSchema, DeckResponseSchema, DeckValidationErrorSchema, DeckWriteEnvelopeSchema, PageQuerySchema, PROTOCOL_VERSION } from '@card-game/protocol';
import type { AuthService } from '../auth/service';
import { requireSession } from '../auth/routes';
import { AuthError } from '../auth/errors';
import { DeckService, InvalidDeckError } from '../decks/deck-service';

export function createDecksRouter(auth: AuthService, decks: DeckService, defaultPageSize = 25): Router {
  const router = Router();
  router.use((request, response, next) => {
    try {
      const session = requireSession(auth, request);
      if (session.scope !== 'game' || session.subject.kind !== 'account') throw new AuthError(403, 'Sign in with a game account to manage decks.');
      response.locals.ownerId = session.subject.id; next();
    } catch (error) { next(error); }
  });
  router.get('/', (request, response, next) => {
    try {
      const page = PageQuerySchema.safeParse({ ...request.query, limit: request.query.limit ?? defaultPageSize });
      if (!page.success) throw new AuthError(400, 'Invalid deck page.');
      const { offset, limit } = page.data;
      response.json(DeckListResponseSchema.parse({ protocolVersion: PROTOCOL_VERSION, ...decks.list(response.locals.ownerId, offset, limit), offset, limit }));
    } catch (error) { next(error); }
  });
  router.param('id', (_request, _response, next, id: string) => { next(DeckIdSchema.safeParse(id).success ? undefined : new AuthError(404, 'Deck not found.')); });
  router.get('/:id', (request, response, next) => {
    try { response.json(DeckResponseSchema.parse({ protocolVersion: PROTOCOL_VERSION, deck: decks.get(response.locals.ownerId, request.params.id) })); }
    catch (error) { next(error); }
  });
  const write = (method: 'create' | 'update') => {
    const handler: import('express').RequestHandler = (request, response, next) => {
      try {
        const envelope = DeckWriteEnvelopeSchema.safeParse(request.body);
        if (!envelope.success) throw new AuthError(400, 'Invalid deck request.');
        const deck = method === 'create' ? decks.create(response.locals.ownerId, envelope.data.deck) : decks.update(response.locals.ownerId, DeckIdSchema.parse(request.params.id), envelope.data.deck);
        response.status(method === 'create' ? 201 : 200).json(DeckResponseSchema.parse({ protocolVersion: PROTOCOL_VERSION, deck }));
      } catch (error) {
        if (error instanceof InvalidDeckError) response.status(error.status).json(DeckValidationErrorSchema.parse({ protocolVersion: PROTOCOL_VERSION, message: error.message, issues: error.issues }));
        else next(error);
      }
    }; return handler;
  };
  router.post('/', write('create')); router.put('/:id', write('update'));
  router.delete('/:id', (request, response, next) => {
    try { decks.delete(response.locals.ownerId, request.params.id); response.status(204).end(); } catch (error) { next(error); }
  });
  return router;
}
