import { Router } from 'express';
import {
  CatalogResponseSchema,
  LocaleCodeSchema,
  PageQuerySchema,
  PROTOCOL_VERSION,
  type CatalogCard,
  type ClientLocale,
} from '@card-game/protocol';
import { AuthError } from '../auth/errors';

/**
 * Serve the card catalogue in one language.
 *
 * Each shipped locale has its own prebuilt table: the catalogue is read far more
 * often than it changes, so resolving 164 definitions per request would be waste.
 * An unknown `?locale=` is rejected rather than silently served as English.
 */
export function createCatalogRouter(
  catalogs: ReadonlyMap<ClientLocale, ReadonlyMap<string, CatalogCard>>,
  defaultPageSize = 25,
): Router {
  const router = Router();
  router.get('/', (request, response, next) => {
    const locale = LocaleCodeSchema.safeParse(request.query.locale ?? 'en');
    if (!locale.success) { next(new AuthError(400, 'Invalid catalog locale.')); return; }
    const catalog = catalogs.get(locale.data);
    if (!catalog) { next(new AuthError(400, 'Invalid catalog locale.')); return; }
    /* `locale` is consumed above; everything else still goes through the strict page
       schema, so an unknown query field (ownerId, …) is rejected rather than ignored. */
    const { locale: _locale, ...paging } = request.query;
    const page = PageQuerySchema.safeParse({ ...paging, limit: request.query.limit ?? defaultPageSize });
    if (!page.success) { next(new AuthError(400, 'Invalid catalog page.')); return; }
    const { offset, limit } = page.data, cards = [...catalog.values()];
    response.json(CatalogResponseSchema.parse({
      protocolVersion: PROTOCOL_VERSION, locale: locale.data,
      cards: cards.slice(offset, offset + limit), total: cards.length, offset, limit,
    }));
  });
  return router;
}
