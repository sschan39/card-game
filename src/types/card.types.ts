/**
 * src/types/card.types.ts
 * Core types governing card blueprint data, abilities, and active match instances.
 */
import { ActionCost, ActionRequirements, ActionSpeed, EffectDefinition } from "./effect.types";

// ============================================================================
// 1. Primitive Game Domains
// ============================================================================

export type ManaColor = 'white' | 'blue' | 'green' | 'black' | 'red' | 'colorless';

export const MANA_COLORS: readonly ManaColor[] = ['colorless', 'white', 'blue', 'black', 'red', 'green'];
export type ManaCost = Partial<Record<ManaColor | 'generic', number>>;
/** Actual mana spent, never a generic requirement. */
export type ManaPayment = Partial<Record<ManaColor, number>>;

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
    modes?: import('./effect.types').ModeDefinition[];
    modeCount?: { min: number; max: number };
    /** Stable identifier within this card's blueprint. */
    readonly id: string;
    type: 'activated';
    cost: ActionCost;
    /**
     * The effect this ability produces. Uses the same `EffectDefinition` model
     * as spells and `onEnterEffects`, so abilities can declare their own
     * `targeting` (self / opponent / permanent / all) and `tags` instead of
     * being hardcoded to target their controller.
     */
    effect: EffectDefinition;
    duration?: string | null;
    castSpeed: ActionSpeed;
}

export interface TriggeredAbility {
    /** Normalized card data always has an ID; legacy in-memory trigger fixtures may omit it. */
    readonly id?: string;
    type: 'triggered';
    triggerCondition: TriggerEvent;
    /** See ActivatedAbility.effect — same unified effect model. */
    effect: EffectDefinition;
    castSpeed: ActionSpeed;
}

export type CardAbility = ActivatedAbility | TriggeredAbility;

// ============================================================================
// 4. The Game Engine Data Pipeline Definitions
// ============================================================================

export interface CardBlueprint {
    readonly modes?: import('./effect.types').ModeDefinition[];
    readonly modeCount?: { min: number; max: number };
    readonly id: string;
    readonly name: string;
    readonly cardTypes: CardType[];
    readonly subTypes?: CardSubType[];
    readonly keywords?: string[];
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
    sourceControllerId?: string;
    source: string;              // cardUuid of source | 'emblem' | 'global'
    layer: number;               // 1-7 subset; we implement layer 7 (P/T)
    effect: ContinuousEffect;    // STAT_DELTA | SET_STATS
    scope: {
        cardTypes?: string[];      // e.g. ['Creature']
        subTypes?: string[];       // e.g. ['Servant']
        cardUuid?: string;         // single-card target (non-anthem buffs)
        zoneRevision?: number;
        controller?: 'self' | 'opponent' | 'any';  // relative to source's controller
    };
    requiredZone?: CardZone | null; // null: resolved effect independent of source presence.
                                 // Default: 'battlefield'. 'emblem'/'global' sources ignore.
    duration: 'END_OF_TURN' | 'WHILE_ATTACHED' | 'WHILE_ON_BATTLEFIELD' | 'PERMANENT';
}

export interface CardState {
    /** Advances on real zone changes while the card UUID remains stable. */
    zoneRevision?: number;
    zone: CardZone;
    ownerId: string;
    controllerId: string;
    isTapped: boolean;
    damageTaken: number;
    summoningSickness: boolean;
    attackedThisTurn: boolean;         // cleared at turn start, set when attack is proposed
    counters: Record<string, number>;
    attachedTo?: string | null;        // DEFERRED — cardUuid of host (for auras)
}

export interface CardInstance {
    readonly uuid: string;
    readonly blueprint: CardBlueprint;
    state: CardState;
}

/** Relevant information retained before a departing permanent's state resets. */
export interface CardSnapshot {
    card: CardInstance;
    power: number;
    toughness: number;
}

export type { ActionCost };
