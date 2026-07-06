/**
 * src/types/card.types.ts
 * Core types governing card blueprint data, abilities, and active match instances.
 */
import { ActionCost, ActionRequirements, ActionSpeed, EffectPayload } from "./effect.types";
// ============================================================================
// 1. Primitive Game Domains
// ============================================================================

export type ManaColor = 'white' | 'blue' | 'green' | 'black' | 'red' | 'colorless';

/**
 * Represents a mana cost or mana pool allocation.
 * Uses TypeScript's Partial utility because a cost rarely contains every color.
 * Example: { red: 1 } or { colorless: 2, blue: 1 }
 */
export type ManaCost = Partial<Record<ManaColor, number>>;

export type CardType = 'Creature' | 'Spell' | 'Land';

export type CardSubType = 'Minion' | 'Servant' | 'Equipment';

export type CardZone = 'library' | 'hand' | 'battlefield' | 'graveyard' | 'stack';


// ============================================================================
// 2. Declarative Effects and System Payloads
// ============================================================================

export type EffectId = 
    | 'ADD_MANA' 
    | 'DISCARD_HAND' 
    | 'DEAL_DAMAGE' 
    | 'CAST_SPELL' 
    | 'GRANT_STATS';


/**
 * The master configuration representing an action waiting to resolve.
 * Intersects strict payloads with general metadata rules like targeting & nesting.
 */
export type CardEffect = EffectPayload & {
    target?: 'self' | 'opponent' | 'any';
    // Used to nest ETB (Enters the Battlefield) effects inside a monster cast setup
    onPlayExec?: EffectPayload;
};


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
    triggerCondition: string; // e.g., 'ON_ENTB', 'ON_DICE_ROLL', 'BEGIN_UPKEEP'
    effect: EffectPayload;
    castSpeed: ActionSpeed;
}

// Combines variations into a single type-safe array target
export type CardAbility = ActivatedAbility | TriggeredAbility;


// ============================================================================
// 4. The Game Engine Data Pipeline Definitions
// ============================================================================

/**
 * CARD BLUEPRINT
 * The pure, immutable definition loaded from database source arrays.
 * Shared globally; never contains state variables unique to a specific room match.
 */
export interface CardBlueprint {
    readonly id: string;
    readonly name: string;
    readonly cardTypes: CardType[];
    readonly subTypes?: CardSubType[];
    readonly castRequirements: ActionRequirements;
    readonly rulesText: string;
    readonly power?: number;     // Optional: Spells/Lands do not have native P/T combat steps
    readonly toughness?: number; // Optional
    readonly abilities: CardAbility[];
    readonly onPlayEffect?: EffectPayload; // Replaces raw inline execution JS strings
}

/**
 * CARD STATE
 * The unique situational flags tied to a specific copy of a card in an active game room.
 */
export interface CardState {
    zone: CardZone;
    ownerId: string;
    controllerId: string;
    isTapped: boolean;
    damageTaken: number;
    summoningSickness: boolean;
    counters: Record<string, number>; // Flexible tracker for +1/+1 counters, charge tokens, etc.
}

/**
 * CARD INSTANCE
 * The live operational object. It combines the core rules blueprint with a unique
 * tracker UUID and an isolated state track block. This is what moves through the room engine.
 */
export interface CardInstance extends CardBlueprint {
    readonly uuid: string; // Globally unique identifier for this physical instance in a room
    state: CardState;      // Fully mutable state record tracking current coordinates
}

export { ActionCost };
