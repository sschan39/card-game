import { Router } from 'express';
import { CatalogResponseSchema, PageQuerySchema, PROTOCOL_VERSION, type CatalogCard } from '@card-game/protocol';
import { AuthError } from '../auth/errors';

export function createCatalogRouter(catalog: ReadonlyMap<string, CatalogCard>): Router {
  const router = Router();
  router.get('/', (request, response, next) => {
    const page = PageQuerySchema.safeParse(request.query);
    if (!page.success) { next(new AuthError(400, 'Invalid catalog page.')); return; }
    const { offset, limit } = page.data, cards = [...catalog.values()];
    response.json(CatalogResponseSchema.parse({ protocolVersion: PROTOCOL_VERSION, cards: cards.slice(offset, offset + limit), total: cards.length, offset, limit }));
  });
  return router;
}
