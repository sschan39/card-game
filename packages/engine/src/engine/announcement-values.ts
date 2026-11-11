import type { CardInstance, CardBlueprint, ActivatedAbility } from '../types/card.types';
import type { ActionCost, AuthoredActionCost, EffectDefinition, ModeDefinition, CostRoutes } from '../types/effect.types';
import type { NumericBindings, NumericDeclaration } from '../types/numeric-value.types';
import type { ActionData } from './action-registry';
import { assertAnnouncementCost, assertCostRoutes, assertEffectNumericDefinition, assertNumericDeclarations } from '../library/card-definition-validator';
import { evaluateNumericValue } from './numeric-values';
import { composeActionCosts } from './cost-composition';
import { abilityEffects } from './ability-effects';
import type { GameRoom } from '../types/game.room.types';
import { applyCostRules } from '../rules/runtime/costs';
import { ruleUseAvailable, type RuleUse } from '../rules/runtime/active-rules';
import { abilityUsage } from './ability-usage';

export interface AnnouncementDefinition extends CostRoutes {
  abilityId?: string;
  usage?: CardBlueprint['castRequirements']['usage'];
  numericDeclarations?: NumericDeclaration[];
  cost?: AuthoredActionCost;
  effects: EffectDefinition[];
  modes?: ModeDefinition[];
  modeCount?: { min: number; max: number };
}
export const spellAnnouncementDefinition = (blueprint: CardBlueprint): AnnouncementDefinition => ({
  usage: blueprint.castRequirements.usage,
  numericDeclarations: blueprint.numericDeclarations,
  cost: blueprint.castRequirements.cost,
  alternativeCosts: blueprint.castRequirements.alternativeCosts,
  additionalCost: blueprint.castRequirements.additionalCost,
  effects: blueprint.onCastEffects ?? [],
  modes: blueprint.modes,
  modeCount: blueprint.modeCount,
});

export const abilityAnnouncementDefinition = (ability: ActivatedAbility): AnnouncementDefinition => ({
  abilityId: ability.id,
  numericDeclarations: ability.numericDeclarations,
  cost: ability.cost,
  alternativeCosts: ability.alternativeCosts,
  additionalCost: ability.additionalCost,
  effects: abilityEffects(ability),
  modes: ability.modes,
  modeCount: ability.modeCount,
});

export interface AnnouncementSnapshot {
  costRules?: unknown[];
  source: { uuid: string; zone: string; zoneRevision: number };
  definition: AnnouncementDefinition;
}

const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

/** Deep structural equality that ignores explicitly-undefined fields. */
function equal(left: unknown, right: unknown): boolean {
  if (left === right) return true;

  // Arrays compare element-wise; anything else non-object is unequal.
  if (!object(left) || !object(right)) {
    return Array.isArray(left) && Array.isArray(right) && left.length === right.length && left.every((value, index) => equal(value, right[index]));
  }

  const keys = Object.keys(left).filter((key) => left[key] !== undefined);

  return keys.length === Object.keys(right).filter((key) => right[key] !== undefined).length &&
    keys.every((key) => Object.prototype.hasOwnProperty.call(right, key) && equal(left[key], right[key]));
}

/** Only generic mana is authored; the payment planner always receives concrete costs. */
export function materializeAnnouncementCost(cost: AuthoredActionCost = {}, bindings: NumericBindings = {}): ActionCost {
  const { mana, ...fixed } = cost;
  if (!mana) return { ...fixed };

  const { generic, ...colors } = mana;
  if (generic === undefined) return { ...fixed, mana: { ...colors } };

  const result = evaluateNumericValue(generic, { bindings });

  // Guard: an authored generic cost must resolve to a non-negative integer.
  if (!result.ok || !Number.isSafeInteger(result.value) || result.value < 0) throw new Error('Invalid generic mana requirement');

  return { ...fixed, mana: { ...colors, generic: result.value } };
}

