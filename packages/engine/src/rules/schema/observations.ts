import { z } from 'zod';
import { consistentObservationVisibility, observationLimits } from '../../shared/observation-policy';
import { CardFilterSchema, CardResultSourceSchema } from './shared';

const role = z.enum(['controller', 'opponent', 'zone_owner', 'all_players']);
const audience = z
  .array(role)
  .max(4)
  .refine((values) => new Set(values).size === values.length, 'Duplicate audience role');
export const ObservationVisibilitySchema = z
  .strictObject({
    faces: audience,
    count: audience,
    order: audience,
    expires: z.enum(['resolution_end', 'hand_exit_or_turn_end']),
  })
  .refine(consistentObservationVisibility, 'Faces require count visibility; order requires face visibility');
const event = z.enum(['none', 'revealed']).optional();
const publicReveal = (value: { event?: string; visibility?: z.infer<typeof ObservationVisibilitySchema> }) =>
  value.event !== 'revealed' || !!value.visibility?.faces.includes('all_players');
const window = {
  zonePlayer: z.enum(['self', 'opponent']).optional(),
  visibility: ObservationVisibilitySchema.optional(),
  event,
};
const amount = z.number().int().min(1).max(observationLimits.maxWindowCards);
export const CaptureWindowSchema = z.union([
  z.strictObject({ ...window, zone: z.literal('library'), position: z.literal('top'), amount })
    .refine(v => v.visibility?.expires !== 'hand_exit_or_turn_end', 'Long-lived reveals require a hand card'),
  z.strictObject({ ...window, zone: z.literal('hand'), position: z.literal('random'), amount }),
  z.strictObject({ ...window, zone: z.literal('hand'), position: z.literal('result'),
    from: CardResultSourceSchema.extend({ view: z.literal('current').optional() }) }),
]).refine(publicReveal, 'A revealed event requires explicit public face visibility');
export const CollectionVisibilitySchema = z
  .strictObject({
    from: CardResultSourceSchema.extend({ view: z.literal('current').optional() }),
    filter: CardFilterSchema.optional(),
    visibility: ObservationVisibilitySchema.refine(v => v.expires === 'resolution_end'),
    event,
  })
  .refine(publicReveal, 'A revealed event requires explicit public face visibility');
