import type { ActionData } from '../engine/action-registry';
import type { StackObject } from './effect.types';
import type { ResolutionEffectResult } from './game-event.types';

export interface ChoiceOption { id: string; label: string; value: unknown; limit?: number }
export interface ResolutionContinuation { type: 'resolution'; stackObj: StackObject; effectIndex: number; results: ResolutionEffectResult[]; outcomeProbe?: import('./effect.types').OutcomeProbe }
export interface ActionContinuation {
  type: 'action'; actionId: string; data: ActionData;
  field: 'modes' | 'targetGroups' | 'discardUuids' | 'payment' | 'distributions' | 'numericBindings' | 'costRoute'; groupId?: string; manaActivationIndex?: number;
  bindingName?: string;
}
export interface ListedChoice {
  id: string; playerId: string;
  kind: 'modes' | 'targets' | 'selection' | 'options' | 'discard' | 'payment' | 'optional' | 'search' | 'distribution' | 'ordering';
  prompt: string; options: ChoiceOption[]; min: number; max: number; total?: number; minimumPerOption?: number;
  continuation: ActionContinuation | ResolutionContinuation | TriggerContinuation | CombatContinuation | import('./proposed-event.types').ReplacementContinuation | import('./state-based.types').StateBasedContinuation;
}
export interface NumericChoice {
  id: string; playerId: string; kind: 'number'; prompt: string;
  range: { min: number; max?: number };
  continuation: ActionContinuation;
}
export type PendingChoice = ListedChoice | NumericChoice;
export interface CombatContinuation { type: 'combat'; sourceUuid: string; passIndex: number }
export interface TriggerContinuation { type: 'trigger'; field: 'order' | 'modes' | 'targetGroups' | 'distributions'; triggerUuid?: string; groupId?: string }
export interface ChoiceAnswer { values: unknown[]; allocations?: Record<string, number>; number?: number }
