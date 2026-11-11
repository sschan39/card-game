import { validCounterRemoval } from '../../shared/counter-cost-validation';
import type { CounterRemovalCost } from '../../types/counter-cost.types';
import { z } from 'zod';
import type { CardFilter } from '../../types/card-query.types';
import type { NumericValue } from '../../types/numeric-value.types';
import type { RuleCondition } from '../../types/rule.types';
import { validateNumericValue } from '../../shared/numeric-values';
import { safeRuleKey, validRulePath } from '../../shared/rule-path';

export const Identifier = z.string().min(1).refine(safeRuleKey, 'Unsafe identifier');
export const Zone = z.enum(['library', 'hand', 'battlefield', 'graveyard', 'exile', 'stack']);
export const Color = z.enum(['white', 'blue', 'green', 'black', 'red', 'yellow']);
export const CardTypeSchema = z.enum([
  'Creature',
  'Spell',
  'Land',
  'Artifact',
  'Enchantment',
  'Planeswalker',
  'Battle',
]);
export const PlayerRelation = z.enum(['self', 'opponent', 'any']);
export const Count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
export const PositiveCount = Count.min(1);
export const Finite = z.number().finite();
export const Numeric = z.custom<NumericValue>((value) => !validateNumericValue(value), 'Invalid numeric definition');
export const EffectNumber = z.union([
  Numeric,
  z.string().regex(/^DYNAMIC:(?:(?:source|target)\.(?:power|toughness)|event\.[A-Za-z0-9_.]+)$/),
]);
export const CountExpression = Numeric.refine(
  (v) => typeof v !== 'number' || (Number.isSafeInteger(v) && v >= 0),
  'Expected a non-negative integer value',
);
export const EffectCount = z.union([
  CountExpression,
  z.string().regex(/^DYNAMIC:(?:(?:source|target)\.(?:power|toughness)|event\.[A-Za-z0-9_.]+)$/),
]);
export const Bounds = z
  .strictObject({
    min: Finite.optional(),
    max: Finite.optional(),
  })
  .refine((b) => b.min === undefined || b.max === undefined || b.min <= b.max, 'Minimum exceeds maximum');
export const ObjectReference = z.strictObject({ cardUuid: Identifier, zoneRevision: Count });
const ResultName = Identifier.refine(name => !!name.trim(), 'Empty result name');
export const CardResultSourceSchema = z.strictObject({
  kind: z.literal('result'),
  name: ResultName,
  view: z.enum(['current', 'recorded']).optional(),
  except: ResultName.optional(),
});
export const CardResultDefinitionSchema = z.strictObject({
  name: ResultName,
  kind: z.enum(['milled', 'drawn', 'captured']),
});

export const FilterFields = {
  ids: z.array(Identifier).optional(),
  cardTypes: z.array(CardTypeSchema).optional(),
  subTypes: z.array(Identifier).optional(),
  colors: z.array(Color).optional(),
  names: z.array(z.string()).optional(),
  excludedNames: z.array(z.string()).optional(),
  nameContains: z.string().optional(),
  controller: PlayerRelation.optional(),
  owner: PlayerRelation.optional(),
  power: Bounds.optional(),
  toughness: Bounds.optional(),
  manaValue: Bounds.optional(),
  tapped: z.boolean().optional(),
  summonKind: z.enum(['cast', 'effect']).optional(),
  counter: z.strictObject({ type: Identifier, min: Count.optional(), max: Count.optional() }).optional(),
  allOf: z.array(z.lazy(() => CardFilterSchema)).optional(),
  anyOf: z.array(z.lazy(() => CardFilterSchema)).optional(),
  not: z.lazy(() => CardFilterSchema).optional(),
};
export const CardFilterSchema: z.ZodType<CardFilter> = z.lazy(() => z.strictObject(FilterFields));
export const ScopeSchema = z.strictObject({
  ...FilterFields,
  from: CardResultSourceSchema.optional(),
  attachedToSource: z.boolean().optional(),
  self: z.boolean().optional(),
  cardUuid: Identifier.optional(),
  zoneRevision: Count.optional(),
  objects: z.array(ObjectReference).optional(),
  zones: z.array(Zone).optional(),
});
export const TargetSchema = z
  .strictObject({
    ...FilterFields,
    type: z.enum(['player', 'permanent', 'spell', 'stack', 'card', 'self', 'any']),
    zones: z.array(Zone).optional(),
    required: z.boolean(),
    minTargets: Count.optional(),
    maxTargets: Count.optional(),
    all: z.boolean().optional(),
    subject: z.enum(['controller', 'source', 'event_card']).optional(),
    stackTypes: z.array(z.enum(['spell', 'activated', 'triggered'])).optional(),
    extrema: z.strictObject({ field: z.literal('remainingHealth'), order: z.literal('min') }).optional(),
  })
  .refine((v) => (v.minTargets ?? (v.required ? 1 : 0)) <= (v.maxTargets ?? 1), 'Target minimum exceeds maximum');
