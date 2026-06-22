/**
 * src/types/effect.types.ts
 * Stack and target typing for resolving card actions and abilities.
 */

import type { CardInstance,ManaColor } from './card.types';

export type StackItemType = 'spell' | 'activated' | 'triggered';

export type TargetType = 'player' | 'card' | 'permanent' | 'spell' | 'stack' | 'zone' | 'any';

/**
 * A lightweight pointer to a target on the stack or in the game state.
 * The pointer keeps both the target kind and the identifiers needed to
 * resolve it later in the rules engine.
 */
export interface TargetPointer {
	targetType: TargetType;
	controllerId?: string;
	playerId?: string;
	cardUuid?: string;
	cardId?: string;
	zone?: string;
	stackUuid?: string;
	required?: boolean;
	index?: number;
	metadata?: Record<string, any>;
}
export type EffectPayload = 
    | { effectId: 'CAST_SPELL' }
    | { effectId: 'DISCARD_HAND' }
    | { effectId: 'ADD_MANA', params: { color: ManaColor, amount: number } }
    | { effectId: 'GRANT_STATS', params: { power: number, toughness: number, duration: 'EOT' | 'PERMANENT' } }
    | { effectId: 'DEAL_DAMAGE', params: { amount: number } };
/**
 * The static structure representing one item on the stack.
 * This is created when a spell is cast, an activated ability is used,
 * or a triggered ability is put on the stack.
 */
export interface StackObject {
	readonly uuid: string;
	readonly type: StackItemType;
	readonly controllerId: string;
	readonly source: CardInstance;
	readonly payload: EffectPayload;
	readonly targets: TargetPointer[];
	readonly timestamp?: number;
}

export interface StackObjectConfig {
	type: StackItemType;
	controllerId: string;
	source: CardInstance;
	payload: StackObject['payload'];
	targets?: TargetPointer[] | TargetPointer;
}

