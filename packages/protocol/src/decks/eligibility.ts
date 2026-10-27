import { z } from 'zod';
import policy from './config/eligibility.json';
import { CardIdSchema } from './deck';
export const deckEligibility = Object.freeze(z.object({ unlimitedCopies: z.array(CardIdSchema), excludedCards: z.array(CardIdSchema) }).strict().parse(policy));
