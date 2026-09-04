import { create } from 'zustand';
import type { GameRoom, PlayerId } from '../../types/game.room.types';
import type { CardInstance } from '../../types/card.types';
import type { GameStateName } from '../../types/game.state.types';
import type { StateDelta } from '../../types/delta.types';
import type { ActionOption } from '../../engine/option-service';
import type { TargetPointer, TargetingDefinition } from '../../types/effect.types';
import type { ActionIdOrAbility } from '../../types/action.ids';
import { applyDeltaChanges } from './deltaReducer';

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

  // Actions
  applyDelta: (delta: StateDelta) => void;
  setRoom: (room: GameRoom) => void;
  setRoomId: (id: string) => void;
  setMyPlayerId: (id: string) => void;
  requestOptions: (cardUuid: string, zone: 'hand' | 'battlefield') => void;
  showContextMenu: (options: ActionOption[]) => void;
  hideContextMenu: () => void;
  beginTargeting: (state: TargetingState) => void;
  addTarget: (pointer: TargetPointer) => void;
  removeTarget: (pointer: TargetPointer) => void;
  cancelTargeting: () => void;
  confirmTargeting: () => void;
  setError: (message: string) => void;
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

  applyDelta: (delta) => {
    const current = get().room;
    if (!current) return;

    const nextRoom = applyDeltaChanges(current, delta.changes);

    set((state) => ({
      room: nextRoom,
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

  setRoom: (room) => set({ room }),

  setRoomId: (id) => set({ roomId: id }),
  setMyPlayerId: (id) => set({ myPlayerId: id }),

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

  cancelTargeting: () => set({ targeting: null }),

  confirmTargeting: () => {
    // The caller (TargetSelector) reads `targeting` and dispatches the action.
    // We keep the state here so the component can read `collected` before clearing.
    set({ targeting: null });
  },

  setError: (message) => set({ error: message }),
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

export function selectCurrentPhase(state: GameStore): GameStateName | null {
  return state.room?.currentPhase ?? null;
}

export function selectRpsWaitingForOpponent(state: GameStore): boolean {
  const { room, myPlayerId } = state;
  if (!room || !myPlayerId) return false;
  if (room.currentPhase !== 'RPS') return false;
  const opponentId = selectOpponentId(state);
  if (!opponentId) return false;
  const myChoice = room.rpsState.playedCards[myPlayerId];
  const oppChoice = room.rpsState.playedCards[opponentId];
  return Boolean(myChoice) && !oppChoice;
}

/**
 * Does the current player have priority? (MTG 116)
 * Priority determines who can cast spells, activate abilities, or pass.
 */
export function selectHasPriority(state: GameStore): boolean {
  const { room, myPlayerId } = state;
  if (!room || !myPlayerId) return false;
  return room.priorityPlayerId === myPlayerId;
}
