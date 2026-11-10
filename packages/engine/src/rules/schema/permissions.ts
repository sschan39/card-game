import { z } from 'zod';
import { Identifier, PlayerRelation } from './shared';

export const PermissionSchema = z.strictObject({ action: z.enum(['cast', 'activate', 'deploy', 'target', 'affect', 'attack', 'block']), mode: z.enum(['prohibit', 'instant']),
  players: PlayerRelation.optional(), abilityIds: z.array(Identifier).optional() })
  .refine(v => v.action === 'cast' || v.action === 'activate' || v.mode === 'prohibit', 'Only casts and activations can change timing')
  .refine(v => !v.abilityIds || v.action === 'activate', 'Ability IDs require activation permission');
export const PermissionOperationSchema = z.strictObject({ type: z.literal('PERMISSION'), rules: z.array(PermissionSchema).min(1) });
export type PermissionOperation = z.infer<typeof PermissionOperationSchema>;
