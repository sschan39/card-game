/**
 * src/types/effect.types.ts
 * Stack and target typing for resolving card actions and abilities.
 */

import type { CardType, CardZone, ManaColor, CardInstance, ActivatedAbility, TriggeredAbility } from './card.types';
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
export type TargetType = 'self' | 'player' | 'card' | 'permanent' | 'spell' | 'stack' | 'zone' | 'any';

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
    // "all matching" expansion (anthem/AOE) — set by buildStackEffects when
    // the TargetingDefinition has `all: true`. Expanded into concrete
    // cardUuid targets at resolve time by expandTargets().
    all?: boolean;
    cardTypes?: string[];
    subTypes?: string[];
    controller?: 'self' | 'opponent' | 'any';
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
  targeting?: TargetingDefinition;   // the targeting definition this effect was built from
  fizzled?: boolean;                 // set at resolve time when required targets all became illegal (CR 114.5)
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
  subTypes?: string[];           // filter by subtype (e.g. ['Servant'])
  controller?: 'self' | 'opponent' | 'any';
  required: boolean;
  minTargets?: number;
  maxTargets?: number;
  all?: boolean;                 // "all matching" mode (anthem/AOE) — expanded at resolve time
}

export interface EffectDefinition {
  action: string;
  params: Record<string, unknown>;
  tags?: string[];
  targeting: TargetingDefinition;
}

// ============================================================================
// 7. Stack Objects — discriminated union (CR 601/602/603)
// ============================================================================

/**
 * A spell being cast (CR 601). Source is a card that moved hand→stack.
 */
export interface SpellStackObject {
  readonly uuid: string;
  readonly type: 'spell';
  readonly controllerId: string;
  readonly source: CardInstance;   // the card ON the stack
  readonly effects: StackEffect[]; // resolves in order
  readonly timestamp?: number;
  countered: boolean;              // set true if countered; effects skipped on resolution
  fizzled?: boolean;               // set true at resolve time when all required targets became illegal (CR 114.5)
}

/**
 * An activated ability (CR 602). Source is a permanent already on the battlefield.
 */
export interface ActivatedStackObject {
  readonly uuid: string;
  readonly type: 'activated';
  readonly controllerId: string;
  readonly source: CardInstance;   // the permanent (stays on battlefield)
  readonly ability: ActivatedAbility;  // the ability being activated
  readonly effects: StackEffect[]; // resolves in order
  readonly timestamp?: number;
  countered: boolean;
  fizzled?: boolean;
}

/**
 * A triggered ability (CR 603). Source is a permanent already on the battlefield.
 * `ability` is optional to support the legacy `onEnterEffects` path, which has
 * no TriggeredAbility wrapper. Carried for future consumption (duration, fizzle,
 * cost verification) — not yet read by the resolution pipeline.
 */
export interface TriggeredStackObject {
  readonly uuid: string;
  readonly type: 'triggered';
  readonly controllerId: string;
  readonly source: CardInstance;   // the permanent (stays on battlefield)
  readonly ability?: TriggeredAbility;  // the ability that triggered (optional for legacy path)
  readonly effects: StackEffect[]; // resolves in order
  readonly timestamp?: number;
  countered: boolean;
  fizzled?: boolean;
}

export type StackObject = SpellStackObject | ActivatedStackObject | TriggeredStackObject;

/** Convenience alias — used by play-card-handler.ts and StackDisplay.tsx */
export type StackItemType = StackObject['type'];

/**
 * A combat declaration (CR 508) — NOT on the stack. A turn-based action.
 * Attackers are declared, then damage is applied immediately in the current
 * single-attacker model. In a future declare-blockers step, this structure
 * will gain a `blockers?: CardInstance[]` field.
 */
export interface CombatDeclaration {
  readonly uuid: string;
  readonly attacker: CardInstance;      // the attacking creature
  readonly target: TargetPointer;       // opponent player OR opponent creature
  readonly attackerPower: number;       // locked at declaration time
  readonly defenderPower?: number;      // locked at declaration time (creature target)
}