const Operand = z.union([
  z.string(),
  Finite,
  z.boolean(),
  z.null(),
  z.strictObject({ path: z.string().refine(validRulePath, 'Unsafe rule path') }),
  Numeric,
]);
export const ConditionSchema: z.ZodType<RuleCondition> = z.lazy(() =>
  z.union([
    z.strictObject({ all: z.array(ConditionSchema) }),
    z.strictObject({ any: z.array(ConditionSchema) }),
    z.strictObject({ not: ConditionSchema }),
    z.strictObject({ op: z.enum(['eq', 'ne', 'gt', 'gte', 'lt', 'lte', 'includes']), left: Operand, right: Operand }),
  ]),
);
export const UsageSchema = z.strictObject({
  group: Identifier.optional(),
  period: z.enum(['turn', 'game']),
  limit: PositiveCount,
  identity: z.enum(['source_card', 'source_incarnation', 'controller']),
  consume: z.enum(['on_commit', 'on_change']),
});
export const LifetimeSchema = z.enum(['PERMANENT', 'END_OF_TURN', 'END_OF_COMBAT', 'WHILE_ON_BATTLEFIELD', 'WHILE_ATTACHED']);
export const NumericDeclarationSchema = z.strictObject({
  name: Identifier,
  min: z.number().int(),
  max: z.number().int().optional(),
});
export const CounterRemovalCostSchema = z.custom<CounterRemovalCost>(
  validCounterRemoval,
  'Invalid counter removal cost',
);
export const CostSchema = z.strictObject({
  destroyMaterials: z.strictObject({
    filter: CardFilterSchema,
    manaValueGreaterThan: Count,
  }).optional(),
  removeCounters: z.array(CounterRemovalCostSchema).max(16).optional(),
  mana: z
    .strictObject({
      generic: CountExpression.optional(),
      white: Count.optional(),
      blue: Count.optional(),
      green: Count.optional(),
      black: Count.optional(),
      red: Count.optional(),
      yellow: Count.optional(),
    })
    .optional(),
  tap: z.boolean().optional(),
  untap: z.boolean().optional(),
  life: Count.optional(),
  discard: Count.optional(),
  discardSelf: z.boolean().optional(),
  sacrifice: z.boolean().optional(),
});
export const CostRouteFields = {
  additionalCost: CostSchema.optional(),
  alternativeCosts: z.array(z.strictObject({ id: Identifier, label: z.string(), cost: CostSchema })).optional(),
};
export const ActionConditionSchema = z.strictObject({
  zoneCheck: z
    .strictObject({
      zone: z.array(Zone),
      ownedBy: PlayerRelation,
      cardType: Identifier.optional(),
      cardId: Identifier.optional(),
      minCount: Count.optional(),
      filter: CardFilterSchema.optional(),
    })
    .optional(),
});

/** Bound recursion before invoking any recursive schema, including cyclic in-process inputs. */
export function assertDefinitionTree(value: unknown): void {
  let nodes = 0;
  const active = new Set<object>();
  const visit = (v: unknown, depth: number) => {
    if (++nodes > 100000 || depth > 64) throw new Error('Rule definition exceeds structural limits');
    if (!v || typeof v !== 'object') return;
    if (active.has(v)) throw new Error('Cyclic rule definition');
    active.add(v);
    for (const [key, child] of Object.entries(v)) {
      if (!safeRuleKey(key)) throw new Error('Unsafe rule definition key');
      visit(child, depth + 1);
    }
    active.delete(v);
  };
  visit(value, 0);
}
