import { isTokenDefinition } from '../../library/tokens';
import { tokenPolicy } from '../../shared/token-policy';
import { z } from 'zod';
import { observationLimits } from '../../shared/observation-policy';
import { CaptureWindowSchema, CollectionVisibilitySchema } from './observations';
import {
  Color,
  Count,
  CountExpression,
  Identifier,
  EffectNumber,
  EffectCount,
  LifetimeSchema,
  Numeric,
  Zone,
  CardFilterSchema,
  CostSchema,
  CardResultSourceSchema,
  ScopeSchema,
} from './shared';
import { AuthoredReplacementSchema } from './event-replacements';

/** Functional public names map explicitly to the existing execution primitives. */
export const InstructionNames = {
  ATTACH: ['attachments', 'attach'],
  CLAIM_REVEALED_SELF: ['cards', 'claim_revealed_source'],
  DISCARD_FROM_LIBRARY: ['cards', 'mill'],
  DISCARD_CAPTURED: ['cards', 'discard_captured'],
  DISCARD_FROM_HAND: ['cards', 'discard'],
  DISCARD_RANDOM_FROM_HAND: ['cards', 'discard_random'],
  DISCARD_HAND: ['cards', 'discard_hand'],
  DRAW: ['cards', 'draw'],
  DRAW_OPPONENT_TOP: ['cards', 'draw_opponent_top'],
  ALLOW_REVEALED_MANA: ['costs', 'allow_revealed_mana'],
  SHUFFLE: ['cards', 'shuffle'],
  REORDER_LIBRARY: ['cards', 'reorder_library'],
  REVEAL_TOP: ['cards', 'reveal_top'],
  CREATE_TOKEN: ['cards', 'create_token'],
  CAPTURE_WINDOW: ['cards', 'capture_window'],
  RESTRICT_REVEALED_NAME: ['permissions', 'restrict_revealed_name'],
  SET_COLLECTION_VISIBILITY: ['cards', 'set_collection_visibility'],
  MOVE_ZONE: ['cards', 'move'],
  DESTROY: ['cards', 'destroy'],
  SACRIFICE: ['cards', 'sacrifice'],
  COUNTER: ['stack', 'counter'],
  REDIRECT_STACK_TARGET: ['stack', 'redirect_target'],
  CANCEL_ATTACK: ['combat', 'cancel_attack'],
  TAP: ['orientation', 'tap'],
  UNTAP: ['orientation', 'untap'],
  PAY_COST: ['resources', 'pay_cost'],
  MODIFY_LIFE: ['resources', 'adjust_life'],
  ADD_MANA: ['resources', 'add_mana'],
  DEAL_DAMAGE: ['damage', 'deal'],
  MODIFY_STATS: ['characteristics', 'adjust_stats_and_damage'],
  ADD_COUNTER: ['counters', 'add'],
  REMOVE_COUNTER: ['counters', 'remove'],
  GRANT_STATS: ['characteristics', 'temporary_stats'],
  SET_STATS: ['characteristics', 'set_stats'],
  CREATE_CONTINUOUS_EFFECT: ['characteristics', 'create_effect'],
  CREATE_REPLACEMENT_EFFECT: ['event-replacements', 'create_effect'],
  REGENERATE: ['event-replacements', 'regenerate'],
  CREATE_DELAYED_TRIGGER: ['triggers', 'delay'],
} as const;
export type InstructionAction = keyof typeof InstructionNames;

