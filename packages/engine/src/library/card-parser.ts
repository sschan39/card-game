// src/library/card-parser.ts
import type {
  CardBlueprint,
  CardAbility,
  ActivatedAbility,
  TriggeredAbility,
  CardType,
  CardZone,
  ManaColor,
} from '../types/card.types';
import type { AuthoredActionCost, EffectDefinition, CostRoutes } from '../types/effect.types';
import type { NumericDeclaration, NumericValue } from '../types/numeric-value.types';
import {
  assertAnnouncementCost,
  assertCostRoutes,
  assertNumericDeclarations,
  assertEffectNumericDefinition,
  assertAbilityNumericDefinition,
  assertBlueprintNumericDefinition,
} from './card-definition-validator';
import {
  parseContract,
  parseModifierDefinition,
  RawAbilitySchema,
  RawCardSchema,
  type ModifierDefinition,
} from '../rules/schema/contracts';
import { compileInstruction, compileStaticRules } from '../rules/schema/compile';

/**
 * Parse supported mana symbols into an authored cost; {X} requires an explicit declaration.
 * Supported symbols are {W}{U}{B}{R}{G}{Y}, numeric {N}, and {X}.
 *
 * Examples:
 *   "{R}"        => { red: 1 }
 *   "{4}{R}{R}"  => { generic: 4, red: 2 }
 *   "{0}"        => { generic: 0 }
 *   ""           => {}
 */
export function parseManaCost(raw: string): NonNullable<AuthoredActionCost['mana']> {
  if (!raw) return {};

  if (!/^(?:\{(?:[WUBRGYX]|\d+)\})+$/.test(raw)) throw new Error('Unsupported mana cost: ' + raw);
  const cost: NonNullable<AuthoredActionCost['mana']> = {};
  // X becomes the same named binding used by other numeric consumers.
  const re = /\{([WUBRGYX]|\d+)\}/g;
  let match: RegExpExecArray | null;

  while ((match = re.exec(raw)) !== null) {
    const symbol = match[1];
    if (symbol === 'X' || /^\d+$/.test(symbol)) {
      // Numeric requirements can be paid by any mana color.
      const value: NumericValue = symbol === 'X' ? { numeric: { kind: 'binding', name: 'X' } } : parseInt(symbol, 10);
      cost.generic =
        cost.generic === undefined
          ? value
          : typeof cost.generic === 'number' && typeof value === 'number'
            ? cost.generic + value
            : { numeric: { kind: 'add', left: cost.generic, right: value } };
    } else if (symbol === 'Y') {
      cost.yellow = (cost.yellow ?? 0) + 1;
    } else {
      const colorMap: Record<string, ManaColor> = {
        W: 'white',
        U: 'blue',
        B: 'black',
        R: 'red',
        G: 'green',
      };
      const color = colorMap[symbol];
      cost[color] = (cost[color] ?? 0) + 1;
    }
  }

  return cost;
}

/** Normalize authored cost fields without spending resources. */
export function normalizeActionCost(
  cost: Record<string, unknown> | undefined,
  declarations: NumericDeclaration[] = [],
): AuthoredActionCost {
  assertAnnouncementCost(cost as AuthoredActionCost | undefined, declarations);
  if (!cost) return { mana: {}, tap: false, life: 0, discard: 0, sacrifice: false };

  return {
    mana: (cost.mana as AuthoredActionCost['mana']) || {},
    tap: !!cost.tap,
    untap: !!cost.untap,
    life: typeof cost.life === 'number' ? cost.life : 0,
    discard: typeof cost.discard === 'number' ? cost.discard : 0,
    ...(cost.discardSelf !== undefined ? { discardSelf: cost.discardSelf as boolean } : {}),
    sacrifice: !!cost.sacrifice,
    ...(cost.destroyMaterials
      ? { destroyMaterials: structuredClone(cost.destroyMaterials) as AuthoredActionCost['destroyMaterials'] }
      : {}),
    ...(cost.exileMaterials
      ? { exileMaterials: structuredClone(cost.exileMaterials) as AuthoredActionCost['exileMaterials'] }
      : {}),
    ...(cost.removeCounters
      ? {
          removeCounters: structuredClone(cost.removeCounters) as AuthoredActionCost['removeCounters'],
        }
      : {}),
    ...(typeof cost.loyalty === 'number' ? { loyalty: cost.loyalty } : {}),
  };
}

