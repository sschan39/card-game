import type { ActionData } from '../engine/action-registry';
import type { StackObject } from './effect.types';
import type { ResolutionEffectResult } from './game-event.types';

export interface ChoiceOption { id: string; label: string; value: unknown; limit?: number }
export interface ResolutionContinuation { type: 'resolution'; stackObj: StackObject; effectIndex: number; results: ResolutionEffectResult[] }
export interface ActionContinuation {
  type: 'action'; actionId: string; data: ActionData;
  field: 'modes' | 'targetGroups' | 'discardUuids' | 'payment' | 'distributions'; groupId?: string; manaActivationIndex?: number;
}
export interface PendingChoice {
  id: string; playerId: string;
  kind: 'modes' | 'targets' | 'selection' | 'options' | 'discard' | 'payment' | 'optional' | 'search' | 'distribution' | 'ordering';
  prompt: string; options: ChoiceOption[]; min: number; max: number; total?: number; minimumPerOption?: number;
  continuation: ActionContinuation | ResolutionContinuation | TriggerContinuation;
}
export interface TriggerContinuation { type: 'trigger'; field: 'order' | 'modes' | 'targetGroups' | 'distributions'; triggerUuid?: string; groupId?: string }
export interface ChoiceAnswer { values: unknown[]; allocations?: Record<string, number> }
