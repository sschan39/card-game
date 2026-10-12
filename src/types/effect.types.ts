/**
 * src/types/effect.types.ts
 * Stack and target typing for resolving card actions and abilities.
 */

import type { CardType, CardZone, ManaCost, CardInstance, CardSnapshot, ActivatedAbility, TriggeredAbility } from './card.types';
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
    mana?: ManaCost;
    /** Presence identifies loyalty activation; it is not a mana ability. */
    loyalty?: number;
    tap?: boolean;
    untap?: boolean;
    life?: number;
    discard?: number;
    sacrifice?: boolean;
}

/** Authored generic requirements become concrete before payment planning. */
export type AuthoredActionCost = Omit<ActionCost, 'mana'> & {
    mana?: Omit<ManaCost, 'generic'> & { generic?: import('./numeric-value.types').NumericValue };
};

/** Each alternative replaces the complete base cost; the extra applies to all routes. */
export interface CostRoutes {
    alternativeCosts?: { id: string; label: string; cost: AuthoredActionCost }[];
    additionalCost?: AuthoredActionCost;
}
export type CostRouteSelection = { kind: 'base' } | { kind: 'alternative'; id: string };

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

export interface ActionRequirements extends CostRoutes {
    allowedZones: CardZone[];
    speed: 'instant' | 'sorcery';
    cost?: AuthoredActionCost;
    condition?: ActionCondition;
}

// ============================================================================
// 4. Targeting
// ============================================================================

export interface TargetPointer {
    zoneRevision?: number;
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
// 5. Effect Payload (REMOVED)
// ============================================================================
//
// The legacy `EffectPayload` ({ effectId, params? }) was deleted. Activated and
// triggered abilities now use `EffectDefinition` (see section 6), the same model
// as spells and `onEnterEffects`, so abilities can declare their own `targeting`
// and `tags` instead of being hardcoded to target their controller.

// ============================================================================
// 6. StackEffect — New Primitive-Based Effect Model
// ============================================================================

/**
 * A single effect within a stack item. Carries its own targets locked at cast time.
 */
export interface StackEffect {
  choice?: EffectChoice;
  targetGroup?: string;
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
  stackTypes?: StackItemType[];
  type: 'player' | 'permanent' | 'spell' | 'stack' | 'card' | 'self';
  zones?: CardZone[];
  power?: { min?: number; max?: number };
  toughness?: { min?: number; max?: number };
  cardTypes?: string[];
  subTypes?: string[];           // filter by subtype (e.g. ['Servant'])
  controller?: 'self' | 'opponent' | 'any';
  required: boolean;
  minTargets?: number;
  maxTargets?: number;
  all?: boolean;                 // "all matching" mode (anthem/AOE) — expanded at resolve time
  /** Self effects default to the controller; permanent buffs can select the source. */
  subject?: 'controller' | 'source';
}

export interface EffectDefinition {
  choice?: EffectChoice;
  targetGroup?: string;
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
  readonly numericBindings?: import('./numeric-value.types').NumericBindings;
  readonly sourceInfo?: CardSnapshot;
  readonly targetGroups?: StackTargetGroup[];
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
  readonly numericBindings?: import('./numeric-value.types').NumericBindings;
  readonly sourceInfo?: CardSnapshot;
  readonly targetGroups?: StackTargetGroup[];
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
 * A snapshot of the game event that caused a triggered ability to trigger.
 *
 * Carried on the TriggeredStackObject so effects can reference last-known
 * information at resolve time — e.g. "the creature that entered", "the amount
 * of damage dealt". This matters because the event's own card may have left
 * the battlefield (or changed zones) by the time the trigger resolves, so the
 * live game state is not a reliable substitute for the event that fired.
 */
export interface TriggeringEvent {
  eventId: string;
  payload: Record<string, unknown>;
  eventUuid?: string;
  batchId?: string;
  commandId?: string;
}

/**
 * A triggered ability (CR 603). Source is a permanent already on the battlefield.
 * `ability` is optional to support the legacy `onEnterEffects` path, which has
 * no TriggeredAbility wrapper. Carried for future consumption (duration, fizzle,
 * cost verification) — not yet read by the resolution pipeline.
 */
export interface TriggeredStackObject {
  readonly sourceInfo?: CardSnapshot;
  readonly targetGroups?: StackTargetGroup[];
  readonly uuid: string;
  readonly type: 'triggered';
  readonly controllerId: string;
  readonly source: CardInstance;   // the permanent (stays on battlefield)
  readonly ability?: TriggeredAbility;  // the ability that triggered (optional for legacy path)
  readonly effects: StackEffect[]; // resolves in order
  /** The event that caused this trigger (last-known info for resolve time). */
  readonly triggeringEvent?: TriggeringEvent;
  readonly timestamp?: number;
  countered: boolean;
  fizzled?: boolean;
}

export type StackObject = SpellStackObject | ActivatedStackObject | TriggeredStackObject;

export interface TargetGroupDefinition { id: string; targeting: TargetingDefinition }
export interface StackTargetGroup extends TargetGroupDefinition { targets: TargetPointer[] }

export interface ModeDefinition { id: string; label: string; effects: EffectDefinition[] }
export type EffectChoice =
  | { kind: 'optional'; prompt?: string }
  | { kind: 'options' | 'ordering'; options: ModeDefinition[]; min?: number; max?: number; prompt?: string }
  | { kind: 'search'; zone: CardZone; cardTypes?: string[]; subTypes?: string[]; min?: number; max?: number; prompt?: string; ordered?: boolean }
  | { kind: 'selection'; criteria: TargetingDefinition; prompt?: string }
  | { kind: 'distribution'; total: number; field?: string; prompt?: string };

/** Convenience alias — used by play-card-handler.ts and StackDisplay.tsx */
export type StackItemType = StackObject['type'];

/**
 * A combat declaration (CR 508) — NOT on the stack. A turn-based action.
 * Attackers are declared as a batch in declareAttackersStep. Blockers are
 * assigned in declareBlockersStep. Damage is resolved simultaneously in
 * combatDamageStep.
 */
export interface CombatDeclaration {
  /** Explicit status; optional only for legacy room snapshots. */
  readonly blocked?: boolean;
  readonly uuid: string;
  readonly attacker: CardInstance;      // declaration snapshot and rules-object reference
  readonly attackerPower: number;      // declaration-time debug value; damage queries live power
  readonly blockers: CardInstance[];   // surviving declaration snapshots; blocked status is independent
}
