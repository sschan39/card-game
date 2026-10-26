import { PROTOCOL_VERSION } from '@card-game/protocol';
import { useCallback } from 'react';
import { useGameStore } from '../store/gameStore';
import socket from '../socket';
import type { TargetPointer } from '@card-game/protocol';
import type { ActionIdOrAbility } from '@card-game/protocol';
import { clientLogger } from '../logger';
import { clientFlags as gameConfig } from '@card-game/protocol';
import { choiceAnswerDetails } from '@card-game/protocol';

/**
 * Hook providing typed action dispatchers for the client.
 */
export function useGameActions() {
  const roomId = useGameStore((s) => s.roomId);
  const requestOptions = useGameStore((s) => s.requestOptions);

  const createRoom = useCallback(() => {
    useGameStore.getState().setError(null);
    if (gameConfig.logging.actions) clientLogger.info('room:create', 'Creating room', { playerId: useGameStore.getState().myPlayerId });
    socket.emit('createRoom', { protocolVersion: PROTOCOL_VERSION });
  }, []);

  const joinRoom = useCallback(
    (id: string) => {
      useGameStore.getState().setError(null);
      if (gameConfig.logging.actions) clientLogger.info('room:join', 'Joining room', { roomId: id, playerId: useGameStore.getState().myPlayerId });
      socket.emit('joinRoom', { protocolVersion: PROTOCOL_VERSION, roomId: id });
    },
    [],
  );

  const playerAction = useCallback(
    (actionId: ActionIdOrAbility, cardUuid?: string, targets?: TargetPointer[], extraData?: Record<string, unknown>) => {
      if (socket.disconnected === true) { useGameStore.getState().setError('Reconnect before sending an action.'); return; }
      if (!roomId || useGameStore.getState().room?.status === 'gameOver') return;
      const commandId = crypto.randomUUID();
      useGameStore.getState().setError(null);
      if (gameConfig.logging.actions) clientLogger.info('action:sent', 'Player action sent', {
        roomId, commandId, action: actionId, playerId: useGameStore.getState().myPlayerId, cardUuid,
        choiceId: extraData?.choiceId, cancel: extraData?.cancel, targets: targets?.length,
        ...choiceAnswerDetails(extraData),
      });
      socket.emit('playerAction', { protocolVersion: PROTOCOL_VERSION, roomId, actionId, cardUuid, targets, ...extraData, commandId });
    },
    [roomId],
  );

  const getOptions = useCallback(
    (cardUuid: string, zone: 'hand' | 'battlefield', position?: { x: number; y: number }) => {
      if (socket.disconnected === true) return;
      if (!roomId || useGameStore.getState().room?.status === 'gameOver') return;
      requestOptions(cardUuid, zone, position);
      if (gameConfig.logging.actions) clientLogger.info('options:requested', 'Requesting card actions', { roomId, cardUuid, zone });
      socket.emit('getOptions', { protocolVersion: PROTOCOL_VERSION, roomId, cardUuid, zone });
    },
    [roomId, requestOptions],
  );

  return { createRoom, joinRoom, playerAction, getOptions };
}
