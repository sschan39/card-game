export type RuleValue = string | number | boolean | null | { path: string };
export type RuleCondition =
  | { all: RuleCondition[] }
  | { any: RuleCondition[] }
  | { not: RuleCondition }
  | { op: 'eq' | 'ne' | 'gt' | 'gte' | 'lt' | 'lte' | 'includes'; left: RuleValue; right: RuleValue };
