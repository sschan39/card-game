/**
 * src/types/card.types.ts
 * Core types governing card blueprint data, abilities, and active match instances.
 */
import { ActionCost, ActionRequirements, ActionSpeed, EffectPayload } from "./effect.types";
export type ManaColor = 'white' | 'blue' | 'green' | 'black' | 'red' | 'colorless';
export type ManaCost = Partial<Record<ManaColor, number>>;
export declare const CARD_TYPES: readonly ["Creature", "Spell", "Land", "Artifact", "Enchantment"];
export type CardType = typeof CARD_TYPES[number];
/** Open string for extensibility — known subtypes: 'Minion', 'Servant', 'Equipment', 'Dragon' */
export type CardSubType = string;
export type CardZone = 'library' | 'hand' | 'battlefield' | 'graveyard' | 'stack';
export type TriggerEvent = 'ON_ENTER_BATTLEFIELD' | 'ON_LEAVE_BATTLEFIELD' | 'ON_DIE' | 'ON_DRAW' | 'ON_DISCARD' | 'BEGIN_UPKEEP' | 'END_OF_TURN' | 'ON_DAMAGE_TAKEN' | 'ON_LIFE_GAIN' | 'ON_SPELL_CAST';
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
    readonly onPlayEffect?: EffectPayload;
}
export interface CardState {
    zone: CardZone;
    ownerId: string;
    controllerId: string;
    isTapped: boolean;
    damageTaken: number;
    summoningSickness: boolean;
    counters: Record<string, number>;
}
export interface CardInstance extends CardBlueprint {
    readonly uuid: string;
    state: CardState;
}
export { ActionCost };
//# sourceMappingURL=card.types.d.ts.map