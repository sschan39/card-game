import { create } from 'zustand';
import type { GameRoom, PlayerId } from '../../types/game.room.types';
import type { CardInstance } from '../../types/card.types';
import type { Phase } from '../../types/game.state.types';
import type { StateDelta } from '../../types/delta.types';
import type { ActionOption } from '../../engine/option-service';
import type { TargetPointer, TargetingDefinition } from '../../types/effect.types';
import type { ActionIdOrAbility } from '../../types/action.ids';
import { applyDeltaChanges } from './deltaReducer';
import { getOrCreatePlayerId, setStoredRoomId, clearStoredRoomId } from '../session';
import { type CombatSelection, EMPTY_COMBAT_SELECTION, reconcileCombatSelection } from './combatSelection';

export interface ContextMenuState {
  x: number;
  y: number;
  cardUuid: string;
  zone: 'hand' | 'battlefield';
  options: ActionOption[];
}

export interface TargetingState {
  cardUuid: string;
  zone: 'hand' | 'battlefield';
  actionId: ActionIdOrAbility;
  targeting: TargetingDefinition;
  collected: TargetPointer[];
}

interface GameStore {
  // Server-authoritative state
  room: GameRoom | null;
  roomId: string | null;
  myPlayerId: string | null;

  // UI state (client-only)
  contextMenu: ContextMenuState | null;
  targeting: TargetingState | null;
  pendingCard: { cardUuid: string; zone: 'hand' | 'battlefield' } | null;
  error: string | null;
  log: { seq: number; action?: string; playerId?: string; changes: number }[];
  combatSelection: CombatSelection;
  combatNotification: string | null;

  // Actions
  applyDelta: (delta: StateDelta) => void;
  setRoom: (room: GameRoom) => void;
  setRoomId: (id: string) => void;
  setMyPlayerId: (id: string) => void;
  clearSession: () => void;
  requestOptions: (cardUuid: string, zone: 'hand' | 'battlefield') => void;
  showContextMenu: (options: ActionOption[]) => void;
  hideContextMenu: () => void;
  beginTargeting: (state: TargetingState) => void;
  addTarget: (pointer: TargetPointer) => void;
  removeTarget: (pointer: TargetPointer) => void;
  toggleTarget: (pointer: TargetPointer) => void;
  cancelTargeting: () => void;
  confirmTargeting: () => void;
  enterAttackTargeting: (cardUuid: string) => void;
  setError: (message: string) => void;
  toggleAttacker: (uuid: string) => void;
  selectBlocker: (uuid: string) => void;
  assignBlocker: (attackerUuid: string) => void;
  clearCombatSelection: () => void;
}

export const useGameStore = create<GameStore>((set, get) => ({
  room: null,
  roomId: null,
  myPlayerId: null,
  contextMenu: null,
  targeting: null,
  pendingCard: null,
  error: null,
  log: [],
  combatSelection: EMPTY_COMBAT_SELECTION,
  combatNotification: null,

  applyDelta: (delta) => {
    const current = get().room;
    if (!current) return;

    const nextRoom = applyDeltaChanges(current, delta.changes);

    const { selection: reconciled, changed } = reconcileCombatSelection(get().combatSelection, nextRoom);
    if (changed) {
      // The player's combat selection was silently adjusted because a creature
      // left the battlefield or became ineligible. Notify briefly.
      set({ combatNotification: 'Selection updated due to board change' });
      setTimeout(() => set({ combatNotification: null }), 2000);
    }

    set((state) => ({
      room: nextRoom,
      combatSelection: reconciled,
      log: [
        ...state.log,
        {
          seq: delta.seq,
          action: delta.action,
          playerId: delta.playerId,
          changes: delta.changes.length,
        },
      ].slice(-100), // keep last 100 entries
    }));
  },

  setRoom: (room) => set((state) => ({ room, combatSelection: reconcileCombatSelection(state.combatSelection, room).selection })),

  setRoomId: (id) => {
    setStoredRoomId(id);
    set({ roomId: id });
  },
  setMyPlayerId: (id) => set({ myPlayerId: id }),

  clearSession: () => {
    clearStoredRoomId();
    set({
      room: null,
      roomId: null,
      myPlayerId: null,
      contextMenu: null,
      targeting: null,
      pendingCard: null,
      error: null,
      log: [],
    });
  },

  requestOptions: (cardUuid, zone) => set({ pendingCard: { cardUuid, zone } }),

  showContextMenu: (options) => {
    const { pendingCard } = get();
    if (!pendingCard) return;
    set({
      contextMenu: { x: 0, y: 0, cardUuid: pendingCard.cardUuid, zone: pendingCard.zone, options },
      pendingCard: null,
    });
  },

  hideContextMenu: () => set({ contextMenu: null }),

  beginTargeting: (state) => set({ targeting: state, contextMenu: null }),

  addTarget: (pointer) => {
    const { targeting } = get();
    if (!targeting) return;
    const max = targeting.targeting.maxTargets;
    if (max !== undefined && targeting.collected.length >= max) return;
    set({ targeting: { ...targeting, collected: [...targeting.collected, pointer] } });
  },

  removeTarget: (pointer) => {
    const { targeting } = get();
    if (!targeting) return;
    set({
      targeting: {
        ...targeting,
        collected: targeting.collected.filter(
          (t) => !(t.cardUuid === pointer.cardUuid && t.playerId === pointer.playerId)
        ),
      },
    });
  },

  toggleTarget: (pointer) => {
    const { targeting } = get();
    if (!targeting) return;
    const alreadyCollected = targeting.collected.some(
      (t) => t.cardUuid === pointer.cardUuid && t.playerId === pointer.playerId
    );
    if (alreadyCollected) {
      set({
        targeting: {
          ...targeting,
          collected: targeting.collected.filter(
            (t) => !(t.cardUuid === pointer.cardUuid && t.playerId === pointer.playerId)
          ),
        },
      });
    } else {
      const max = targeting.targeting.maxTargets;
      if (max !== undefined && targeting.collected.length >= max) return;
      set({ targeting: { ...targeting, collected: [...targeting.collected, pointer] } });
    }
  },

  cancelTargeting: () => set({ targeting: null }),

  confirmTargeting: () => {
    // The caller (TargetSelector) reads `targeting` and dispatches the action.
    // We keep the state here so the component can read `collected` before clearing.
    set({ targeting: null });
  },

  enterAttackTargeting: (cardUuid) => {
    set({
      targeting: {
        cardUuid,
        zone: 'battlefield',
        actionId: 'attack',
        targeting: {
          type: 'permanent',
          cardTypes: ['Creature'],
          required: false,
          minTargets: 0,
          maxTargets: 1,
        },
        collected: [],
      },
    });
  },

  setError: (message) => set({ error: message }),

  toggleAttacker: (uuid) => {
    const { combatSelection } = get();
    const idx = combatSelection.attackers.indexOf(uuid);
    if (idx >= 0) {
      set({ combatSelection: { ...combatSelection, attackers: combatSelection.attackers.filter(a => a !== uuid) } });
    } else {
      set({ combatSelection: { ...combatSelection, attackers: [...combatSelection.attackers, uuid] } });
    }
  },

  selectBlocker: (uuid) => {
    const { combatSelection } = get();
    // Toggle: if already pending, deselect; otherwise set as pending
    if (combatSelection.pendingBlocker === uuid) {
      set({ combatSelection: { ...combatSelection, pendingBlocker: null } });
    } else {
      set({ combatSelection: { ...combatSelection, pendingBlocker: uuid } });
    }
  },

  assignBlocker: (attackerUuid) => {
    const { combatSelection } = get();
    if (!combatSelection.pendingBlocker) return;
    // Don't add duplicate pairs
    const alreadyPaired = combatSelection.blockerPairs.some(
      p => p.attackerUuid === attackerUuid && p.blockerUuid === combatSelection.pendingBlocker
    );
    if (alreadyPaired) {
      set({ combatSelection: { ...combatSelection, pendingBlocker: null } });
      return;
    }
    set({
      combatSelection: {
        ...combatSelection,
        blockerPairs: [
          ...combatSelection.blockerPairs,
          { attackerUuid, blockerUuid: combatSelection.pendingBlocker! },
        ],
        pendingBlocker: null,
      },
    });
  },

  clearCombatSelection: () => set({ combatSelection: EMPTY_COMBAT_SELECTION }),
}));

