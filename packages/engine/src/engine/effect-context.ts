import { defaultRuntimeContext, type RuntimeContext } from '../shared/runtime-context';

/** Effect dependencies never enter room snapshots or serialized continuations. */
export type EffectContext = Pick<RuntimeContext, 'random'>;
export const defaultEffectContext: EffectContext = { random: defaultRuntimeContext.random };
