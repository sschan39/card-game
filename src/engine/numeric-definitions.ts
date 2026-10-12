import type { CardAbility, CardBlueprint } from '../types/card.types';
import type { ContinuousEffect, StaticEffectDefinition } from '../types/continuous-effect.types';
import type { EffectDefinition, ModeDefinition } from '../types/effect.types';
import type { RuleCondition } from '../types/rule.types';
import { hasNumericExpression, validateNumericValue } from './numeric-values';
import { characteristicNumericValue } from './numeric-characteristics';
import type { NumericDeclaration } from '../types/numeric-value.types';
import type { AuthoredActionCost, CostRoutes } from '../types/effect.types';
import { assertCostRoutesShape } from './cost-composition';
import { safeRuleKey } from '../shared/rule-path';

/** Scan opaque data only to reject reserved syntax, never to interpret it. */
export function assertNoNumericExpressions(value: unknown): void {
  const seen = new Set<object>();
  const visit = (input: unknown) => {
    if (!input || typeof input !== 'object' || seen.has(input)) return;
    if (hasNumericExpression(input)) throw new Error('Numeric expression in an unsupported definition field');
    seen.add(input);
    Object.values(input).forEach(visit);
  };
  visit(value);
}

export function assertNumericDeclarations(declarations: NumericDeclaration[] = []): void {
  if (!Array.isArray(declarations)) throw new Error('Invalid numeric declarations');
  const names = new Set<string>();
  for (const declaration of declarations) {
    if (!declaration || typeof declaration !== 'object' || Object.keys(declaration).some(key => !['name', 'min', 'max'].includes(key)) ||
        typeof declaration.name !== 'string' || !declaration.name.trim() || !safeRuleKey(declaration.name) || names.has(declaration.name) ||
        !Number.isSafeInteger(declaration.min) || (declaration.max !== undefined && (!Number.isSafeInteger(declaration.max) || declaration.max < declaration.min))) {
      throw new Error('Invalid numeric declaration');
    }
    names.add(declaration.name);
  }
}

function assertNumericDefinition(value: unknown, declarations: NumericDeclaration[] = [], bindingOnly = false): void {
  const error = validateNumericValue(value);
  if (error) throw new Error('Invalid numeric definition: ' + error.reason);
  const bindings = (input: unknown): void => {
    if (!hasNumericExpression(input)) return;
    const expression = input.numeric;
    if (expression.kind === 'binding' && !declarations.some(declaration => declaration.name === expression.name)) throw new Error('Numeric binding has no retained owner in this definition');
    if (expression.kind === 'query' && bindingOnly) throw new Error('Numeric queries are unsupported in announcement costs');
    if (expression.kind === 'add' || expression.kind === 'multiply') { bindings(expression.left); bindings(expression.right); }
  };
  bindings(value);
}

export function assertAnnouncementCost(cost: AuthoredActionCost | undefined, declarations: NumericDeclaration[] = []): void {
  if (!cost) return;
  const { mana, ...rest } = cost;
  assertNoNumericExpressions(rest);
  if (mana) {
    const { generic, ...fixed } = mana;
    assertNoNumericExpressions(fixed);
    if (generic !== undefined) assertNumericDefinition(generic, declarations, true);
  }
}

export function assertCostRoutes(routes: CostRoutes, declarations: NumericDeclaration[] = []): void {
  assertCostRoutesShape(routes);
  assertAnnouncementCost(routes.additionalCost, declarations);
  routes.alternativeCosts?.forEach(route => assertAnnouncementCost(route.cost, declarations));
}

export function assertConditionNumericDefinition(condition: RuleCondition | undefined): void {
  if (!condition) return;
  if ('all' in condition) {
    const { all, ...rest } = condition; assertNoNumericExpressions(rest);
    all.forEach(assertConditionNumericDefinition); return;
  }
  if ('any' in condition) {
    const { any, ...rest } = condition; assertNoNumericExpressions(rest);
    any.forEach(assertConditionNumericDefinition); return;
  }
  if ('not' in condition) {
    const { not, ...rest } = condition; assertNoNumericExpressions(rest);
    assertConditionNumericDefinition(not); return;
  }
  const { left: _left, right: _right, ...rest } = condition;
  assertNoNumericExpressions(rest);
  for (const value of [condition.left, condition.right]) {
    if (hasNumericExpression(value)) assertNumericDefinition(value);
    else assertNoNumericExpressions(value);
  }
}

function assertModes(modes: ModeDefinition[] | undefined, declarations: NumericDeclaration[] = []): void {
  for (const mode of modes ?? []) {
    const { effects, ...rest } = mode;
    assertNoNumericExpressions(rest);
    effects.forEach(effect => assertEffectNumericDefinition(effect, declarations));
  }
}

