import { z } from 'zod';
import policy from './config/eligibility.json';
import { CardIdSchema } from './deck';
export const DeckEligibilitySchema = z.object({
  unlimitedCopies: z.array(CardIdSchema), excludedCards: z.array(CardIdSchema),
  retiredCards: z.array(CardIdSchema).optional(),
  copyLimits: z.record(CardIdSchema, z.number().int().positive().max(250)),
}).strict().superRefine((value, ctx) => {
  const unlimited = new Set(value.unlimitedCopies), excluded = new Set(value.excludedCards);
  if (unlimited.size !== value.unlimitedCopies.length || excluded.size !== value.excludedCards.length ||
      (value.retiredCards && new Set(value.retiredCards).size !== value.retiredCards.length) ||
      [...unlimited].some(id => excluded.has(id) || Object.prototype.hasOwnProperty.call(value.copyLimits, id)) || Object.keys(value.copyLimits).some(id => excluded.has(id))) {
    ctx.addIssue({ code: 'custom', message: 'Duplicate or overlapping deck-policy exceptions' });
  }
});
export type DeckEligibility = z.infer<typeof DeckEligibilitySchema>;
export const deckEligibility = Object.freeze(DeckEligibilitySchema.parse(policy));
