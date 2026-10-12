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

export type CardZone = 'library' | 'hand' | 'battlefield' | 'graveyard' | 'exile' | 'stack';

// ============================================================================
// 2. Trigger Events (for TriggeredAbility)
// ============================================================================

export type TriggerEvent =
    | 'ON_ENTER_BATTLEFIELD'
    | 'ON_LEAVE_BATTLEFIELD'
    | 'ON_DIE'
    | 'ON_DRAW'
    | 'ON_SHUFFLE'
    | 'ON_DISCARD'
    | 'BEGIN_UPKEEP'
    | 'END_OF_TURN'
    | 'ON_DAMAGE_TAKEN'
    | 'ON_LIFE_GAIN'
    | 'ON_LIFE_LOSS'
    | 'ON_DAMAGE_DEALT'
    | 'ON_BLOCK'
    | 'COMBAT_DAMAGE'
    | 'ON_SPELL_CAST'
    | 'ON_ATTACK';

// ============================================================================
// 3. Ability Architecture (Discriminated Unions)
// ============================================================================

export interface ActivatedAbility {
    numericDeclarations?: import('./numeric-value.types').NumericDeclaration[];
    limitPerTurn?: number;
    modes?: import('./effect.types').ModeDefinition[];
    modeCount?: { min: number; max: number };
    /** Stable identifier within this card's blueprint. */
    readonly id: string;
    type: 'activated';
    cost: import('./effect.types').AuthoredActionCost;
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

export interface TriggerFilter {
    condition?: import('./rule.types').RuleCondition;
    subject?: 'self' | 'another' | 'any';
    controller?: 'self' | 'opponent' | 'any';
    cardTypes?: string[];
    subTypes?: string[];
}

export interface TriggeredAbility {
    limitPerTurn?: number;
    interveningIf?: import('./rule.types').RuleCondition;
    modes?: import('./effect.types').ModeDefinition[];
    modeCount?: { min: number; max: number };
    trigger?: TriggerFilter;
    /** Normalized card data always has an ID; legacy in-memory trigger fixtures may omit it. */
    readonly id?: string;
    type: 'triggered';
    triggerCondition: TriggerEvent;
    /** See ActivatedAbility.effect — same unified effect model. */
    effect: EffectDefinition;
    castSpeed: ActionSpeed;
}

export type CardAbility = ActivatedAbility | TriggeredAbility | import('./continuous-effect.types').StaticAbility;

// ============================================================================
// 4. The Game Engine Data Pipeline Definitions
// ============================================================================

export interface CardBlueprint {
    readonly numericDeclarations?: import('./numeric-value.types').NumericDeclaration[];
    readonly colors?: ManaColor[];
    readonly modes?: import('./effect.types').ModeDefinition[];
    readonly modeCount?: { min: number; max: number };
    readonly id: string;
    readonly name: string;
    readonly cardTypes: CardType[];
    readonly subTypes?: CardSubType[];
    readonly superTypes?: string[];
    readonly attachmentRequirements?: import('./effect.types').TargetingDefinition;
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
 * are unrepresentable. Generic operations cover characteristics and permissions.
 */
export type { ContinuousEffect, ContinuousEffectEntry } from './continuous-effect.types';

/**
 * Mutable object state. Effective characteristics are derived by the shared
 * facade; printed blueprints remain immutable. Timestamps order static sources.
 */
export interface CardState {
    worldTimestamp?: number;
    attachedToRevision?: number;
    attachedToPlayerId?: string | null;
    protectorId?: string;
    characteristicTimestamp?: number;
    /** Advances on real zone changes while the card UUID remains stable. */
    zoneRevision?: number;
    zone: CardZone;
    ownerId: string;
    controllerId: string;
    isTapped: boolean;
    damageTaken: number;
    /** Actual damage from deathtouch since the previous SBA check. */
    deathtouchDamage?: boolean;
    summoningSickness: boolean;
    attackedThisTurn: boolean;         // cleared at turn start, set when attack is proposed
    counters: Record<string, number>;
    attachedTo?: string | null;
}

export interface CardInstance {
    readonly isToken?: boolean;
    /** Present only on retained declaration/departure snapshots. */
    lastKnownCharacteristics?: import('./continuous-effect.types').CardCharacteristics;
    lastKnownCopiableCharacteristics?: import('./continuous-effect.types').CardCharacteristics;
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
