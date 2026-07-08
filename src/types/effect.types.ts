/**
 * src/types/effect.types.ts
 * Stack and target typing for resolving card actions and abilities.
 */

import type { CardInstance, CardType, CardZone, ManaColor } from './card.types';

// ============================================================================
// 1. Registry Key Types
// ============================================================================

/** Key type for EffectRegistry — open string for extensibility */
export type EffectId = string;

/** Key type for ActionRegistry — open string for extensibility */
export type ActionType = string;

// ============================================================================
// 2. Speed, Stack, and Target Primitives
// ============================================================================

export type ActionSpeed = 'instant' | 'sorcery';
export type StackItemType = 'spell' | 'activated' | 'triggered';
export type TargetType = 'player' | 'card' | 'permanent' | 'spell' | 'stack' | 'zone' | 'any';

// ============================================================================
// 3. Cost and Condition Definitions
// ============================================================================

export interface ActionCost {
    mana?: Partial<Record<ManaColor, number>>;
    tap?: boolean;
    life?: number;
    discard?: number;
    sacrifice?: boolean;
}

export interface ActionCondition {
    zoneCheck?: {
        zone: CardZone[];
        ownedBy: 'self' | 'opponent' | 'any';
        cardType?: CardType;
        cardId?: string;
        minCount?: number;
    };
    /** Open string for extensibility — new flags added without type changes */
    globalFlag?: string;
}

export interface ActionRequirements {
    allowedZones: CardZone[];
    speed: 'instant' | 'sorcery';
    cost?: ActionCost;
    condition?: ActionCondition;
}

// ============================================================================
// 4. Targeting
// ============================================================================

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

// ============================================================================
// 5. Effect Payload (Open Interface)
// ============================================================================

/**
 * Open interface for effect payloads.
 * New effects add entries to EffectRegistry without changing this type.
 * Handlers narrow params as needed.
 */
export interface EffectPayload {
    effectId: string;
    params?: Record<string, unknown>;
}

// ============================================================================
// 6. Stack Objects
// ============================================================================

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
