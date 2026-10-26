import type { CardState, CardZone } from '@card-game/engine/types/card.types';
import type { Phase, GameStatus } from '@card-game/engine/types/game.state.types';
import type { DebugMode } from '@card-game/engine/types/debug-mode.types';
import type { GameOutcome } from '@card-game/engine/types/game.room.types';
import type { ManaPool } from '@card-game/engine/types/game.player.types';
import type { TargetPointer, TargetingDefinition } from '@card-game/engine/types/effect.types';
import type { Versioned } from '../version';
import type { ActionIdOrAbility } from '../actions/action-ids';

export interface TargetGroupView {
  id: string;
  targeting: Pick<TargetingDefinition, 'type' | 'required' | 'minTargets' | 'maxTargets'>;
  legalTargets: TargetPointer[];
}
export interface ActionOption {
  actionId: ActionIdOrAbility; label: string; description?: string; disabled?: boolean;
  disabledReason?: string; hidden?: boolean; data?: Record<string, unknown>;
}
/** Display data only: no authored abilities, effect definitions or rule blueprint. */
export interface CardView {
  uuid: string; definitionId: string; name: string; label: string; cardTypes: string[];
  subTypes: string[]; keywords: string[]; rulesText: string; manaCost: string;
  power?: number; toughness?: number; isToken?: boolean;
  state: Pick<CardState, 'zone' | 'ownerId' | 'controllerId' | 'zoneRevision' | 'isTapped' | 'damageTaken' | 'summoningSickness' | 'attackedThisTurn' | 'counters' | 'attachedTo' | 'attachedToRevision' | 'attachedToPlayerId' | 'protectorId'>;
  defaultActionId?: ActionIdOrAbility;
  actions: ActionOption[];
  targetGroups: Record<string, TargetGroupView[]>;
  canAttack: boolean; canBlock: boolean;
}
export interface StackView {
  uuid: string; type: 'spell' | 'activated' | 'triggered'; controllerId: string;
  source: CardView | null; description: string; countered?: boolean; fizzled?: boolean;
  abilityId?: string;
}
export interface CombatView {
  uuid: string; attacker: CardView; attackerPower: number; blockers: CardView[]; blocked?: boolean;
}
interface ChoiceBase { id: string; playerId: string; prompt: string; cancellable: boolean; sourceLabel?: string; numericBindings?: Record<string, number> }
export interface ListedChoiceView extends ChoiceBase {
  kind: 'modes' | 'targets' | 'selection' | 'options' | 'discard' | 'payment' | 'optional' | 'search' | 'distribution' | 'ordering';
  options: { id: string; label: string; limit?: number }[]; min: number; max: number;
  total?: number; minimumPerOption?: number;
}
export interface NumericChoiceView extends ChoiceBase { kind: 'number'; range: { min: number; max?: number } }
export type OwnedChoiceView = ListedChoiceView | NumericChoiceView;
export type ChoiceView = OwnedChoiceView | { kind: 'waiting'; playerId: string };
export interface PlayerStateView {
  id: string; life: number; poison?: number; failedDraw?: boolean; mana: ManaPool;
  hand: CardView[]; handCount: number; deckCount: number; graveyard: CardView[]; exile: CardView[];
}
export interface PlayerView extends Versioned {
  viewerId: string; roomId: string; player1Id: string; player2Id: string | null;
  players: Record<string, PlayerStateView>; phase: Phase; status: GameStatus; debugMode: DebugMode;
  turnNumber: number; outcome?: GameOutcome; engineState: 'waiting_for_player' | 'resolving_stack' | 'state_based_actions' | 'game_over';
  activeTurnPlayerId: string; priorityPlayerId: string | null; lastPassedPlayerId: string | null;
  declarationPlayerId: string | null; landPlayLimit: number;
  turnHistory: { landPlays: Record<string, number> };
  stack: StackView[]; battlefield: CardView[]; combat: CombatView[];
  combatDeclarations?: { attackers: boolean; blockers: boolean }; combatDamage?: { completed: boolean } | null;
  pendingChoice: ChoiceView | null; rpsState: { status: string; playedCards: Record<string, string> };
}
export type { CardZone };
