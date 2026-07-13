import type { GameRoom } from '../types/game.room.types';
import type { StackObject } from '../types/effect.types';
/**
 * A standardized signature for all effect resolution functions.
 * They take the current room state and the resolving stack object, and mutate the room.
 */
export type EffectHandler = (room: GameRoom, stackObj: StackObject) => void;
export declare const EffectRegistry: Record<string, EffectHandler>;
//# sourceMappingURL=effect-registry.d.ts.map