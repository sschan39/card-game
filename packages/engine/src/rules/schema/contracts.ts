import { z } from 'zod';
import {
  ActionConditionSchema,
  ConditionSchema,
  CostRouteFields,
  CostSchema,
  Count,
  PositiveCount,
  FilterFields,
  Identifier,
  NumericDeclarationSchema,
  PlayerRelation,
  ScopeSchema,
  TargetSchema,
  UsageSchema,
  Zone,
  CardTypeSchema,
  CardResultSourceSchema,
  CardResultDefinitionSchema,
  assertDefinitionTree,
} from './shared';
import { PermissionOperationSchema } from './permissions';
import { characteristicOperationSchema } from './characteristics';
import { CostOperationSchema } from './costs';
import { ProposedEventKindSchema, ReplacementOperationSchema } from './event-replacements';
import { InstructionNames, instructionParameterSchemas, type InstructionAction } from './instructions';

const speed = z.enum(['instant', 'sorcery']);
const triggerEvent = z.enum([
  'ON_ENTER_BATTLEFIELD',
  'ON_LEAVE_BATTLEFIELD',
  'ON_DIE',
  'ON_DESTROY',
  'ON_REVEAL',
  'ON_DRAW',
  'ON_SHUFFLE',
  'ON_DISCARD_FROM_HAND',
  'ON_DISCARD_FROM_LIBRARY',
  'ON_COUNTER_CHANGED',
  'ON_TAP',
  'BEGIN_DRAW_STEP',
  'BEGIN_UPKEEP',
  'END_OF_TURN',
  'ON_DAMAGE_TAKEN',
  'ON_LIFE_GAIN',
  'ON_LIFE_LOSS',
  'ON_DAMAGE_DEALT',
  'ON_BLOCK',
  'COMBAT_DAMAGE',
  'ON_SPELL_CAST',
  'ON_ATTACK',
  'ON_KILL',
  'ON_CHARACTERISTICS_CHANGED',
]);
export const CharacteristicOperationSchema = characteristicOperationSchema(
  () => NormalizedAbilitySchema,
  () => NormalizedBlueprintSchema,
);
export const ContinuousOperationSchema = z.union([CharacteristicOperationSchema, PermissionOperationSchema]);
const ruleBase = {
  id: Identifier,
  group: Identifier.optional(),
  condition: ConditionSchema.optional(),
  scope: ScopeSchema.omit({ cardUuid: true, zoneRevision: true, objects: true }),
};
export const ModifierDefinitionSchema = z.discriminatedUnion('family', [
  z.strictObject({ ...ruleBase, family: z.literal('characteristics'), operation: CharacteristicOperationSchema }),
  z.strictObject({ ...ruleBase, family: z.literal('permissions'), operation: PermissionOperationSchema }),
  z.strictObject({
    ...ruleBase,
    family: z.literal('costs'),
    action: z.literal('cast'),
    operation: CostOperationSchema,
    usage: UsageSchema.extend({ consume: z.literal('on_commit') }).optional(),
  }),
  z.strictObject({
    ...ruleBase,
    family: z.literal('event-replacements'),
    events: z.array(ProposedEventKindSchema).min(1),
    operation: ReplacementOperationSchema,
    scope: z.discriminatedUnion('type', [
      z.strictObject({
        type: z.literal('card'),
        filter: ScopeSchema.omit({ cardUuid: true, zoneRevision: true, objects: true }),
      }),
      z.strictObject({ type: z.literal('player'), relation: PlayerRelation }),
    ]),
    optional: z.boolean().optional(),
    usage: UsageSchema.extend({ consume: z.literal('on_change') }).optional(),
  }),
]);
export type ModifierDefinition = z.infer<typeof ModifierDefinitionSchema>;
export type CostModifierDefinition = Extract<ModifierDefinition, { family: 'costs' }>;
export type EventModifierDefinition = Extract<ModifierDefinition, { family: 'event-replacements' }>;

