import type { CardInstance, CardBlueprint, ActivatedAbility } from '../types/card.types';
import type { ActionCost, AuthoredActionCost, EffectDefinition, ModeDefinition, CostRoutes } from '../types/effect.types';
import type { NumericBindings, NumericDeclaration } from '../types/numeric-value.types';
import type { ActionData } from './action-registry';
import { assertAnnouncementCost, assertCostRoutes, assertEffectNumericDefinition, assertNumericDeclarations } from './numeric-definitions';
import { evaluateNumericValue } from './numeric-values';
import { composeActionCosts } from './cost-composition';

export interface AnnouncementDefinition extends CostRoutes {
  abilityId?: string;
  numericDeclarations?: NumericDeclaration[];
  cost?: AuthoredActionCost;
  effects: EffectDefinition[];
  modes?: ModeDefinition[];
  modeCount?: { min: number; max: number };
}
export const spellAnnouncementDefinition = (blueprint: CardBlueprint): AnnouncementDefinition => ({
  numericDeclarations: blueprint.numericDeclarations, cost: blueprint.castRequirements.cost,
  alternativeCosts: blueprint.castRequirements.alternativeCosts, additionalCost: blueprint.castRequirements.additionalCost,
  effects: blueprint.onCastEffects ?? [], modes: blueprint.modes, modeCount: blueprint.modeCount,
});
export const abilityAnnouncementDefinition = (ability: ActivatedAbility): AnnouncementDefinition => ({
  abilityId: ability.id, numericDeclarations: ability.numericDeclarations, cost: ability.cost,
  alternativeCosts: ability.alternativeCosts, additionalCost: ability.additionalCost,
  effects: [ability.effect], modes: ability.modes, modeCount: ability.modeCount,
});
export interface AnnouncementSnapshot {
  source: { uuid: string; zone: string; zoneRevision: number };
  definition: AnnouncementDefinition;
}
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
function equal(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (!object(left) || !object(right)) {
    return Array.isArray(left) && Array.isArray(right) && left.length === right.length && left.every((value, index) => equal(value, right[index]));
  }
  const keys = Object.keys(left).filter(key => left[key] !== undefined);
  return keys.length === Object.keys(right).filter(key => right[key] !== undefined).length && keys.every(key => Object.prototype.hasOwnProperty.call(right, key) && equal(left[key], right[key]));
}

/** Only generic mana is authored; the payment planner always receives concrete costs. */
export function materializeAnnouncementCost(cost: AuthoredActionCost = {}, bindings: NumericBindings = {}): ActionCost {
  const { mana, ...fixed } = cost;
  if (!mana) return { ...fixed };
  const { generic, ...colors } = mana;
  if (generic === undefined) return { ...fixed, mana: { ...colors } };
  const result = evaluateNumericValue(generic, { bindings });
  if (!result.ok || !Number.isSafeInteger(result.value) || result.value < 0) throw new Error('Invalid generic mana requirement');
  return { ...fixed, mana: { ...colors, generic: result.value } };
}

/** Validates an unfinished announcement without choices, payment or room mutation. */
export function prepareAnnouncement(source: CardInstance, definition: AnnouncementDefinition, data: ActionData):
  | { success: true; bindings: NumericBindings; missing?: NumericDeclaration; missingCostRoute?: boolean; cost?: ActionCost; snapshot: AnnouncementSnapshot }
  | { success: false; reason: string } {
  try {
    const declarations = definition.numericDeclarations ?? [];
    assertNumericDeclarations(declarations);
    assertAnnouncementCost(definition.cost, declarations);
    assertCostRoutes(definition, declarations);
    definition.effects.forEach(effect => assertEffectNumericDefinition(effect, declarations));
    definition.modes?.forEach(mode => mode.effects.forEach(effect => assertEffectNumericDefinition(effect, declarations)));
    const snapshot: AnnouncementSnapshot = { source: { uuid: source.uuid, zone: source.state.zone, zoneRevision: source.state.zoneRevision ?? 0 }, definition };
    if (data.announcement !== undefined && !equal(data.announcement, snapshot)) throw new Error('Announcement source or definition changed; cancel and restart');
    const supplied = data.numericBindings === undefined ? {} : data.numericBindings;
    if (!object(supplied)) throw new Error('Invalid numeric binding record');
    for (const [name, value] of Object.entries(supplied)) {
      const declaration = declarations.find(entry => entry.name === name);
      if (!declaration || typeof value !== 'number' || !Number.isSafeInteger(value) || value < declaration.min || (declaration.max !== undefined && value > declaration.max)) throw new Error('Invalid announced numeric binding');
    }
    const bindings = { ...supplied } as NumericBindings;
    const missing = declarations.find(entry => !Object.prototype.hasOwnProperty.call(bindings, entry.name));
    const route = data.costRoute;
    let selected = definition.cost;
    const missingCostRoute = !!definition.alternativeCosts?.length && route === undefined;
    if (route !== undefined) {
      if (!object(route) || (route.kind !== 'base' && route.kind !== 'alternative') ||
          Object.keys(route).some(key => !(route.kind === 'base' ? ['kind'] : ['kind', 'id']).includes(key))) throw new Error('Invalid cost route selection');
      if (route.kind === 'alternative') {
        const alternative = definition.alternativeCosts?.find(entry => entry.id === route.id);
        if (!alternative) throw new Error('Unknown alternative cost route');
        selected = alternative.cost;
      }
    }
    let cost: ActionCost | undefined;
    if (!missing && !missingCostRoute) {
      cost = materializeAnnouncementCost(selected, bindings);
      if (definition.additionalCost !== undefined || definition.alternativeCosts !== undefined) cost = composeActionCosts([cost, materializeAnnouncementCost(definition.additionalCost, bindings)]);
    }
    return { success: true, bindings, missing, missingCostRoute, cost, snapshot: structuredClone(snapshot) };
  } catch (error) {
    return { success: false, reason: error instanceof Error ? error.message : 'Invalid announcement' };
  }
}
