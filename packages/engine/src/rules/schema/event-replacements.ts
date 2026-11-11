import { z } from 'zod';
import { Count, Identifier, ObjectReference, Zone } from './shared';

export const ProposedEventKindSchema = z.enum(['damage', 'zone_transfer', 'destroy', 'sacrifice', 'discard', 'draw', 'life_change', 'counter_change']);
const Recipient = z.discriminatedUnion('kind', [z.strictObject({ kind: z.literal('player'), playerId: Identifier }),
  z.strictObject({ kind: z.literal('permanent'), cardUuid: Identifier, zoneRevision: Count })]);
export const ReplacementOperationSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('damage_scale'), factor: Count }),
  z.strictObject({ type: z.literal('heal_bonus'), amount: Count.min(1) }),
  z.strictObject({ type: z.literal('limit_life_loss'), floor: Count.optional() }),
  z.strictObject({ type: z.literal('reduce_damage'), amount: Count.min(1) }),
  z.strictObject({ type: z.literal('prevent_damage'), amount: Count.optional() }),
  z.strictObject({ type: z.literal('redirect_damage'), recipient: Recipient }),
  z.strictObject({ type: z.literal('move_destination'), to: Zone }),
  z.strictObject({ type: z.literal('cancel_event') }), z.strictObject({ type: z.literal('regenerate') }),
]);
export const ReplacementMatchSchema = z.strictObject({ kinds: z.array(ProposedEventKindSchema).optional(), playerId: Identifier.optional(), card: ObjectReference.optional(),
  source: ObjectReference.optional(), cardTypes: z.array(Identifier).optional(), controllerId: Identifier.optional(), from: Zone.optional(), to: Zone.optional(), combat: z.boolean().optional() });
export const AuthoredReplacementSchema = z.strictObject({ label: z.string().min(1), operation: ReplacementOperationSchema, match: ReplacementMatchSchema.optional(),
  selfReplacement: z.boolean().optional(), optional: z.boolean().optional(), duration: z.enum(['permanent', 'end_of_turn', 'end_of_combat', 'while_source']).optional(),
  expiresTurn: Count.optional(), remaining: Count.optional(), uses: Count.optional() });
export type EventReplacementOperation = z.infer<typeof ReplacementOperationSchema>;
