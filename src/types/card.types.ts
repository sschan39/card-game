/**
 * src/types/card.types.ts
 * Core types governing card blueprint data, abilities, and active match instances.
 */
import { ActionCost, ActionRequirements, ActionSpeed, EffectPayload } from "./effect.types";

// ============================================================================
// 1. Primitive Game Domains
// ============================================================================

export type ManaColor = 'white' | 'blue' | 'green' | 'black' | 'red' | 'colorless';

export type ManaCost = Partial<Record<ManaColor, number>>;

export const CARD_TYPES = ['Creature', 'Spell', 'Land', 'Artifact', 'Enchantment'] as const;
/** Open string for extensibility — known types listed in CARD_TYPES const */
export type CardType = string;

/** Open string for extensibility — known subtypes: 'Minion', 'Servant', 'Equipment', 'Dragon' */
export type CardSubType = string;

export type CardZone = 'library' | 'hand' | 'battlefield' | 'graveyard' | 'stack';

// ============================================================================
// 2. Trigger Events (for TriggeredAbility)
// ============================================================================

export type TriggerEvent =
    | 'ON_ENTER_BATTLEFIELD'
    | 'ON_LEAVE_BATTLEFIELD'
    | 'ON_DIE'
    | 'ON_DRAW'
    | 'ON_DISCARD'
    | 'BEGIN_UPKEEP'
    | 'END_OF_TURN'
    | 'ON_DAMAGE_TAKEN'
    | 'ON_LIFE_GAIN'
    | 'ON_SPELL_CAST'
    | 'ON_ATTACK';

// ============================================================================
// 3. Ability Architecture (Discriminated Unions)
// ============================================================================

export interface ActivatedAbility {
    type: 'activated';
    cost: ActionCost;
    effect: EffectPayload;
    duration?: string | null;
    castSpeed: ActionSpeed;
}

export interface TriggeredAbility {
    type: 'triggered';
    triggerCondition: TriggerEvent;
    effect: EffectPayload;
    castSpeed: ActionSpeed;
}

export type CardAbility = ActivatedAbility | TriggeredAbility;

// ============================================================================
// 4. The Game Engine Data Pipeline Definitions
// ============================================================================

export interface CardBlueprint {
    readonly id: string;
    readonly name: string;
    readonly cardTypes: CardType[];
    readonly subTypes?: CardSubType[];
    readonly castRequirements: ActionRequirements;
    readonly rulesText: string;
    readonly power?: number;
    readonly toughness?: number;
    readonly abilities: CardAbility[];
    readonly onCastEffects?: import('./effect.types').EffectDefinition[];
    readonly onEnterEffects?: import('./effect.types').EffectDefinition[];
}

// ============================================================================
// 4a. Continuous Effects — the ContinuousEffectPool model
// ============================================================================

/**
 * A continuous effect — a closed, discriminated union so invalid combinations
 * are unrepresentable. Only STAT_DELTA has a handler today; SET_STATS is
 * declared because it changes the resolver's layer ordering (applies before
 * STAT_DELTA), but has no handler until a "becomes 3/3" card exists.
 */
export type ContinuousEffect =
    | { type: 'STAT_DELTA'; power?: number; toughness?: number }   // +1/+0
    | { type: 'SET_STATS'; power: number; toughness: number };     // "becomes 3/3"

/**
 * An entry in the ContinuousEffectPool — the global registry of active
 * continuous effects. Effects are evaluated from the source outward,
 * on-demand, never materialized onto targets.
 *
 * No `id` field: removal matches by `source` (REMOVE_CONTINUOUS_EFFECT).
 * No `timestamp` field: ordering within a layer is insertion order (array index).
 */
export interface ContinuousEffectEntry {
    source: string;              // cardUuid of source | 'emblem' | 'global'
    layer: number;               // 1-7 subset; we implement layer 7 (P/T)
    effect: ContinuousEffect;    // STAT_DELTA | SET_STATS
    scope: {
        cardTypes?: string[];      // e.g. ['Creature']
        subTypes?: string[];       // e.g. ['Servant']
        cardUuid?: string;         // single-card target (non-anthem buffs)
        controller?: 'self' | 'opponent' | 'any';  // relative to source's controller
    };
    requiredZone?: CardZone;     // zone the source must occupy for this entry to be valid.
                                 // Default: 'battlefield'. 'emblem'/'global' sources ignore.
    duration: 'END_OF_TURN' | 'WHILE_ATTACHED' | 'WHILE_ON_BATTLEFIELD' | 'PERMANENT';
}

export interface CardState {
    zone: CardZone;
    ownerId: string;
    controllerId: string;
    isTapped: boolean;
    damageTaken: number;
    summoningSickness: boolean;
    counters: Record<string, number>;
    // modifiers: ContinuousModifier[];   // REMOVED — replaced by room.continuousEffectPool
    attachedTo?: string | null;        // DEFERRED — cardUuid of host (for auras)
}

export interface CardInstance {
    readonly uuid: string;
    readonly blueprint: CardBlueprint;
    state: CardState;
}

export type { ActionCost };