export function assertEffectNumericDefinition(definition: EffectDefinition, declarations: NumericDeclaration[] = []): void {
  const { params, choice, ...rest } = definition;
  assertNoNumericExpressions(rest);
  for (const [key, value] of Object.entries(params)) {
    if (definition.action === 'CREATE_CONTINUOUS_EFFECT' && key === 'effect' && value && typeof value === 'object') {
      assertContinuousNumericDefinition(value as ContinuousEffect);
    } else if (hasNumericExpression(value)) assertNumericDefinition(value, declarations);
    else assertNoNumericExpressions(value);
  }
  if (choice?.kind === 'options' || choice?.kind === 'ordering') {
    const { options, ...other } = choice;
    assertNoNumericExpressions(other);
    assertModes(options, declarations);
  } else assertNoNumericExpressions(choice);
}

function assertStaticDefinition(definition: StaticEffectDefinition): void {
  const { effect, ...rest } = definition;
  assertNoNumericExpressions(rest);
  assertContinuousNumericDefinition(effect);
}

export function assertAbilityNumericDefinition(ability: CardAbility): void {
  if (ability.type !== 'activated' && ('alternativeCosts' in ability || 'additionalCost' in ability)) throw new Error('Only ordinary activated abilities support cost routes');
  if (ability.type === 'static') {
    const { effects, ...rest } = ability; assertNoNumericExpressions(rest);
    effects.forEach(assertStaticDefinition); return;
  }
  const declarations = ability.type === 'activated' ? ability.numericDeclarations ?? [] : [];
  assertNumericDeclarations(declarations);
  if (ability.type === 'activated' && (ability.alternativeCosts !== undefined || ability.additionalCost !== undefined) && ability.effect.action === 'ADD_MANA' && ability.effect.targeting.type === 'self' && !ability.effect.targeting.required && !ability.effect.targeting.all && ability.cost.loyalty === undefined) throw new Error('Mana abilities do not support cost routes');
  if (ability.type === 'activated' && declarations.length && ability.effect.action === 'ADD_MANA' && ability.effect.targeting.type === 'self' && !ability.effect.targeting.required && !ability.effect.targeting.all && ability.cost.loyalty === undefined) throw new Error('Mana abilities cannot declare numeric bindings');
  const { effect, modes, ...rest } = ability;
  assertEffectNumericDefinition(effect, declarations);
  assertModes(modes, declarations);
  if (ability.type === 'triggered') {
    assertConditionNumericDefinition(ability.trigger?.condition);
    assertConditionNumericDefinition(ability.interveningIf);
    const { trigger, interveningIf: _condition, ...other } = rest as typeof ability;
    const { condition: _triggerCondition, ...triggerRest } = trigger ?? {};
    assertNoNumericExpressions(other);
    assertNoNumericExpressions(triggerRest);
  } else {
    const { cost, numericDeclarations: _declarations, alternativeCosts, additionalCost, ...other } = rest as typeof ability;
    assertAnnouncementCost(cost, declarations);
    assertCostRoutes({ alternativeCosts, additionalCost }, declarations);
    assertNoNumericExpressions(other);
  }
}

export function assertBlueprintNumericDefinition(blueprint: CardBlueprint): void {
  const { onCastEffects, onEnterEffects, modes, abilities, numericDeclarations, castRequirements, ...rest } = blueprint;
  const declarations = numericDeclarations ?? [];
  assertNumericDeclarations(declarations);
  const { cost, alternativeCosts, additionalCost, ...requirements } = castRequirements;
  assertAnnouncementCost(cost, declarations);
  assertCostRoutes({ alternativeCosts, additionalCost }, declarations);
  assertNoNumericExpressions(requirements);
  assertNoNumericExpressions(rest);
  onCastEffects?.forEach(effect => assertEffectNumericDefinition(effect, declarations));
  onEnterEffects?.forEach(effect => assertEffectNumericDefinition(effect));
  assertModes(modes, declarations);
  abilities?.forEach(assertAbilityNumericDefinition);
}

export function assertContinuousNumericDefinition(effect: ContinuousEffect): void {
  if (effect.type === 'SET_STATS' || effect.type === 'STAT_DELTA') {
    const { power, toughness, ...rest } = effect;
    assertNoNumericExpressions(rest);
    for (const value of [power, toughness]) if (value !== undefined) {
      if (typeof value === 'object' && !hasNumericExpression(value)) {
        const { count: _scope, multiply: _multiply, add: _add, ...extra } = value;
        assertNoNumericExpressions(extra);
      }
      assertNumericDefinition(characteristicNumericValue(value));
    }
  } else if (effect.type === 'COPY') {
    const { blueprint, ...rest } = effect; assertNoNumericExpressions(rest);
    assertBlueprintNumericDefinition(blueprint);
  }
  else if (effect.type === 'ABILITY') {
    const { add, ...rest } = effect;
    assertNoNumericExpressions(rest);
    add?.forEach(assertAbilityNumericDefinition);
  } else assertNoNumericExpressions(effect);
}
