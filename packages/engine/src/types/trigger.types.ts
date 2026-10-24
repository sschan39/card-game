import type { TriggeredStackObject } from './effect.types';
import type { ActionData } from '../engine/action-registry';
import type { CardInstance, CardSnapshot, TriggeredAbility } from './card.types';
import type { TriggeringEvent } from './effect.types';

export interface TriggerQueueEntry { object: TriggeredStackObject; selections: ActionData; ordered: boolean }
export interface TriggerQueue { entries: TriggerQueueEntry[]; resumePriority: string }
export interface DelayedTrigger { id: string; source: CardInstance; sourceInfo: CardSnapshot; controllerId: string; ability: TriggeredAbility; lifetime: 'once' | 'end_of_turn' | 'permanent' }
export interface TurnHistory { turnNumber: number; events: TriggeringEvent[]; counts: Record<string, number>; playerCounts: Record<string, Record<string, number>>; uses: Record<string, number>; landPlays?: Record<string, number> }
