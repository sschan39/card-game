// src/library/card-parser.ts
import type { CardBlueprint, CardAbility, ActivatedAbility, TriggeredAbility, CardType, CardZone, ManaColor } from '../types/card.types';
import type { AuthoredActionCost, EffectDefinition } from '../types/effect.types';
import type { NumericDeclaration, NumericValue } from '../types/numeric-value.types';
import { assertAnnouncementCost, assertNumericDeclarations, assertEffectNumericDefinition, assertAbilityNumericDefinition, assertBlueprintNumericDefinition } from '../engine/numeric-definitions';

/**
 * Parse supported mana symbols into an authored cost; {X} requires an explicit declaration.
 * Supported symbols are {W}{U}{B}{R}{G}{C}, numeric {N}, and {X}.
 *
 * Examples:
 *   "{R}"        => { red: 1 }
 *   "{4}{R}{R}"  => { generic: 4, red: 2 }
 *   "{0}"        => { generic: 0 }
 *   ""           => {}
 */
export function parseManaCost(raw: string): NonNullable<AuthoredActionCost['mana']> {
  if (!raw) return {};

  if (!/^(?:\{(?:[WUBRGCX]|\d+)\})+$/.test(raw)) throw new Error('Unsupported mana cost: ' + raw);
  const cost: NonNullable<AuthoredActionCost['mana']> = {};
  // X becomes the same named binding used by other numeric consumers.
  const re = /\{([WUBRGCX]|\d+)\}/g;
  let match: RegExpExecArray | null;

  while ((match = re.exec(raw)) !== null) {
    const symbol = match[1];
    if (symbol === 'X' || /^\d+$/.test(symbol)) {
      // Numeric requirements can be paid by any mana color.
      const value: NumericValue = symbol === 'X' ? { numeric: { kind: 'binding', name: 'X' } } : parseInt(symbol, 10);
      cost.generic = cost.generic === undefined ? value : typeof cost.generic === 'number' && typeof value === 'number'
        ? cost.generic + value : { numeric: { kind: 'add', left: cost.generic, right: value } };
    } else if (symbol === 'C') {
      cost.colorless = (cost.colorless ?? 0) + 1;
    } else {
      const colorMap: Record<string, ManaColor> = {
        W: 'white', U: 'blue', B: 'black', R: 'red', G: 'green',
      };
      const color = colorMap[symbol];
      if (color) {
        cost[color] = (cost[color] ?? 0) + 1;
      }
    }
  }

  return cost;
}

export function normalizeActionCost(cost: Record<string, unknown> | undefined, declarations: NumericDeclaration[] = []): AuthoredActionCost {
  assertAnnouncementCost(cost as AuthoredActionCost | undefined, declarations);
  if (!cost) return { mana: {}, tap: false, life: 0, discard: 0, sacrifice: false };

  return {
    mana: (cost.mana as AuthoredActionCost['mana']) || {},
    tap: !!cost.tap,
    untap: !!cost.untap,
    life: typeof cost.life === 'number' ? cost.life : 0,
    discard: typeof cost.discard === 'number' ? cost.discard : 0,
    sacrifice: !!cost.sacrifice,
    ...(typeof cost.loyalty === 'number' ? { loyalty: cost.loyalty } : {}),
  };
}

export function normalizeEffect(raw: Record<string, unknown>, declarations: NumericDeclaration[] = []): EffectDefinition {
  const effect: EffectDefinition = {
    ...(raw.choice ? { choice: raw.choice as EffectDefinition['choice'] } : {}),
    ...(typeof raw.targetGroup === 'string' ? { targetGroup: raw.targetGroup } : {}),
    action: (raw.action as string) || '',
    params: (raw.params as Record<string, unknown>) || {},
    tags: (raw.tags as string[]) || [],
    targeting: (raw.targeting as EffectDefinition['targeting']) || { type: 'self', required: false },
  };
  assertEffectNumericDefinition(effect, declarations);
  return effect;
}

