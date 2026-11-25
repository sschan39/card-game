import type { CardInstance } from '../../types/card.types';
import type { GameRoom } from '../../types/game.room.types';
import type { GameMutation } from '../../types/game-mutation.types';
import type { RuleUse } from '../../types/rule.types';
export type { RuleUse } from '../../types/rule.types';
import type { ModifierDefinition } from '../schema/contracts';
import { CardCharacteristicService, withCharacteristicCache } from '../../engine/card-characteristic-service';
import { roomCards } from '../../engine/continuous-effect-state';
import { counterRuleKey, counterRulesFor } from './counter-rules';

export interface ActiveRule<R extends ModifierDefinition = ModifierDefinition> {
  definition: R;
  source: CardInstance;
  controllerId: string;
  abilityId: string;
  counterType?: string;
  id: string;
}
const frozenDefinitions = new WeakMap<object, boolean>();
function containsEvaluatedRule(value: unknown, seen = new Set<object>()): boolean {
  if (!value || typeof value !== 'object' || seen.has(value)) return false;
  const cached = Object.isFrozen(value) ? frozenDefinitions.get(value) : undefined;
  if (cached !== undefined) return cached;
  seen.add(value);
  const result =
    ('family' in value && (value.family === 'costs' || value.family === 'event-replacements')) ||
    Object.values(value).some((child) => containsEvaluatedRule(child, seen));
  if (Object.isFrozen(value)) frozenDefinitions.set(value, result);
  return result;
}

/** Discover effective static rules; removed abilities and new source incarnations are respected. */
export function activeRules(room: GameRoom): ActiveRule[] {
  const cards = roomCards(room);
  const counterSources = new Map<CardInstance, ReturnType<typeof counterRulesFor>>();
  for (const card of room.battlefield) {
    const definitions = counterRulesFor(room, card);
    if (definitions.length) counterSources.set(card, definitions);
  }
  // A counter may also grant an effective static ability through the characteristic layers.
  if (
    !counterSources.size &&
    !cards.some((card) => containsEvaluatedRule(card.blueprint)) &&
    !containsEvaluatedRule(room.continuousEffectPool)
  )
    return [];

  return withCharacteristicCache(room, () =>
    cards.flatMap((source) => {
      const view = CardCharacteristicService.resolve(room, source);
      const controllerId = view.controllerId;
      const abilities = view.abilities.flatMap((ability) =>
        ability.type !== 'static' || !(ability.activeZones ?? ['battlefield']).includes(source.state.zone)
          ? []
          : (ability.rules ?? []).map((definition) => ({
              definition,
              source,
              controllerId,
              abilityId: ability.id,
              id: `rule:${source.uuid}:${source.state.zoneRevision ?? 0}:${ability.id}:${definition.id}`,
            })),
      );
      const counters = (counterSources.get(source) ?? []).flatMap((counter) => {
        const abilityId = counterRuleKey(source, counter.type);
        return counter.rules.map((definition) => ({
          definition,
          source,
          controllerId,
          abilityId,
          counterType: counter.type,
          id: `${abilityId}:${definition.id}`,
        }));
      });
      return [...abilities, ...counters];
    }),
  );
}
/** The shared use budget a rule consumes, or `undefined` when it is unlimited. */
export function ruleUse(active: ActiveRule): RuleUse | undefined {
  const usage = 'usage' in active.definition ? active.definition.usage : undefined;

  // Guard: a rule without a usage block is unlimited.
  if (!usage) return;

  // The identity decides which uses share one budget.
  let identity = `${active.source.uuid}:${active.source.state.zoneRevision ?? 0}`;

  if (usage.identity === 'controller')
    identity = usage.group ? active.controllerId : `${active.controllerId}:${active.source.blueprint.id}`;
  else if (usage.identity === 'source_card') identity = active.source.uuid;

  let key = `rule-use:${identity}:${active.abilityId}:${active.definition.id}`;
  if (active.counterType !== undefined)
    key = `counter-use:${JSON.stringify([identity, active.counterType, active.definition.id])}`;
  if (usage.group) key = `usage:${identity}:group:${usage.group}`;
  return { key, period: usage.period, limit: usage.limit };
}
/** Whether a rule's use budget still allows another use this period. */
export function ruleUseAvailable(room: GameRoom, use: RuleUse | undefined): boolean {
  return (
    !use ||
    (use.period === 'game' ? (room.gameRuleUses?.[use.key] ?? 0) : (room.turnHistory?.uses[use.key] ?? 0)) < use.limit
  );
}
/** Mutation that consumes one use of a rule's budget. */
export function recordRuleUse(room: GameRoom, use: RuleUse): GameMutation {
  return use.period === 'turn'
    ? { type: 'RECORD_ABILITY_USE', key: use.key, turnNumber: room.turnNumber ?? 1 }
    : { type: 'RECORD_GAME_RULE_USE', key: use.key };
}