// ---------------------------------------------------------------------------
// Derived selectors (computed from room + myPlayerId)
// ---------------------------------------------------------------------------

export function selectMyPlayerId(state: GameStore): PlayerId | null {
  return state.myPlayerId;
}

export function selectMyHand(state: GameStore): CardInstance[] {
  const { room, myPlayerId } = state;
  if (!room || !myPlayerId) return [];
  return room.players[myPlayerId]?.hand ?? [];
}

export function selectMyBattlefield(state: GameStore): CardInstance[] {
  const { room, myPlayerId } = state;
  if (!room || !myPlayerId) return [];
  return room.battlefield.filter((c) => c.state.controllerId === myPlayerId);
}

export function selectOpponentBattlefield(state: GameStore): CardInstance[] {
  const { room, myPlayerId } = state;
  if (!room || !myPlayerId) return [];
  return room.battlefield.filter((c) => c.state.controllerId !== myPlayerId);
}

export function selectOpponentId(state: GameStore): PlayerId | null {
  const { room, myPlayerId } = state;
  if (!room || !myPlayerId) return null;
  return room.player1Id === myPlayerId ? room.player2Id : room.player1Id;
}

export function selectOpponentHandCount(state: GameStore): number {
  const { room } = state;
  const opponentId = selectOpponentId(state);
  if (!room || !opponentId) return 0;
  return room.players[opponentId]?.hand.length ?? 0;
}

export function selectIsMyTurn(state: GameStore): boolean {
  const { room, myPlayerId } = state;
  if (!room || !myPlayerId) return false;
  return room.activeTurnPlayerId === myPlayerId;
}

export function selectCurrentPhase(state: GameStore): Phase | null {
  return state.room?.phase ?? null;
}

export function selectRpsWaitingForOpponent(state: GameStore): boolean {
  const { room, myPlayerId } = state;
  if (!room || !myPlayerId) return false;
  if (room.status !== 'RPS') return false;
  const opponentId = selectOpponentId(state);
  if (!opponentId) return false;
  const myChoice = room.rpsState.playedCards[myPlayerId];
  const oppChoice = room.rpsState.playedCards[opponentId];
  return Boolean(myChoice) && !oppChoice;
}

/**
 * Does the current player have priority? (MTG 116)
 * Priority determines who can cast spells, activate abilities, or pass.
 * Only meaningful when the engine is waiting for a player to act — while the
 * stack is resolving or state-based actions run, priority is suspended.
 */
export function selectHasPriority(state: GameStore): boolean {
  const { room, myPlayerId } = state;
  if (!room || !myPlayerId) return false;
  if (room.engineState !== 'waiting_for_player') return false;
  return room.priorityPlayerId === myPlayerId;
}

export function selectTargeting(state: GameStore): TargetingState | null {
  return state.targeting;
}
