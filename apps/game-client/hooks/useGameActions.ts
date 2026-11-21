import { PROTOCOL_VERSION } from '@card-game/protocol';
import { useCallback } from 'react';
import { useGameStore } from '../store/gameStore';
import socket from '../socket';
import { useMatchConnection } from '../match-connection';
import type { TargetPointer } from '@card-game/protocol';
import type { ActionIdOrAbility, PlayerActionReceipt } from '@card-game/protocol';
import { clientLogger } from '../logger';
import { clientFlags as gameConfig } from '../config';
import { choiceAnswerDetails } from '@card-game/protocol';

function boardUnavailable() {
  const status = useGameStore.getState().roomSync;
  return status === 'offline' || status === 'recovering' || status === 'sync-failed';
}

/**
 * Hook providing typed action dispatchers for the client.
 */
export function useGameActions() {
  const roomId = useGameStore((s) => s.roomId);
  const requestOptions = useGameStore((s) => s.requestOptions);
  const { socket: matchSocket } = useMatchConnection();

  const createRoom = useCallback((deckId?: string) => {
    useGameStore.getState().setError(null);
    if (gameConfig.logging.actions) clientLogger.info('room:create', 'Creating room', { playerId: useGameStore.getState().myPlayerId });
    socket.emit('createRoom', { protocolVersion: PROTOCOL_VERSION, ...(deckId ? { deckId } : {}) });
  }, []);

  const joinRoom = useCallback(
    (id: string, deckId?: string) => {
      useGameStore.getState().setError(null);
      if (gameConfig.logging.actions) clientLogger.info('room:join', 'Joining room', { roomId: id, playerId: useGameStore.getState().myPlayerId });
      socket.emit('joinRoom', { protocolVersion: PROTOCOL_VERSION, roomId: id, ...(deckId ? { deckId } : {}) });
    },
    [],
  );

  const playerAction = useCallback(
    (actionId: ActionIdOrAbility, cardUuid?: string, targets?: TargetPointer[], extraData?: Record<string, unknown>,
      acknowledge?: (receipt?: PlayerActionReceipt) => void) => {
      if (matchSocket.disconnected === true) { useGameStore.getState().setError('Reconnect before sending an action.'); return; }
      if (boardUnavailable()) return;
      if (!roomId || useGameStore.getState().room?.status === 'gameOver') return;
      const commandId = crypto.randomUUID();
      useGameStore.getState().setError(null);
      if (gameConfig.logging.actions) clientLogger.info('action:sent', 'Player action sent', {
        roomId, commandId, action: actionId, playerId: useGameStore.getState().myPlayerId, cardUuid,
        choiceId: extraData?.choiceId, cancel: extraData?.cancel, targets: targets?.length,
        ...choiceAnswerDetails(extraData),
      });
      const packet = { protocolVersion: PROTOCOL_VERSION, roomId, actionId, cardUuid, targets, ...extraData, commandId };
      if (acknowledge) {
        const receipt: Promise<PlayerActionReceipt> = matchSocket.timeout(5000).emitWithAck('playerAction', packet);
        void receipt.then(acknowledge, () => acknowledge());
      } else matchSocket.emit('playerAction', packet);
      return commandId;
    },
    [roomId, matchSocket],
  );

  const getOptions = useCallback(
    (cardUuid: string, zone: 'hand' | 'battlefield', position?: { x: number; y: number }) => {
      if (matchSocket.disconnected === true || boardUnavailable()) return;
      if (!roomId || useGameStore.getState().room?.status === 'gameOver') return;
      requestOptions(cardUuid, zone, position);
      if (gameConfig.logging.actions) clientLogger.info('options:requested', 'Requesting card actions', { roomId, cardUuid, zone });
      matchSocket.emit('getOptions', { protocolVersion: PROTOCOL_VERSION, roomId, cardUuid, zone });
    },
    [roomId, requestOptions, matchSocket],
  );

  const leaveRoom = useCallback(() => {
    if (!roomId) return;
    if (matchSocket.disconnected === true) {
      useGameStore.getState().setError('Reconnect before leaving the room.'); return;
    }
    useGameStore.getState().setError(null);
    matchSocket.emit('leaveRoom', { protocolVersion: PROTOCOL_VERSION, roomId });
  }, [roomId, matchSocket]);

  const setAutoPass = useCallback((enabled: boolean, untilTurn?: number) => {
    if (!roomId) return;
    if (matchSocket.disconnected === true) {
      useGameStore.getState().setError('Reconnect before changing auto-pass.'); return;
    }
    if (boardUnavailable()) return;
    matchSocket.emit('setAutoPass', { protocolVersion: PROTOCOL_VERSION, roomId, enabled,
      ...(untilTurn === undefined ? {} : { untilTurn }) });
  }, [roomId, matchSocket]);

  return { createRoom, joinRoom, playerAction, getOptions, leaveRoom, setAutoPass };
}
