import type { CardInstance } from '../../types/card.types';
import type { ActionCost } from '../../types/effect.types';
import type { GameRoom } from '../../types/game.room.types';
import { CardCharacteristicService } from '../../engine/card-characteristic-service';
import { composeActionCosts } from '../../engine/cost-composition';
import { conditionMatches, createRuleContext } from '../../engine/rule-conditions';
import { scopeMatches } from '../../engine/effect-scopes';
import { evaluateNumericValue } from '../../shared/numeric-values';
import { activeRules, ruleUse, ruleUseAvailable, type RuleUse } from './active-rules';
import type { CostModifierDefinition } from '../schema/contracts';
import type { NumericContext } from '../../types/numeric-value.types';

/** Apply every active cost rule to a base cost, returning the adjusted cost and the uses consumed. */
export function applyCostRules(room: GameRoom, playerId: string, card: CardInstance, base: ActionCost, extra: ActionCost = {}): { cost: ActionCost; uses: RuleUse[]; signature: unknown[] } {
  const target = CardCharacteristicService.resolve(room, card);
  const applicable = activeRules(room).flatMap(active => {
    if (active.definition.family !== 'costs') return [];
    const use = ruleUse(active);
    if (!ruleUseAvailable(room, use) || !scopeMatches(active.definition.scope, card, target, active.source, active.controllerId)) return [];
    const context = createRuleContext(room, active.source, active.controllerId, undefined, undefined, { target: { ...card, ...target }, actorId: playerId });
    if (!conditionMatches(active.definition.condition, context)) return [];
    const operation = active.definition.operation;
    let amount = 0;
    if ('amount' in operation) {
      const value = evaluateNumericValue(operation.amount, context.numericContext as NumericContext);
      if (!value.ok || !Number.isSafeInteger(value.value) || value.value < 0) throw new Error(`Invalid cost modifier value: ${active.id}`);
      amount = value.value;
    }
    return [{ active, definition: active.definition as CostModifierDefinition, use, amount }];
  });
  let cost = structuredClone(base);
  const uses: RuleUse[] = [], used = new Set<string>();
  const apply = (entry: typeof applicable[number]) => {
    const op = entry.definition.operation;
    cost.mana ??= {};
    switch (op.type) {
      case 'mana.waive_base': cost.mana = {}; break;
      case 'mana.set_base': cost.mana[op.color] = entry.amount; break;
      case 'mana.increase': {
        const value = (cost.mana[op.color] ?? 0) + entry.amount;
        if (!Number.isSafeInteger(value)) throw new Error('Modified mana cost exceeds safe range');
        cost.mana[op.color] = value;
        break;
      }
      case 'mana.reduce': cost.mana[op.color] = Math.max(0, (cost.mana[op.color] ?? 0) - entry.amount); break;
    }
    if (entry.use && !used.has(entry.use.key)) { used.add(entry.use.key); uses.push(entry.use); }
  };
  // Base setters/waivers, then additional costs and increases, then reductions. Payment never occurs here.
  applicable.filter(e => ['mana.set_base', 'mana.waive_base'].includes(e.definition.operation.type)).forEach(apply);
  cost = composeActionCosts([cost, extra]);
  applicable.filter(e => e.definition.operation.type === 'mana.increase').forEach(apply);
  applicable.filter(e => e.definition.operation.type === 'mana.reduce').forEach(apply);
  return { cost, uses, signature: applicable.map(e => ({ id: e.active.id, operation: e.definition.operation, amount: e.amount, use: e.use })) };
}
