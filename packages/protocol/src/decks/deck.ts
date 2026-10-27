import { z } from 'zod';
import { PROTOCOL_VERSION } from '../version';
import standardFormat from './config/standard-v1.json';

/** Initial project format, independently versioned from engine rule configuration. */
const FormatSchema = z.object({ format: z.literal('standard'), minCards: z.number().int().min(1).max(250), maxCards: z.number().int().min(1).max(250), maxCopies: z.number().int().min(1).max(250) }).strict().refine(value => value.minCards <= value.maxCards);
export const DECK_RULES = Object.freeze(FormatSchema.parse(standardFormat));
export const CardIdSchema = z.string().regex(/^[a-z0-9][a-z0-9_-]{0,127}$/);
export const DeckIdSchema = z.string().uuid();
export const DeckSchema = z.object({
  name: z.string().trim().min(1).max(80),
  format: z.literal(DECK_RULES.format),
  cards: z.array(z.object({ cardId: CardIdSchema, quantity: z.number().int().min(1).max(DECK_RULES.maxCards) }).strict()).min(1).max(DECK_RULES.maxCards),
}).strict();
export type DeckInput = z.infer<typeof DeckSchema>;
export interface DeckCatalogEntry { id: string; deckLegal: boolean; copyLimit: number | null }
export const DeckIssueSchema = z.object({
  code: z.enum(['structure', 'size', 'duplicate', 'unknown_card', 'illegal_card', 'copy_limit']), message: z.string(), cardId: z.string().optional(),
}).strict();
export type DeckIssue = z.infer<typeof DeckIssueSchema>;
export type DeckValidation = { valid: true; deck: DeckInput } | { valid: false; issues: DeckIssue[] };

/** Pure and engine-free: the API and future builder use the same rule errors. */
export function validateDeck(input: unknown, catalog: ReadonlyMap<string, DeckCatalogEntry>): DeckValidation {
  const parsed = DeckSchema.safeParse(input);
  if (!parsed.success) return { valid: false, issues: [{ code: 'structure', message: 'Invalid deck structure.' }] };
  const deck = parsed.data, issues: DeckIssue[] = [], seen = new Set<string>();
  const count = deck.cards.reduce((sum, entry) => sum + entry.quantity, 0);
  if (count < DECK_RULES.minCards || count > DECK_RULES.maxCards) issues.push({ code: 'size', message: `Use ${DECK_RULES.minCards}–${DECK_RULES.maxCards} cards.` });
  for (const { cardId, quantity } of deck.cards) {
    if (seen.has(cardId)) issues.push({ code: 'duplicate', cardId, message: 'Use one entry per card definition.' });
    seen.add(cardId);
    const card = catalog.get(cardId);
    if (!card) issues.push({ code: 'unknown_card', cardId, message: 'Unknown card definition.' });
    else if (!card.deckLegal) issues.push({ code: 'illegal_card', cardId, message: 'This card cannot be included in saved decks.' });
    else if (card.copyLimit !== null && quantity > card.copyLimit) issues.push({ code: 'copy_limit', cardId, message: `Use at most ${card.copyLimit} copies of this card.` });
  }
  return issues.length ? { valid: false, issues } : { valid: true, deck };
}

export const DeckRecordSchema = DeckSchema.extend({ id: DeckIdSchema, createdAt: z.number().int(), updatedAt: z.number().int() });
export type SavedDeck = z.infer<typeof DeckRecordSchema>;
export const DeckWriteRequestSchema = z.object({ protocolVersion: z.literal(PROTOCOL_VERSION), deck: DeckSchema }).strict();
/** Validate the version/envelope first so shared rule validation owns all deck errors. */
export const DeckWriteEnvelopeSchema = z.object({ protocolVersion: z.literal(PROTOCOL_VERSION), deck: z.unknown() }).strict();
export const DeckResponseSchema = z.object({ protocolVersion: z.literal(PROTOCOL_VERSION), deck: DeckRecordSchema }).strict();
export const PageQuerySchema = z.object({ offset: z.coerce.number().int().min(0).max(100_000).default(0), limit: z.coerce.number().int().min(1).max(100).default(25) }).strict();
export const DeckListResponseSchema = z.object({ protocolVersion: z.literal(PROTOCOL_VERSION), decks: z.array(DeckRecordSchema), total: z.number().int().min(0), offset: z.number().int(), limit: z.number().int() }).strict();
export const DeckValidationErrorSchema = z.object({ protocolVersion: z.literal(PROTOCOL_VERSION), message: z.literal('Deck is invalid.'), issues: z.array(DeckIssueSchema) }).strict();
export const RoomSetupRequestSchema = z.object({ protocolVersion: z.literal(PROTOCOL_VERSION), deckId: DeckIdSchema.optional() }).strict();
export const JoinRoomRequestSchema = RoomSetupRequestSchema.extend({ roomId: z.string().min(1).max(128) });