/** Parameter schemas for every instruction action, keyed by action id. */
export function instructionParameterSchemas(
  characteristic: z.ZodType,
  ability: () => z.ZodType,
  instruction: () => z.ZodType = () => z.never(),
) {
  const empty = z.strictObject({});
  const stats = { power: EffectNumber.optional(), toughness: EffectNumber.optional() };
  const nonemptyStats = z
    .strictObject(stats)
    .refine((v) => v.power !== undefined || v.toughness !== undefined, 'Stat change requires a value');
  return {
    CREATE_TOKEN: z.strictObject({
      tokenId: Identifier.refine(isTokenDefinition, 'Unknown token definition'),
      amount: CountExpression.refine(
        (value) => typeof value !== 'number' || value <= tokenPolicy.maxCreatedPerInstruction,
        'Token creation exceeds its work bound',
      ).optional(),
    }),
    CAPTURE_WINDOW: CaptureWindowSchema,
    RESTRICT_REVEALED_NAME: z.strictObject({
      from: CardResultSourceSchema.extend({ view: z.literal('recorded').optional() }),
      actions: z.array(z.enum(['cast', 'activate', 'deploy'])).min(1).max(3)
        .refine(actions => new Set(actions).size === actions.length, 'Use distinct restricted actions'),
    }),
    SET_COLLECTION_VISIBILITY: CollectionVisibilitySchema,
    PAY_COST: z.strictObject({
      cost: CostSchema.omit({ destroyMaterials: true, exileMaterials: true }),
      then: z.array(z.lazy(instruction)).min(1).max(32),
      prompt: z.string().optional(),
    }),
    ATTACH: empty,
    CLAIM_REVEALED_SELF: z.strictObject({ discard: z.boolean().optional() }),
    DISCARD_FROM_LIBRARY: z.union([
      z.strictObject({ amount: EffectCount }),
      z.strictObject({
        from: CardResultSourceSchema.extend({ view: z.literal('current').optional() }),
        filter: CardFilterSchema.optional(),
        amount: EffectCount.optional(),
      }),
    ]),
    DISCARD_CAPTURED: z.strictObject({
      from: CardResultSourceSchema.extend({ view: z.literal('current').optional() }),
      filter: CardFilterSchema.optional(),
    }),
    DISCARD_FROM_HAND: z.strictObject({ amount: EffectCount }),
    DISCARD_RANDOM_FROM_HAND: z.strictObject({ amount: EffectCount }),
    DISCARD_HAND: empty,
    DRAW: z.strictObject({ amount: EffectCount, position: z.literal('bottom').optional() }),
    DRAW_OPPONENT_TOP: empty,
    ALLOW_REVEALED_MANA: z.strictObject({
      from: CardResultSourceSchema.extend({ view: z.literal('current').optional() }),
      color: Color,
    }),
    SHUFFLE: empty,
    REORDER_LIBRARY: z.strictObject({ placement: z.enum(['top', 'bottom']) }),
    REVEAL_TOP: z
      .strictObject({
        amount: Count.min(1).max(observationLimits.maxWindowCards),
        filter: CardFilterSchema.optional(),
        min: Count.optional(),
        max: Count.optional(),
        subTypes: z.array(Identifier).optional(),
        excludedNames: z.array(z.string()).optional(),
        disposition: z.literal('scorch').optional(),
        remainder: z.enum(['bottom', 'discard']).optional(),
        matchingClauses: z
          .array(
            z.strictObject({
              cardTypes: z.array(Identifier),
              subTypes: z.array(Identifier),
            }),
          )
          .optional(),
      })
      .refine((v) => !v.filter || (!v.subTypes && !v.excludedNames), 'Use one shared reveal filter')
      .refine((v) => v.disposition !== 'scorch' || v.remainder !== 'discard', 'Scorch reveals order the remainder on the bottom')
      .refine((v) => (v.min ?? 0) <= (v.max ?? 1) && (v.max ?? 1) <= v.amount, 'Invalid reveal selection bounds'),
    MOVE_ZONE: z
      .strictObject({
        origin: Zone.optional(),
        destination: Zone,
        handRecipient: z.literal('controller').optional(),
        host: z.discriminatedUnion('mode', [
          z.strictObject({ mode: z.literal('store'), visibility: z.enum(['public', 'owner', 'controller', 'hidden']) }),
          z.strictObject({ mode: z.literal('release'), selection: z.enum(['all', 'selected']) }),
        ]).optional(),
        from: CardResultSourceSchema.extend({ view: z.literal('current').optional() }).optional(),
        filter: CardFilterSchema.optional(),
        libraryPlacement: z.enum(['top', 'bottom']).optional(),
      })
      .refine(
        (v) => !v.libraryPlacement || v.destination === 'library',
        'Library placement requires a library destination',
      )
      .refine(v => !v.handRecipient || v.destination === 'hand', 'A hand recipient requires a hand destination')
      .refine(v => (v.destination === 'hosted') === (v.host?.mode === 'store'), 'Hosted destination requires a store operation')
      .refine(v => (v.origin === 'hosted') === (v.host?.mode === 'release'), 'Hosted origin requires a release operation')
      .refine(v => v.host?.mode !== 'release' || !v.from, 'A hosted release uses its host collection')
      .refine(v => !v.filter || !!v.from || v.host?.mode === 'release' && v.host.selection === 'all', 'A move filter requires an automatic collection'),
    DESTROY: empty,
    SACRIFICE: empty,
    COUNTER: z.strictObject({ sourceDisposition: z.enum(['bottom_library', 'discard_or_destroy']).optional() }),
    CANCEL_ATTACK: empty,
    REDIRECT_STACK_TARGET: empty,
    TAP: z.strictObject({ skipNextUntap: z.literal(true).optional() }),
    UNTAP: empty,
    MODIFY_LIFE: z.strictObject({ amount: EffectNumber, set: z.literal(true).optional() }),
    ADD_MANA: z
      .strictObject({
        color: Color.optional(),
        colors: z.array(Color).min(1).optional(),
        amount: Count.min(1),
      })
      .refine((v) => !!v.color !== !!v.colors, 'Choose color or colors'),
    DEAL_DAMAGE: z.strictObject({ amount: EffectCount }),
    MODIFY_STATS: z
      .strictObject({ ...stats, damage: EffectNumber.optional(), duration: z.enum(['END_OF_TURN', 'END_OF_COMBAT', 'PERMANENT']).optional() })
      .refine((v) => v.power !== undefined || v.toughness !== undefined || v.damage !== undefined, 'Stat/damage change requires a value')
      .refine((v) => !v.duration || v.power !== undefined || v.toughness !== undefined, 'Duration requires a stat change'),
    ADD_COUNTER: z.strictObject({ counterType: Identifier, amount: EffectCount }),
    REMOVE_COUNTER: z.strictObject({ counterType: Identifier, amount: EffectCount }),
    GRANT_STATS: nonemptyStats,
    SET_STATS: z.strictObject({
      power: Numeric,
      toughness: Numeric,
      duration: LifetimeSchema.optional(),
      requiredZone: Zone.nullable().optional(),
    }),
    CREATE_CONTINUOUS_EFFECT: z.strictObject({
      effect: characteristic,
      scope: ScopeSchema.omit({ from: true }).optional(),
      duration: LifetimeSchema.optional(),
      requiredZone: Zone.nullable().optional(),
    }),
    CREATE_REPLACEMENT_EFFECT: z.strictObject({ definition: AuthoredReplacementSchema }),
    REGENERATE: empty,
    CREATE_DELAYED_TRIGGER: z
      .strictObject({
        ability: z.lazy(ability),
        lifetime: z.enum(['once', 'end_of_turn', 'permanent']).optional(),
      })
      .superRefine((params, ctx) => {
        const trigger = (params.ability as { trigger?: { listener?: unknown } }).trigger;
        if (trigger?.listener !== undefined)
          ctx.addIssue({
            code: 'custom',
            path: ['ability', 'trigger', 'listener'],
            message: 'Delayed registrations own their lifetime; source discovery listeners are not supported here',
          });
      }),
  } satisfies Record<InstructionAction, z.ZodType>;
}
