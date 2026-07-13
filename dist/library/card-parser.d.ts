import type { CardBlueprint, CardAbility } from '../types/card.types';
import type { ActionCost } from '../types/effect.types';
export declare function normalizeActionCost(cost: Record<string, unknown> | undefined): ActionCost;
export declare function normalizeAbility(ability: Record<string, unknown>): CardAbility | null;
export declare function normalizeCard(raw: Record<string, unknown>): CardBlueprint;
export declare function parseAll(rawMap: Record<string, Record<string, unknown>>): Record<string, CardBlueprint>;
declare const _default: {
    normalizeActionCost: typeof normalizeActionCost;
    normalizeAbility: typeof normalizeAbility;
    normalizeCard: typeof normalizeCard;
    parseAll: typeof parseAll;
};
export default _default;
//# sourceMappingURL=card-parser.d.ts.map