/** Validate and compile one instruction and its nested payment branch. */
export function parseInstructionDefinition(
  raw: Record<string, unknown>,
  declarations: NumericDeclaration[] = [],
): EffectDefinition {
  raw = compileInstruction(raw);
  const effect: EffectDefinition = {
    ...(raw.onKill ? { onKill: structuredClone(raw.onKill) as EffectDefinition['onKill'] } : {}),
    ...(raw.recordResult
      ? {
          recordResult: structuredClone(raw.recordResult) as EffectDefinition['recordResult'],
        }
      : {}),
    ...(raw.condition ? { condition: structuredClone(raw.condition) as EffectDefinition['condition'] } : {}),
    ...(raw.recordOutcome
      ? {
          recordOutcome: structuredClone(raw.recordOutcome) as EffectDefinition['recordOutcome'],
        }
      : {}),
    ...(typeof raw.requiresOutcome === 'string' ? { requiresOutcome: raw.requiresOutcome } : {}),
    ...(raw.choice ? { choice: raw.choice as EffectDefinition['choice'] } : {}),
    ...(typeof raw.targetGroup === 'string' ? { targetGroup: raw.targetGroup } : {}),
    action: raw.action as string,
    params: (raw.params as Record<string, unknown>) || {},
    tags: (raw.tags as string[]) || [],
    targeting: (raw.targeting as EffectDefinition['targeting']) || { type: 'self', required: false },
  };
  if (effect.action === 'PAY_COST') {
    effect.params.cost = normalizeActionCost(effect.params.cost as Record<string, unknown>, declarations);
    effect.params.then = (effect.params.then as Record<string, unknown>[]).map((child) => {
      const parsed = parseInstructionDefinition(child, declarations);
      const target = parsed.targeting;
      const choosesAtResolution = parsed.choice?.kind === 'selection' || parsed.choice?.kind === 'search';
      if (target.type !== 'self' && !target.all && !choosesAtResolution) {
        throw new Error('Paid branch targets require a resolution selection or search choice');
      }
      return parsed;
    });
  }
  assertEffectNumericDefinition(effect, declarations);
  return effect;
}

function normalizeCostRoutes(raw: Record<string, unknown>, declarations: NumericDeclaration[]): CostRoutes {
  const routes = { alternativeCosts: raw.alternativeCosts, additionalCost: raw.additionalCost } as CostRoutes;
  assertCostRoutes(routes, declarations);
  return {
    ...(routes.alternativeCosts !== undefined
      ? {
          alternativeCosts: routes.alternativeCosts.map((route) => ({
            id: route.id,
            label: route.label,
            cost: normalizeActionCost(route.cost as Record<string, unknown>, declarations),
          })),
        }
      : {}),
    ...(routes.additionalCost !== undefined
      ? {
          additionalCost: normalizeActionCost(routes.additionalCost as Record<string, unknown>, declarations),
        }
      : {}),
  };
}

