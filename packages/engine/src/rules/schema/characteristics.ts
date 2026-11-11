import { z } from 'zod';
import { Color, Identifier, Numeric, ScopeSchema, Finite, Count } from './shared';

export const CharacteristicValueSchema = z.union([Numeric, z.strictObject({ count: ScopeSchema, multiply: Finite.optional(), add: Finite.optional() })]);
/** Schema for a characteristic value: a plain number, or a counted scope with optional scaling. */
export function characteristicOperationSchema(ability: () => z.ZodType, blueprint: () => z.ZodType) {
  return z.discriminatedUnion('type', [
    z.strictObject({ type: z.literal('COPY'), blueprint: z.lazy(blueprint) }),
    z.strictObject({ type: z.literal('CONTROL'), controllerId: Identifier }),
    z.strictObject({ type: z.literal('TEXT'), replacements: z.record(Identifier, z.string()) }),
    z.strictObject({ type: z.literal('TYPE'), set: z.array(Identifier).optional(), add: z.array(Identifier).optional(), remove: z.array(Identifier).optional(),
      setSubTypes: z.array(Identifier).optional(), addSubTypes: z.array(Identifier).optional(), removeSubTypes: z.array(Identifier).optional(),
      setSuperTypes: z.array(Identifier).optional(), addSuperTypes: z.array(Identifier).optional(), removeSuperTypes: z.array(Identifier).optional() }),
    z.strictObject({ type: z.literal('MANA_COST'), mana: z.strictObject({ generic: Count.optional(), white: Count.optional(), blue: Count.optional(), black: Count.optional(), red: Count.optional(), green: Count.optional(), yellow: Count.optional() }) }),
    z.strictObject({ type: z.literal('COLOR'), set: z.array(Color).optional(), add: z.array(Color).optional(), remove: z.array(Color).optional() }),
    z.strictObject({ type: z.literal('ABILITY'), removeAll: z.boolean().optional(), removeIds: z.array(Identifier).optional(), add: z.array(z.lazy(ability)).optional(),
      addKeywords: z.array(Identifier).optional(), removeKeywords: z.array(Identifier).optional() }),
    z.strictObject({ type: z.literal('SET_STATS'), power: CharacteristicValueSchema, toughness: CharacteristicValueSchema }),
    z.strictObject({ type: z.literal('STAT_DELTA'), power: CharacteristicValueSchema.optional(), toughness: CharacteristicValueSchema.optional(), unique: Identifier.optional() })
      .refine(v => v.power !== undefined || v.toughness !== undefined, 'Stat adjustment requires power or toughness'),
    z.strictObject({ type: z.literal('SWITCH_STATS') }),
    z.strictObject({ type: z.literal('MILL_AMOUNT'), amount: Count }),
  ]);
}
