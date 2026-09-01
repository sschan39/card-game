import { create } from 'zustand';
import type { GameRoom, PlayerId } from '../../types/game.room.types';
import type { CardInstance } from '../../types/card.types';
import type { GameStateName } from '../../types/game.state.types';
import type { StateDelta } from '../../types/delta.types';
import type { ActionOption } from '../../engine/option-service';
import { applyDeltaChanges } from './deltaReducer';

export interface ContextMenuState {
  x: number;
  y: number;
  cardUuid: string;
  zone: 'hand' | 'battlefield';
  options: ActionOption[];
}

interface GameStore {
  // Server-authoritative state
  room: GameRoom | null;
  roomId: string | null;
  myPlayerId: string | null;

  // UI state (client-only)
  contextMenu: ContextMenuState | null;
  pendingCard: { cardUuid: string; zone: 'hand' | 'battlefield' } | null;
  error: string | null;
  rpsPrompt: string | null;
  log: { seq: number; action?: string; playerId?: string; changes: number }[];

  // Actions
  applyDelta: (delta: StateDelta) => void;
  setRoom: (room: GameRoom) => void;
  setRoomId: (id: string) => void;
  setMyPlayerId: (id: string) => void;
  requestOptions: (cardUuid: string, zone: 'hand' | 'battlefield') => void;
  showContextMenu: (options: ActionOption[]) => void;
  hideContextMenu: () => void;
  setError: (message: string) => void;
  setRpsPrompt: (message: string) => void;
}

export const useGameStore = create<GameStore>((set, get) => ({
  room: null,
  roomId: null,
  myPlayerId: null,
  contextMenu: null,
  pendingCard: null,
  error: null,
  rpsPrompt: null,
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

  setError: (message) => set({ error: message }),

  setRpsPrompt: (message) => set({ rpsPrompt: message }),
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
