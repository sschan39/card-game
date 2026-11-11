import { v4 as uuidv4 } from 'uuid';
import type { RandomSource } from './random';

/** Runtime capabilities are process-local and never enter serialized game state. */
export interface RuntimeContext {
  uuid(): string;
  random: RandomSource;
}

export const defaultRuntimeContext: RuntimeContext = {
  uuid: uuidv4,
  random: Math.random,
};

export function resolveRuntimeContext(
  dependencies: Partial<RuntimeContext> = {},
): RuntimeContext {
  return {
    uuid: dependencies.uuid ?? defaultRuntimeContext.uuid,
    random: dependencies.random ?? defaultRuntimeContext.random,
  };
}