const parameters = instructionParameterSchemas(
  ContinuousOperationSchema,
  () => NormalizedAbilitySchema,
  () => AuthoredEffectSchema,
);
const effectFields = {
  onKill: z.strictObject({ destination: z.literal('exile') }).optional(),
  tags: z.array(Identifier).optional(),
  targeting: TargetSchema.optional(),
  choice: z.lazy(() => ChoiceSchema).optional(),
  recordResult: CardResultDefinitionSchema.optional(),
  condition: ConditionSchema.optional(),
  targetGroup: Identifier.optional(),
  recordOutcome: z
    .strictObject({
      name: Identifier,
      kind: z.enum(['destroyed', 'discarded', 'killed', 'deployed']),
      minimum: PositiveCount.optional(),
    })
    .optional(),
  requiresOutcome: Identifier.optional(),
};
const engineInstruction = z.strictObject({
  action: Identifier,
  params: z.record(z.string(), z.unknown()).optional(),
  ...effectFields,
});
export const AuthoredEffectSchema: z.ZodType = z.lazy(() =>
  z
    .union([
      engineInstruction,
      z.strictObject({
        family: Identifier,
        operation: Identifier,
        params: z.record(z.string(), z.unknown()).optional(),
        ...effectFields,
      }),
    ])
    .superRefine((value, ctx) => {
      const action =
        'action' in value
          ? value.action
          : Object.entries(InstructionNames).find(
              ([, pair]) => pair[0] === value.family && pair[1] === value.operation,
            )?.[0];
      if (!action || !Object.prototype.hasOwnProperty.call(parameters, action)) {
        ctx.addIssue({
          code: 'custom',
          path: ['action' in value ? 'action' : 'operation'],
          message: 'Unknown or unsupported instruction operation',
        });
        return;
      }
      if (
        value.recordResult &&
        !(
          (action === 'DISCARD_FROM_LIBRARY' && value.recordResult.kind === 'milled') ||
          (action === 'DRAW_OPPONENT_TOP' && value.recordResult.kind === 'drawn') ||
          (action === 'CAPTURE_WINDOW' && value.recordResult.kind === 'captured')
        )
      )
        ctx.addIssue({
          code: 'custom',
          path: ['recordResult'],
          message: 'Result kind must match its mill, draw or capture instruction',
        });
      if (action === 'CAPTURE_WINDOW' && !value.recordResult) {
        ctx.addIssue({ code: 'custom', path: ['recordResult'], message: 'Capture requires a named captured result' });
      }
      if (
        ['CAPTURE_WINDOW', 'SET_COLLECTION_VISIBILITY'].includes(action) &&
        (value.choice ||
          value.targetGroup ||
          value.recordOutcome ||
          value.onKill ||
          (value.targeting &&
            (value.targeting.type !== 'self' ||
              value.targeting.required ||
              Object.keys(value.targeting).some((key) => !['type', 'required'].includes(key)))))
      ) {
        ctx.addIssue({ code: 'custom', message: 'Collection instructions do not accept targeting or outcome choices' });
      }
      if (
        action === 'CREATE_TOKEN' &&
        value.targeting &&
        ((value.targeting.type !== 'player' && value.targeting.type !== 'self') || value.targeting.subject === 'source')
      ) {
        ctx.addIssue({ code: 'custom', path: ['targeting'], message: 'Token creation recipients must be players' });
      }
      if (action === 'DISCARD_RANDOM_FROM_HAND' && (
        value.choice || (value.targeting &&
          (value.targeting.type !== 'player' && value.targeting.type !== 'self' || value.targeting.subject === 'source'))
      )) {
        ctx.addIssue({ code: 'custom', message: 'Random discard takes player recipients and no card choice' });
      }
      if (action === 'MOVE_ZONE' && value.params?.from && (value.choice || value.targeting || value.targetGroup)) {
        ctx.addIssue({ code: 'custom', message: 'Automatic result moves cannot use targeting or a choice' });
      }
      if (action === 'CREATE_CONTINUOUS_EFFECT' && value.params?.scope && (value.targeting || value.targetGroup)) {
        ctx.addIssue({ code: 'custom', path: ['params', 'scope'], message: 'Use either a scope or targeting' });
      }
      const parsed = parameters[action as InstructionAction].safeParse(value.params ?? {});
      if (!parsed.success)
        for (const issue of parsed.error.issues)
          ctx.addIssue({
            code: 'custom',
            path: ['params', ...issue.path],
            message: issue.message,
          });
    }),
);
const modeFields = {
  id: Identifier,
  label: z.string().optional(),
  castSpeed: speed.optional(),
  effects: z.array(AuthoredEffectSchema),
};
export const AbilityUsageSchema = UsageSchema.extend({ consume: z.literal('on_commit') });
export type AbilityUsage = z.infer<typeof AbilityUsageSchema>;
const ModeSchema = z.strictObject(modeFields);
const ResolutionOptionSchema = z.strictObject({ ...modeFields, usage: AbilityUsageSchema.optional() });
export const ChoiceSchema: z.ZodType = z.lazy(() =>
  z.discriminatedUnion('kind', [
    z.strictObject({ kind: z.literal('optional'), prompt: z.string().optional() }),
    z.strictObject({ kind: z.literal('discard'), prompt: z.string().optional() }),
    z.strictObject({
      kind: z.enum(['options', 'ordering']),
      options: z.array(ResolutionOptionSchema),
      min: Count.optional(),
      max: Count.optional(),
      prompt: z.string().optional(),
    }).refine(v => v.kind !== 'ordering' || !v.options.some(option => option.usage), 'Only selectable options may have a use limit'),
    z.strictObject({
      ...FilterFields,
      kind: z.literal('search'),
      zone: Zone,
      zonePlayer: PlayerRelation.optional(),
      cardRefs: z.array(z.strictObject({ cardUuid: Identifier, zoneRevision: Count })).optional(),
      from: CardResultSourceSchema.extend({ view: z.literal('current').optional() }).optional(),
      allAvailable: z.boolean().optional(),
      recordSelection: CardResultDefinitionSchema.shape.name.optional(),
      distinctBy: z.literal('printed_name').optional(),
      min: Count.optional(),
      max: Count.optional(),
      prompt: z.string().optional(),
      ordered: z.boolean().optional(),
    }).refine(v => !v.allAvailable || !v.distinctBy, 'Ordering all available cards cannot also require distinct names'),
    z.strictObject({ kind: z.literal('selection'), criteria: TargetSchema, prompt: z.string().optional() }),
    z.strictObject({
      kind: z.literal('distribution'),
      total: Count,
      field: Identifier.optional(),
      prompt: z.string().optional(),
    }),
  ]),
);
const ListenerZones = z
  .array(Zone)
  .min(1)
  .refine((zones) => new Set(zones).size === zones.length, 'Duplicate listener zone');
