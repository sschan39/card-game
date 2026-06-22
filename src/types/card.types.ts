/**
 * src/types/card.types.ts
 * Core types governing card blueprint data, abilities, and active match instances.
 */

// 1. Primitive Game Domains
export type ManaColor = 'white' | 'blue' | 'green' | 'black' | 'red' | 'colorless' ;

/**
 * Represents a mana cost or mana pool allocation.
 * Uses TypeScript's Partial utility because a cost rarely contains *every* color.
 * Example: { red: 1 } or { colorless: 2, blue: 1 }
 */
export type ManaCost = Partial<Record<ManaColor, number>>;

export type CardType = 'Creature' | 'Spell' | 'Land';

export type CardSubType = 'Minion' | 'Servant' | 'Equipment';

export type CardZone = 'library' | 'hand' | 'battlefield' | 'graveyard' | 'stack';


// 2. Declarative Effects and System Payloads
export type EffectId = 
    | 'ADD_MANA' 
    | 'DISCARD_HAND' 
    | 'DEAL_DAMAGE' 
    | 'CAST_SPELL' 
    | 'GRANT_STATS';

/**
 * The static data configuration representing an action waiting to resolve.
 */
export interface EffectPayload {
    effectId: EffectId | string;
    params?: {
        color?: ManaColor;
        amount?: number;
        target?: 'self' | 'opponent' | 'any';
        power?: number;
        toughness?: number;
        [key: string]: any;
    };
    // Used to nest ETB (Enters the Battlefield) effects inside a monster cast setup
    onPlayExec?: EffectPayload;
}


// 3. Activated & Static Mechanics
export interface ActivatedAbility {
    type: 'activated';
    cost: {
        tap: boolean;
        mana?: ManaCost;
    };
    // runtime shape often uses an effectId + params rather than a nested payload
    effectId: EffectId | string;
    params?: Record<string, any>;
    duration?: string | null;
}


// 4. The Data Pipeline Definitions

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
    readonly manaCost?: ManaCost;
    readonly rulesText: string;
    readonly power?: number;     // Optional: Spells/Lands do not have native P/T combat steps
    readonly toughness?: number; // Optional
    // Abilities may be expressed as ActivatedAbility[] or the loader shape
    readonly abilities: ActivatedAbility[] | Array<{
        type: 'activated' | 'triggered';
        cost: { tap: boolean; mana?: ManaCost | null };
        effectId: EffectId | string;
        params?: Record<string, any>;
        duration?: string | null;
    }>;
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