/** Parse an authored ability through the shared strict contracts. */
export function parseAbilityDefinition(ability: Record<string, unknown>): CardAbility | null {
  ability = parseContract(RawAbilitySchema, ability, 'ability') as Record<string, unknown>;

  const type = ability.type as string;
  const declarations =
    ability.numericDeclarations === undefined ? [] : (ability.numericDeclarations as NumericDeclaration[]);
  assertNumericDeclarations(declarations);
  if (type === 'static') {
    const rules = (ability.rules as ModifierDefinition[]).map((rule, i) =>
      parseModifierDefinition(rule, `ability.${ability.id}.rules.${i}`),
    );
    const effects = compileStaticRules(rules);
    const normalized: CardAbility = {
      id: ability.id as string,
      type: 'static',
      ...(ability.activeZones ? { activeZones: structuredClone(ability.activeZones) as CardZone[] } : {}),
      ...(ability.characteristicDefining ? { characteristicDefining: true } : {}),
      rules: structuredClone(rules),
      effects,
    };
    assertAbilityNumericDefinition(normalized);
    return normalized;
  }
  const ordered = Array.isArray(ability.effects)
    ? ability.effects.map((raw) => parseInstructionDefinition(raw as Record<string, unknown>, declarations))
    : undefined;
  // Single and ordered instructions share the same strict contract and compiler.
  const effect: EffectDefinition = ability.effect
    ? parseInstructionDefinition(ability.effect as Record<string, unknown>, declarations)
    : { action: '', params: {}, tags: [], targeting: { type: 'self', required: false } };

  const base = {
    ...(ability.immediate === true ? { immediate: true } : {}),
    ...(ability.usage
      ? {
          usage: structuredClone(ability.usage) as import('../rules/schema/contracts').AbilityUsage,
        }
      : {}),
    ...(ability.limitPerTurn !== undefined ? { limitPerTurn: ability.limitPerTurn as number } : {}),
    ...(Array.isArray(ability.modes)
      ? {
          modes: normalizeModes(ability.modes as Record<string, unknown>[], declarations),
        }
      : {}),
    ...(ability.modeCount ? { modeCount: ability.modeCount as { min: number; max: number } } : {}),
    id: typeof ability.id === 'string' && ability.id.trim() ? ability.id : '',
    ...(ordered ? { effects: ordered } : { effect }),
    castSpeed: (ability.castSpeed as 'instant' | 'sorcery') || 'instant',
  };

  if (type === 'triggered') {
    const normalized = {
      type: 'triggered',
      ...(ability.sharedPerEvent === true ? { sharedPerEvent: true } : {}),
      ...(ability.trigger ? { trigger: structuredClone(ability.trigger) as TriggeredAbility['trigger'] } : {}),
      ...(ability.interveningIf
        ? {
            interveningIf: structuredClone(ability.interveningIf) as TriggeredAbility['interveningIf'],
          }
        : {}),
      triggerCondition: ability.triggerCondition as TriggeredAbility['triggerCondition'],
      ...base,
    } as TriggeredAbility;
    assertAbilityNumericDefinition(normalized);
    return normalized;
  }

  const normalized = {
    type: 'activated',
    ...(ability.allowedPhases ? { allowedPhases: structuredClone(ability.allowedPhases) as ActivatedAbility['allowedPhases'] } : {}),
    ...(ability.allowedZones !== undefined
      ? {
          allowedZones: structuredClone(ability.allowedZones) as ActivatedAbility['allowedZones'],
        }
      : {}),
    ...(declarations.length ? { numericDeclarations: structuredClone(declarations) } : {}),
    cost: normalizeActionCost(ability.cost as Record<string, unknown> | undefined, declarations),
    ...normalizeCostRoutes(ability, declarations),
    ...base,
  } as ActivatedAbility;
  assertAbilityNumericDefinition(normalized);
  return normalized;
}

