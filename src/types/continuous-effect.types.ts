import type { CardAbility, CardBlueprint, CardZone, ManaColor } from './card.types';

export interface EffectScope {
  self?: boolean;
  cardUuid?: string;
  zoneRevision?: number;
  objects?: { cardUuid: string; zoneRevision: number }[];
  zones?: CardZone[];
  cardTypes?: string[];
  subTypes?: string[];
  colors?: ManaColor[];
  controller?: 'self' | 'opponent' | 'any';
}
export type CharacteristicNumber = import('./numeric-value.types').NumericValue | { count: EffectScope; multiply?: number; add?: number };
export interface PermissionRule {
  action: 'cast' | 'activate';
  mode: 'prohibit' | 'instant';
  players?: 'self' | 'opponent' | 'any';
  abilityIds?: string[];
}
export type ContinuousEffect =
  | { type: 'COPY'; blueprint: CardBlueprint }
  | { type: 'CONTROL'; controllerId: string }
  | { type: 'TEXT'; replacements: Record<string, string> }
  | { type: 'TYPE'; set?: string[]; add?: string[]; remove?: string[]; setSubTypes?: string[]; addSubTypes?: string[]; removeSubTypes?: string[]; setSuperTypes?: string[]; addSuperTypes?: string[]; removeSuperTypes?: string[] }
  | { type: 'COLOR'; set?: ManaColor[]; add?: ManaColor[]; remove?: ManaColor[] }
  | { type: 'ABILITY'; removeAll?: boolean; removeIds?: string[]; add?: CardAbility[]; addKeywords?: string[]; removeKeywords?: string[] }
  | { type: 'SET_STATS'; power: CharacteristicNumber; toughness: CharacteristicNumber }
  | { type: 'STAT_DELTA'; power?: CharacteristicNumber; toughness?: CharacteristicNumber }
  | { type: 'SWITCH_STATS' }
  | { type: 'PERMISSION'; rules: PermissionRule[] };
export interface StaticEffectDefinition {
  /** Parts with the same group form one effect across layers. Default: one group per ability. */
  group?: string;
  layer: number;
  effect: ContinuousEffect;
  scope: EffectScope;
}
export interface StaticAbility {
  readonly id: string;
  type: 'static';
  activeZones?: CardZone[];
  characteristicDefining?: boolean;
  effects: StaticEffectDefinition[];
}
export interface ContinuousEffectEntry extends StaticEffectDefinition {
  /** Assigned at commit; optional only for legacy in-memory fixtures. */
  id?: string;
  timestamp?: number;
  characteristicDefining?: boolean;
  origin?: 'resolved' | 'static';
  source: string;
  sourceRevision?: number;
  sourceControllerId?: string;
  sourceAbilityId?: string;
  groupId?: string;
  requiredZone?: CardZone | null;
  duration: 'END_OF_TURN' | 'WHILE_ATTACHED' | 'WHILE_ON_BATTLEFIELD' | 'PERMANENT';
}
export interface CardCharacteristics {
  castRequirements: import('./effect.types').ActionRequirements;
  onCastEffects: import('./effect.types').EffectDefinition[];
  onEnterEffects: import('./effect.types').EffectDefinition[];
  modes?: import('./effect.types').ModeDefinition[];
  modeCount?: { min: number; max: number };
  permissions: (PermissionRule & { sourceControllerId?: string })[];
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