export function normalizeAbility(ability: Record<string, unknown>): CardAbility | null {
  if (!ability || typeof ability !== 'object') return null;

  const type = (ability.type as string) || 'activated';
  if (type !== 'activated' && ability.numericDeclarations !== undefined) throw new Error('Only ordinary activated abilities declare numeric bindings');
  const declarations = ability.numericDeclarations === undefined ? [] : ability.numericDeclarations as NumericDeclaration[];
  assertNumericDeclarations(declarations);
  if (type === 'static') {
    const normalized: CardAbility = { id: typeof ability.id === 'string' ? ability.id : '', type: 'static',
      ...(ability.activeZones ? { activeZones: structuredClone(ability.activeZones) as CardZone[] } : {}),
      ...(ability.characteristicDefining ? { characteristicDefining: true } : {}),
      effects: structuredClone(ability.effects ?? []) as import('../types/continuous-effect.types').StaticEffectDefinition[] };
    assertAbilityNumericDefinition(normalized);
    return normalized;
  }
  // Abilities use the same EffectDefinition model as spells/onEnterEffects.
  // `effectId` is the legacy field name; `action` is the unified one. Default
  // targeting is self (matching the old hardcoded behavior) but is now
  // expressible per-ability via an explicit `targeting` field.
  const effect: EffectDefinition = {
    ...(ability.choice ? { choice: ability.choice as EffectDefinition['choice'] } : {}),
    action: typeof ability.effectId === 'string' ? ability.effectId.toUpperCase() : '',
    params: (ability.params as Record<string, unknown>) || {},
    tags: (ability.tags as string[]) || [],
    targeting: (ability.targeting as EffectDefinition['targeting']) || { type: 'self', required: false },
  };

  const base = {
    ...(ability.limitPerTurn !== undefined ? { limitPerTurn: ability.limitPerTurn as number } : {}),
    ...(Array.isArray(ability.modes) ? { modes: normalizeModes(ability.modes as Record<string, unknown>[], declarations) } : {}),
    ...(ability.modeCount ? { modeCount: ability.modeCount as { min: number; max: number } } : {}),
    id: typeof ability.id === 'string' && ability.id.trim() ? ability.id : '',
    effect,
    castSpeed: (ability.castSpeed as 'instant' | 'sorcery') || 'instant',
  };

  if (type === 'triggered') {
    const normalized = {
      type: 'triggered',
      ...(ability.trigger ? { trigger: structuredClone(ability.trigger) as TriggeredAbility['trigger'] } : {}),
      ...(ability.interveningIf ? { interveningIf: structuredClone(ability.interveningIf) as TriggeredAbility['interveningIf'] } : {}),
      triggerCondition: (ability.triggerCondition as TriggeredAbility['triggerCondition']) || 'ON_ENTER_BATTLEFIELD',
      ...base,
    } as TriggeredAbility;
    assertAbilityNumericDefinition(normalized);
    return normalized;
  }

  const normalized = {
    type: 'activated',
    ...(declarations.length ? { numericDeclarations: structuredClone(declarations) } : {}),
    cost: normalizeActionCost(ability.cost as Record<string, unknown> | undefined, declarations),
    duration: (ability.duration as string) || null,
    ...base,
  } as ActivatedAbility;
  assertAbilityNumericDefinition(normalized);
  return normalized;
}

export function normalizeCard(raw: Record<string, unknown>): CardBlueprint {
  if (!raw.id) {
    throw new Error(`[CardParser] Missing absolute identifier 'id' on card name: ${raw.name}`);
  }

  // Mana cost lives at the top level of the card JSON (e.g. "{4}{R}{R}"),
  // not inside castRequirements.cost. Parse it and inject into the cost.
  const declarations = raw.numericDeclarations === undefined ? [] : raw.numericDeclarations as NumericDeclaration[];
  assertNumericDeclarations(declarations);
  const manaCost = parseManaCost((raw.manaCost as string) || '');
  const castCost = normalizeActionCost((raw.castRequirements as Record<string, unknown>)?.cost as Record<string, unknown> | undefined, declarations);
  if (Object.keys(manaCost).length > 0) {
    castCost.mana = manaCost;
  }

  const abilities = ((raw.abilities as Record<string, unknown>[]) || [])
    .map(normalizeAbility).filter((a): a is CardAbility => a !== null);
  const ids = new Set<string>();
  for (const ability of abilities) {
    if (!ability.id || ids.has(ability.id)) throw new Error(`[CardParser] Missing or duplicate ability ID on ${raw.id}`);
    ids.add(ability.id);
  }

  const blueprint: CardBlueprint = {
    ...(declarations.length ? { numericDeclarations: structuredClone(declarations) } : {}),
    id: raw.id as string,
    name: (raw.name as string) || '',
    cardTypes: (raw.cardTypes as CardType[]) || [],
    subTypes: (raw.subTypes as string[]) || [],
    keywords: (raw.keywords as string[]) || [],
    ...(Array.isArray(raw.colors) ? { colors: raw.colors as ManaColor[] } : {}),
    rulesText: (raw.rulesText as string) || '',
    power: raw.power as number | undefined,
    toughness: raw.toughness as number | undefined,
    ...(Array.isArray(raw.modes) ? { modes: normalizeModes(raw.modes as Record<string, unknown>[], declarations) } : {}),
    ...(raw.modeCount ? { modeCount: raw.modeCount as { min: number; max: number } } : {}),

    onCastEffects: (((raw.onCastEffects || raw.onPlay) as Record<string, unknown>[]) || []).map(effect => normalizeEffect(effect, declarations)),
    onEnterEffects: ((raw.onEnterEffects as Record<string, unknown>[]) || []).map(effect => normalizeEffect(effect)),

    castRequirements: {
      allowedZones: (raw.castRequirements as Record<string, unknown>)?.allowedZones as CardZone[] || ['hand'],
      speed: ((raw.castRequirements as Record<string, unknown>)?.speed as 'instant' | 'sorcery') || 'sorcery',
      cost: castCost,
      condition: ((raw.castRequirements as Record<string, unknown>)?.condition as Record<string, unknown>) || undefined,
    },

    abilities,
  };
  assertBlueprintNumericDefinition(blueprint);
  return blueprint;
}

export function parseAll(rawMap: Record<string, Record<string, unknown>>): Record<string, CardBlueprint> {
  const out: Record<string, CardBlueprint> = {};
  Object.keys(rawMap).forEach(k => {
    out[k] = normalizeCard(rawMap[k]);
  });
  return out;
}

function normalizeModes(modes: Record<string, unknown>[], declarations: NumericDeclaration[] = []) {
  const ids = new Set<string>();
  return modes.map(mode => {
    if (typeof mode.id !== 'string' || !mode.id.trim() || ids.has(mode.id)) throw new Error('Missing or duplicate mode ID');
    ids.add(mode.id);
    return { id: mode.id, label: typeof mode.label === 'string' ? mode.label : mode.id,
      effects: ((mode.effects as Record<string, unknown>[]) ?? []).map(effect => normalizeEffect(effect, declarations)) };
  });
}