/** Validates an unfinished announcement without choices, payment or room mutation. */
export function prepareAnnouncement(source: CardInstance, definition: AnnouncementDefinition, data: ActionData, context?: { room: GameRoom; playerId: string }):
  | { success: true; bindings: NumericBindings; missing?: NumericDeclaration; missingCostRoute?: boolean; cost?: ActionCost; snapshot: AnnouncementSnapshot; ruleUses?: RuleUse[] }
  | { success: false; reason: string } {
  try {
    // Validate the authored definition before trusting any client input.
    const declarations = definition.numericDeclarations ?? [];
    assertNumericDeclarations(declarations);
    assertAnnouncementCost(definition.cost, declarations);
    assertCostRoutes(definition, declarations);

    definition.effects.forEach((effect) => assertEffectNumericDefinition(effect, declarations));
    definition.modes?.forEach((mode) => mode.effects.forEach((effect) => assertEffectNumericDefinition(effect, declarations)));

    const snapshot: AnnouncementSnapshot = {
      source: { uuid: source.uuid, zone: source.state.zone, zoneRevision: source.state.zoneRevision ?? 0 },
      definition,
    };

    const use = context && abilityUsage(source, { id: 'cast', usage: definition.usage }, context.playerId);
    if (context && use && !ruleUseAvailable(context.room, use)) throw new Error('Spell use limit reached');

    // Cost rules can change the price, so their signature is part of the snapshot.
    if (context) {
      const signature = applyCostRules(context.room, context.playerId, source, {}).signature;
      if (signature.length) snapshot.costRules = signature;
    }

    // Guard: the client must be announcing against the same source and definition.
    if (data.announcement !== undefined && !equal(data.announcement, snapshot)) {
      throw new Error('Announcement source or definition changed; cancel and restart');
    }
    const supplied = data.numericBindings === undefined ? {} : data.numericBindings;
    if (!object(supplied)) throw new Error('Invalid numeric binding record');

    // Guard: every supplied binding must name a declaration and sit in its range.
    for (const [name, value] of Object.entries(supplied)) {
      const declaration = declarations.find((entry) => entry.name === name);

      if (
        !declaration ||
        typeof value !== 'number' ||
        !Number.isSafeInteger(value) ||
        value < declaration.min ||
        (declaration.max !== undefined && value > declaration.max)
      ) {
        throw new Error('Invalid announced numeric binding');
      }
    }

    const bindings = { ...supplied } as NumericBindings;
    const missing = declarations.find((entry) => !Object.prototype.hasOwnProperty.call(bindings, entry.name));

    // Resolve which cost route the player chose.
    const route = data.costRoute;
    let selected = definition.cost;
    const missingCostRoute = !!definition.alternativeCosts?.length && route === undefined;

    if (route !== undefined) {
      // Guard: the route must be a well-formed base or alternative selection.
      if (
        !object(route) ||
        (route.kind !== 'base' && route.kind !== 'alternative') ||
        Object.keys(route).some((key) => !(route.kind === 'base' ? ['kind'] : ['kind', 'id']).includes(key))
      ) {
        throw new Error('Invalid cost route selection');
      }

      if (route.kind === 'alternative') {
        const alternative = definition.alternativeCosts?.find((entry) => entry.id === route.id);
        if (!alternative) throw new Error('Unknown alternative cost route');

        selected = alternative.cost;
      }
    }

    // Only materialize the cost once every declaration and route is known.
    let cost: ActionCost | undefined;
    let ruleUses: RuleUse[] = use ? [use] : [];

    if (!missing && !missingCostRoute) {
      cost = materializeAnnouncementCost(selected, bindings);

      if (context && snapshot.costRules?.length) {
        const adjusted = applyCostRules(
          context.room,
          context.playerId,
          source,
          cost,
          materializeAnnouncementCost(definition.additionalCost, bindings),
        );

        cost = adjusted.cost;
        ruleUses = [...ruleUses, ...adjusted.uses];
      } else if (definition.additionalCost !== undefined || definition.alternativeCosts !== undefined) {
        cost = composeActionCosts([cost, materializeAnnouncementCost(definition.additionalCost, bindings)]);
      }
    }

    return { success: true, bindings, missing, missingCostRoute, cost, snapshot: structuredClone(snapshot), ...(ruleUses.length ? { ruleUses } : {}) };
  } catch (error) {
    return { success: false, reason: error instanceof Error ? error.message : 'Invalid announcement' };
  }
}