export const TriggerListenerSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('event_card'), state: z.enum(['before', 'after']), zones: ListenerZones }),
  z.strictObject({ kind: z.literal('watcher'), activeZones: ListenerZones }),
]);
export type TriggerListener = z.infer<typeof TriggerListenerSchema>;
const TriggerFilterSchema = z
  .strictObject({
    listener: TriggerListenerSchema.optional(),
    cause: z.enum(['self', 'controller', 'any']).optional(),
    subject: z.enum(['self', 'another', 'any']).optional(),
    controller: PlayerRelation.optional(),
    cardTypes: z.array(Identifier).optional(),
    subTypes: z.array(Identifier).optional(),
    condition: ConditionSchema.optional(),
  })
  .superRefine((filter, ctx) => {
    if (filter.listener?.kind === 'event_card' && filter.subject !== undefined && filter.subject !== 'self')
      ctx.addIssue({ code: 'custom', path: ['subject'], message: 'An event_card listener can only have subject self' });
  });
function validateListenerEvent(
  ability: { type: string; triggerCondition?: string; trigger?: { listener?: { kind: string } } },
  ctx: z.RefinementCtx,
): void {
  if (
    ability.type === 'triggered' &&
    ability.trigger?.listener?.kind === 'event_card' &&
    ['ON_SHUFFLE', 'BEGIN_UPKEEP', 'BEGIN_DRAW_STEP', 'END_OF_TURN', 'ON_LIFE_GAIN', 'ON_LIFE_LOSS', 'COMBAT_DAMAGE'].includes(
      ability.triggerCondition ?? '',
    )
  )
    ctx.addIssue({
      code: 'custom',
      path: ['trigger', 'listener'],
      message: 'This event has no individual card subject; use a watcher',
    });
}
const commonAbility = {
  id: Identifier,
  immediate: z.boolean().optional(),
  usage: AbilityUsageSchema.optional(),
  limitPerTurn: Count.min(1).optional(),
  castSpeed: speed.optional(),
  modes: z.array(ModeSchema).optional(),
  modeCount: z.strictObject({ min: Count, max: Count }).optional(),
};
const staticFields = {
  id: Identifier,
  type: z.literal('static'),
  activeZones: z.array(Zone).optional(),
  characteristicDefining: z.boolean().optional(),
  effects: z
    .array(
      z.strictObject({
        group: Identifier.optional(),
        layer: z.number().int(),
        scope: ScopeSchema,
        effect: ContinuousOperationSchema,
        condition: ConditionSchema.optional(),
      }),
    )
    .optional(),
  rules: z.array(ModifierDefinitionSchema).optional(),
};
const activeFields = {
  ...commonAbility,
  type: z.literal('activated'),
  cost: CostSchema.optional(),
  allowedZones: z.array(z.enum(['hand', 'battlefield'])).optional(),
  numericDeclarations: z.array(NumericDeclarationSchema).optional(),
  ...CostRouteFields,
};
const triggeredFields = {
  ...commonAbility,
  type: z.literal('triggered'),
  triggerCondition: triggerEvent,
  trigger: TriggerFilterSchema.optional(),
  sharedPerEvent: z.boolean().optional(),
  interveningIf: ConditionSchema.optional(),
};
export const RawAbilitySchema: z.ZodType = z.lazy(() =>
  z
    .discriminatedUnion('type', [
      z.strictObject({ ...staticFields, effects: z.never().optional() }),
      z.strictObject({
        ...activeFields,
        effect: AuthoredEffectSchema.optional(),
        effects: z.array(AuthoredEffectSchema).min(1).optional(),
      }),
      z.strictObject({
        ...triggeredFields,
        effect: AuthoredEffectSchema.optional(),
        effects: z.array(AuthoredEffectSchema).min(1).optional(),
      }),
    ])
    .superRefine((ability, ctx) => {
      validateListenerEvent(ability, ctx);
      if (ability.type === 'static') {
        if (!ability.rules?.length)
          ctx.addIssue({
            code: 'custom',
            path: ['rules'],
            message: 'Static ability requires rules',
          });
        const ids = ability.rules?.map((rule) => rule.id) ?? [];
        if (new Set(ids).size !== ids.length)
          ctx.addIssue({
            code: 'custom',
            path: ['rules'],
            message: 'Duplicate modifier rule ID',
          });
      } else if (!!ability.effects === !!ability.effect)
        ctx.addIssue({
          code: 'custom',
          path: ['effect'],
          message: 'Choose exactly one instruction or ordered effects',
        });
    }),
);
export const NormalizedAbilitySchema: z.ZodType = z.lazy(() =>
  z
    .discriminatedUnion('type', [
      z.strictObject(staticFields),
      z.strictObject({
        ...activeFields,
        effect: AuthoredEffectSchema.optional(),
        effects: z.array(AuthoredEffectSchema).min(1).optional(),
      }),
      z.strictObject({
        ...triggeredFields,
        effect: AuthoredEffectSchema.optional(),
        effects: z.array(AuthoredEffectSchema).min(1).optional(),
      }),
    ])
    .superRefine((ability, ctx) => {
      validateListenerEvent(ability, ctx);
      if (ability.type === 'static') {
        if (!ability.rules?.length && !ability.effects?.length)
          ctx.addIssue({
            code: 'custom',
            path: ['rules'],
            message: 'Static ability requires rules or compiled effects',
          });
        const ids = ability.rules?.map((rule) => rule.id) ?? [];
        if (new Set(ids).size !== ids.length)
          ctx.addIssue({
            code: 'custom',
            path: ['rules'],
            message: 'Duplicate modifier rule ID',
          });
      } else if (!!ability.effects === !!ability.effect)
        ctx.addIssue({
          code: 'custom',
          path: ['effect'],
          message: 'Choose exactly one instruction or ordered effects',
        });
    }),
);
const cardFields = {
  id: Identifier,
  name: z.string().optional(),
  cardTypes: z.array(CardTypeSchema).optional(),
  subTypes: z.array(Identifier).optional(),
  superTypes: z.array(Identifier).optional(),
  colors: z.array(z.enum(['white', 'blue', 'green', 'black', 'red', 'yellow'])).optional(),
  rulesText: z.string().optional(),
  keywords: z.array(Identifier).optional(),
  entersTapped: z.boolean().optional(),
  landPlacement: z.literal('paid').optional(),
  power: z.number().finite().optional(),
  toughness: z.number().finite().optional(),
  attachmentRequirements: TargetSchema.optional(),
  numericDeclarations: z.array(NumericDeclarationSchema).optional(),
  modes: z.array(ModeSchema).optional(),
  modeCount: z.strictObject({ min: Count, max: Count }).optional(),
};
const requirements = {
  allowedZones: z.array(Zone).optional(),
  speed: speed.optional(),
  cost: CostSchema.optional(),
  condition: ActionConditionSchema.optional(),
  ...CostRouteFields,
};
export const RawCardSchema: z.ZodType = z.lazy(() =>
  z.strictObject({
    ...cardFields,
    schemaVersion: z.literal(1),
    manaCost: z
      .string()
      .regex(/^(?:\{(?:[WUBRGYX]|\d+)\})*$/)
      .optional(),
    castRequirements: z.strictObject(requirements).optional(),
    abilities: z.array(RawAbilitySchema).optional(),
    onCastEffects: z.array(AuthoredEffectSchema).optional(),
    onEnterEffects: z.array(AuthoredEffectSchema).optional(),
  }),
);
export const NormalizedBlueprintSchema: z.ZodType = z.lazy(() =>
  z.strictObject({
    ...cardFields,
    castRequirements: z.strictObject(requirements),
    abilities: z.array(NormalizedAbilitySchema),
    onCastEffects: z.array(AuthoredEffectSchema).optional(),
    onEnterEffects: z.array(AuthoredEffectSchema).optional(),
  }),
);

