import type { GameMutation } from './game-mutation.types';
import type { ChoiceOption } from './choice.types';
import type { ObjectReference } from './proposed-event.types';

export interface StateBasedDecision { id: string; kind: 'legend' | 'protector'; playerId: string; prompt: string; options: ChoiceOption[]; card?: ObjectReference; selected?: unknown }
export interface StateBasedBatch { mutations: GameMutation[]; decisions: StateBasedDecision[]; references: ObjectReference[]; resumePriority: string | null }
export interface StateBasedContinuation { type: 'state_based'; batch: StateBasedBatch; decisionId: string }
