/**
 * src/types/effect.types.ts
 * Stack and target typing for resolving card actions and abilities.
 */

import type { CardType, CardZone, ManaColor } from './card.types';
import type { GameRoom } from './game.room.types';

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
// 5. Effect Payload (Legacy — used by ActivatedAbility/TriggeredAbility)
// ============================================================================

/**
 * Legacy effect payload for activated/triggered abilities.
 * New spell effects use StackEffect + EffectDefinition instead.
 */
export interface EffectPayload {
    effectId: string;
    params?: Record<string, unknown>;
}

// ============================================================================
// 6. StackEffect — New Primitive-Based Effect Model
// ============================================================================

/**
 * A single effect within a stack item. Carries its own targets locked at cast time.
 */
export interface StackEffect {
  action: string;                    // primitive name, e.g. 'MODIFY_STATS'
  params: Record<string, unknown>;   // snapshot values locked at propose time
  dynamicParams?: Record<string, unknown>;  // values computed at resolve time (e.g., current power)
  tags: string[];                    // e.g. ['damage']
  targets: TargetPointer[];          // locked-in targets chosen at cast time
}

/**
 * Validates whether a target is still legal at resolve time.
 * Returns true if the target is still valid for the given effect.
 */
export type TargetValidator = (room: GameRoom, target: TargetPointer, effect: StackEffect) => boolean;

// ============================================================================
// 6. Card Definition Types (for card_data.json)
// ============================================================================

export interface TargetingDefinition {
  type: 'player' | 'permanent' | 'spell' | 'card' | 'self';
  cardTypes?: string[];
  controller?: 'self' | 'opponent' | 'any';
  required: boolean;
  minTargets?: number;
  maxTargets?: number;
}

export interface EffectDefinition {
  action: string;
  params: Record<string, unknown>;
  tags?: string[];
  targeting: TargetingDefinition;
}

// ============================================================================
// 7. Stack Objects — UPDATED
// ============================================================================

export interface StackObject {
  readonly uuid: string;
  readonly type: StackItemType;
  readonly controllerId: string;
  readonly source: any; // CardInstance — imported at usage sites to avoid circular deps
  readonly effects: StackEffect[];   // resolves in order
  readonly timestamp?: number;
  countered: boolean;                // set true if countered; effects skipped on resolution
}

export interface StackObjectConfig {
  type: StackItemType;
  controllerId: string;
  source: any;
  effects: StackEffect[];
}
