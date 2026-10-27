import { z } from 'zod';
import { PROTOCOL_VERSION } from '../version';
import { CardIdSchema } from '../decks/deck';

/** Printed catalog data only; no match objects or executable effect definitions. */
export const CatalogCardSchema = z.object({
  id: CardIdSchema, name: z.string(), cardTypes: z.array(z.string()), subTypes: z.array(z.string()),
  rulesText: z.string(), manaCost: z.string(), colors: z.array(z.string()),
  power: z.number().optional(), toughness: z.number().optional(), deckLegal: z.boolean(), copyLimit: z.number().int().positive().nullable(),
}).strict();
export type CatalogCard = z.infer<typeof CatalogCardSchema>;
export const CatalogResponseSchema = z.object({ protocolVersion: z.literal(PROTOCOL_VERSION), cards: z.array(CatalogCardSchema), total: z.number().int().min(0), offset: z.number().int(), limit: z.number().int() }).strict();