/** Build a normalized blueprint from an authored card definition. */
export function parseCardDefinition(raw: Record<string, unknown>): CardBlueprint {
  raw = parseContract(RawCardSchema, raw, typeof raw?.id === 'string' ? raw.id : 'card') as Record<string, unknown>;

  // Mana cost lives at the top level of the card JSON (e.g. "{4}{R}{R}"),
  // not inside castRequirements.cost. Parse it and inject into the cost.
  const declarations = raw.numericDeclarations === undefined ? [] : (raw.numericDeclarations as NumericDeclaration[]);
  assertNumericDeclarations(declarations);
  const manaCost = parseManaCost((raw.manaCost as string) || '');
  const castUsage = (raw.castRequirements as Record<string, unknown> | undefined)?.usage;
  const castPhases = (raw.castRequirements as Record<string, unknown> | undefined)?.allowedPhases;
  const castCost = normalizeActionCost(
    (raw.castRequirements as Record<string, unknown>)?.cost as Record<string, unknown> | undefined,
    declarations,
  );
  if (Object.keys(manaCost).length > 0) {
    castCost.mana = manaCost;
  }

  const abilities = ((raw.abilities as Record<string, unknown>[]) || [])
    .map(parseAbilityDefinition)
    .filter((a): a is CardAbility => a !== null);
  const ids = new Set<string>();
  for (const ability of abilities) {
    if (!ability.id || ids.has(ability.id))
      throw new Error(`[CardParser] Missing or duplicate ability ID on ${raw.id}`);
    ids.add(ability.id);
  }

  const blueprint: CardBlueprint = {
    ...(declarations.length ? { numericDeclarations: structuredClone(declarations) } : {}),
    id: raw.id as string,
    name: (raw.name as string) || '',
    cardTypes: (raw.cardTypes as CardType[]) || [],
    subTypes: (raw.subTypes as string[]) || [],
    ...(raw.entersTapped === true ? { entersTapped: true } : {}),
    ...(raw.landPlacement === 'paid' ? { landPlacement: 'paid' as const } : {}),
    ...(raw.superTypes ? { superTypes: raw.superTypes as string[] } : {}),
    ...(raw.attachmentRequirements
      ? {
          attachmentRequirements: structuredClone(
            raw.attachmentRequirements,
          ) as import('../types/effect.types').TargetingDefinition,
        }
      : {}),
    keywords: (raw.keywords as string[]) || [],
    ...(Array.isArray(raw.colors) ? { colors: raw.colors as ManaColor[] } : {}),
    rulesText: (raw.rulesText as string) || '',
    power: raw.power as number | undefined,
    toughness: raw.toughness as number | undefined,
    ...(Array.isArray(raw.modes)
      ? {
          modes: normalizeModes(raw.modes as Record<string, unknown>[], declarations),
        }
      : {}),
    ...(raw.modeCount ? { modeCount: raw.modeCount as { min: number; max: number } } : {}),

    onCastEffects: ((raw.onCastEffects as Record<string, unknown>[]) || []).map((effect) =>
      parseInstructionDefinition(effect, declarations),
    ),
    onEnterEffects: ((raw.onEnterEffects as Record<string, unknown>[]) || []).map((effect) =>
      parseInstructionDefinition(effect),
    ),

    castRequirements: {
      ...(castPhases ? { allowedPhases: structuredClone(castPhases) as CardBlueprint['castRequirements']['allowedPhases'] } : {}),
      ...(castUsage ? { usage: structuredClone(castUsage) as NonNullable<CardBlueprint['castRequirements']['usage']> } : {}),
      allowedZones: ((raw.castRequirements as Record<string, unknown>)?.allowedZones as CardZone[]) || ['hand'],
      speed: ((raw.castRequirements as Record<string, unknown>)?.speed as 'instant' | 'sorcery') || 'sorcery',
      cost: castCost,
      ...normalizeCostRoutes((raw.castRequirements as Record<string, unknown>) ?? {}, declarations),
      condition: ((raw.castRequirements as Record<string, unknown>)?.condition as Record<string, unknown>) || undefined,
    },

    abilities,
  };
  assertBlueprintNumericDefinition(blueprint);
  return blueprint;
}

/** Parse an explicit catalog map, preserving canonical IDs. */
export function parseAll(rawMap: Record<string, Record<string, unknown>>): Record<string, CardBlueprint> {
  const out: Record<string, CardBlueprint> = {};
  Object.keys(rawMap).forEach((k) => {
    out[k] = parseCardDefinition(rawMap[k]);
  });
  return out;
}

function normalizeModes(modes: Record<string, unknown>[], declarations: NumericDeclaration[] = []) {
  const ids = new Set<string>();
  return modes.map((mode) => {
    if (typeof mode.id !== 'string' || !mode.id.trim() || ids.has(mode.id))
      throw new Error('Missing or duplicate mode ID');
    ids.add(mode.id);
    return {
      id: mode.id,
      label: typeof mode.label === 'string' ? mode.label : mode.id,
      ...(mode.castSpeed !== undefined ? { castSpeed: mode.castSpeed as 'instant' | 'sorcery' } : {}),
      effects: (mode.effects as Record<string, unknown>[]).map((effect) =>
        parseInstructionDefinition(effect, declarations),
      ),
    };
  });
}
