import type { CardAbility, CardBlueprint, CardZone, ManaColor } from './card.types';
import type { CardFilter } from './card-query.types';

export interface EffectScope extends CardFilter {
  /** Resolution numeric queries may read a named set; persistent modifiers cannot retain one. */
  from?: import('./resolution-result.types').CardResultSource;
  attachedToSource?: boolean;
  self?: boolean;
  cardUuid?: string;
  zoneRevision?: number;
  objects?: { cardUuid: string; zoneRevision: number }[];
  zones?: CardZone[];
}
export type CharacteristicNumber = import('./numeric-value.types').NumericValue | { count: EffectScope; multiply?: number; add?: number };
export interface PermissionRule {
  action: 'cast' | 'activate' | 'deploy' | 'target' | 'affect' | 'attack' | 'block';
  mode: 'prohibit' | 'instant';
  players?: 'self' | 'opponent' | 'any';
  abilityIds?: string[];
}
export interface ManaSubstitution {
  from: ManaColor;
  colors: ManaColor[];
}
export type ContinuousEffect =
  | { type: 'COPY'; blueprint: CardBlueprint }
  | { type: 'CONTROL'; controllerId: string }
  | { type: 'TEXT'; replacements: Record<string, string> }
  | { type: 'TYPE'; set?: string[]; add?: string[]; remove?: string[]; setSubTypes?: string[]; addSubTypes?: string[]; removeSubTypes?: string[]; setSuperTypes?: string[]; addSuperTypes?: string[]; removeSuperTypes?: string[] }
  | { type: 'MANA_COST'; mana: import('./card.types').ManaCost }
  | { type: 'COLOR'; set?: ManaColor[]; add?: ManaColor[]; remove?: ManaColor[] }
  | { type: 'ABILITY'; removeAll?: boolean; removeIds?: string[]; add?: CardAbility[]; addKeywords?: string[]; removeKeywords?: string[] }
  | { type: 'SET_STATS'; power: CharacteristicNumber; toughness: CharacteristicNumber }
  | { type: 'STAT_DELTA'; power?: CharacteristicNumber; toughness?: CharacteristicNumber }
  | { type: 'SWITCH_STATS' }
  | { type: 'MILL_AMOUNT'; amount: number }
  | { type: 'PERMISSION'; rules: PermissionRule[] }
  | ({ type: 'MANA_SUBSTITUTION' } & ManaSubstitution);
export interface StaticEffectDefinition {
  condition?: import('./rule.types').RuleCondition;
  /** Parts with the same group form one effect across layers. Default: one group per ability. */
  group?: string;
  layer: number;
  effect: ContinuousEffect;
  scope: EffectScope;
}
export interface StaticAbility {
  rules?: import('../rules/schema/contracts').ModifierDefinition[];
  readonly id: string;
  type: 'static';
  activeZones?: CardZone[];
  characteristicDefining?: boolean;
  effects: StaticEffectDefinition[];
}
export interface ContinuousEffectEntry extends StaticEffectDefinition {
  /** Assigned at commit; direct in-memory fixtures may omit it. */
  id?: string;
  timestamp?: number;
  characteristicDefining?: boolean;
  origin?: 'resolved' | 'static';
  source: string;
  sourceRevision?: number;
  publicNameLock?: true;
  sourceControllerId?: string;
  sourceAbilityId?: string;
  groupId?: string;
  requiredZone?: CardZone | null;
  duration: 'END_OF_TURN' | 'END_OF_COMBAT' | 'WHILE_ATTACHED' | 'WHILE_ON_BATTLEFIELD' | 'PERMANENT';
}
export interface CardCharacteristics {
  millBonus?: number;
  numericDeclarations?: import('./numeric-value.types').NumericDeclaration[];
  castRequirements: import('./effect.types').ActionRequirements;
  onCastEffects: import('./effect.types').EffectDefinition[];
  onEnterEffects: import('./effect.types').EffectDefinition[];
  modes?: import('./effect.types').ModeDefinition[];
  modeCount?: { min: number; max: number };
  permissions: (PermissionRule & { sourceControllerId?: string })[];
  manaSubstitution?: ManaSubstitution & { playerId: string };
  name: string;
  rulesText: string;
  cardTypes: string[];
  subTypes: string[];
  superTypes: string[];
  attachmentRequirements?: import('./effect.types').TargetingDefinition;
  colors: ManaColor[];
  keywords: string[];
  abilities: CardAbility[];
  controllerId: string;
  power: number;
  toughness: number;
}