export class RuleContractError extends Error {
  constructor(
    readonly definitionPath: string,
    detail: string,
  ) {
    super(`${definitionPath}: ${detail}`);
    this.name = 'RuleContractError';
  }
}
/** Validate `input` against `schema`, reporting the first issue as a `RuleContractError`. */
export function parseContract<T>(schema: z.ZodType<T>, input: unknown, path: string): T {
  try {
    assertDefinitionTree(input);
  } catch (error) {
    throw new RuleContractError(path, (error as Error).message);
  }
  const result = schema.safeParse(input);
  if (!result.success) {
    const issue = result.error.issues[0];
    throw new RuleContractError([path, ...issue.path].join('.'), issue.message);
  }
  return result.data;
}
/** Reject a modifier whose conditions reference fields its family cannot see. */
export function assertModifierContext(rule: ModifierDefinition, path: string): void {
  const allowed = new Set([
    'source',
    'target',
    'controller',
    'room',
    'history',
    ...(rule.family === 'event-replacements' ? ['event'] : []),
    ...(rule.family === 'costs' ? ['actorId'] : []),
  ]);
  const visit = (v: unknown, at: string) => {
    if (!v || typeof v !== 'object') return;
    if ('kind' in v && v.kind === 'binding') throw new RuleContractError(at, 'Modifier has no announced binding owner');
    if ('kind' in v && v.kind === 'result')
      throw new RuleContractError(at, 'Modifier cannot retain a resolution-local result');
    if ('path' in v && typeof v.path === 'string' && !allowed.has(v.path.split('.')[0]))
      throw new RuleContractError(at + '.path', 'Field is unavailable in this rule context');
    for (const [key, child] of Object.entries(v)) visit(child, at + '.' + key);
  };
  visit(rule.condition, path + '.condition');
  visit(rule.scope, path + '.scope');
  if (rule.family === 'costs' && 'amount' in rule.operation) visit(rule.operation.amount, path + '.operation.amount');
  if (
    rule.family === 'characteristics' &&
    (rule.operation.type === 'STAT_DELTA' || rule.operation.type === 'SET_STATS')
  ) {
    visit(rule.operation.power, path + '.operation.power');
    visit(rule.operation.toughness, path + '.operation.toughness');
  }
  if (rule.family === 'event-replacements') {
    const op = rule.operation.type;
    const validEvents =
      op === 'prevent_damage' || op === 'damage_scale' || op === 'redirect_damage' || op === 'reduce_damage'
        ? ['damage']
        : op === 'regenerate'
          ? ['destroy']
          : op === 'move_destination'
            ? ['zone_transfer', 'destroy', 'sacrifice', 'discard', 'draw']
            : undefined;
    if (validEvents && rule.events.some((event) => !validEvents.includes(event)))
      throw new RuleContractError(path + '.events', 'Operation does not support this event family');
  }
}
/** Parse and cross-check one authored modifier definition. */
export function parseModifierDefinition(input: unknown, path = 'modifier'): ModifierDefinition {
  const rule = parseContract(ModifierDefinitionSchema, input, path);
  assertModifierContext(rule, path);
  return rule;
}
/** Parse one authored effect, resolving its family/operation pair to an action id. */
export function parseAuthoredEffect(input: unknown, path = 'effect'): Record<string, unknown> {
  const raw = parseContract(AuthoredEffectSchema, input, path) as Record<string, unknown>;
  if ('action' in raw) return raw;
  const action = Object.entries(InstructionNames).find(
    ([, pair]) => pair[0] === raw.family && pair[1] === raw.operation,
  )![0];
  const { family: _family, operation: _operation, ...fields } = raw;
  return { action, ...fields };
}
