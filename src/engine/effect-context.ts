/** Runtime dependencies never enter room snapshots or serialized continuations. */
export interface EffectContext { random: () => number }
export const defaultEffectContext: EffectContext = { random: Math.random };
