import type { CardAbility, CardBlueprint } from '../types/card.types';
import type { ContinuousEffect, StaticEffectDefinition } from '../types/continuous-effect.types';
import type { EffectDefinition, ModeDefinition } from '../types/effect.types';
import type { RuleCondition } from '../types/rule.types';
import { hasNumericExpression, validateNumericValue } from './numeric-values';
import { characteristicNumericValue } from './numeric-characteristics';

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

function assertNumericDefinition(value: unknown): void {
  const error = validateNumericValue(value);
  if (error) throw new Error('Invalid numeric definition: ' + error.reason);
  const bindings = (input: unknown): void => {
    if (!hasNumericExpression(input)) return;
    const expression = input.numeric;
    if (expression.kind === 'binding') throw new Error('Numeric binding has no retained owner in this definition');
    if (expression.kind === 'add' || expression.kind === 'multiply') { bindings(expression.left); bindings(expression.right); }
  };
  bindings(value);
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

function assertModes(modes: ModeDefinition[] | undefined): void {
  for (const mode of modes ?? []) {
    const { effects, ...rest } = mode;
    assertNoNumericExpressions(rest);
    effects.forEach(assertEffectNumericDefinition);
  }
}

export function assertEffectNumericDefinition(definition: EffectDefinition): void {
  const { params, choice, ...rest } = definition;
  assertNoNumericExpressions(rest);
  for (const [key, value] of Object.entries(params)) {
    if (definition.action === 'CREATE_CONTINUOUS_EFFECT' && key === 'effect' && value && typeof value === 'object') {
      assertContinuousNumericDefinition(value as ContinuousEffect);
    } else if (hasNumericExpression(value)) assertNumericDefinition(value);
    else assertNoNumericExpressions(value);
  }
  if (choice?.kind === 'options' || choice?.kind === 'ordering') {
    const { options, ...other } = choice;
    assertNoNumericExpressions(other);
    assertModes(options);
  } else assertNoNumericExpressions(choice);
}

function assertStaticDefinition(definition: StaticEffectDefinition): void {
  const { effect, ...rest } = definition;
  assertNoNumericExpressions(rest);
  assertContinuousNumericDefinition(effect);
}

export function assertAbilityNumericDefinition(ability: CardAbility): void {
  if (ability.type === 'static') {
    const { effects, ...rest } = ability; assertNoNumericExpressions(rest);
    effects.forEach(assertStaticDefinition); return;
  }
  const { effect, modes, ...rest } = ability;
  assertEffectNumericDefinition(effect);
  assertModes(modes);
  if (ability.type === 'triggered') {
    assertConditionNumericDefinition(ability.trigger?.condition);
    assertConditionNumericDefinition(ability.interveningIf);
    const { trigger, interveningIf: _condition, ...other } = rest as typeof ability;
    const { condition: _triggerCondition, ...triggerRest } = trigger ?? {};
    assertNoNumericExpressions(other);
    assertNoNumericExpressions(triggerRest);
  } else assertNoNumericExpressions(rest);
}

export function assertBlueprintNumericDefinition(blueprint: CardBlueprint): void {
  const { onCastEffects, onEnterEffects, modes, abilities, ...rest } = blueprint;
  assertNoNumericExpressions(rest);
  onCastEffects?.forEach(assertEffectNumericDefinition);
  onEnterEffects?.forEach(assertEffectNumericDefinition);
  assertModes(modes);
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
