import { useCallback } from 'react';
import { useGameStore } from '../store/gameStore';
import socket from '../socket';
import type { TargetPointer } from '../../types/effect.types';
import type { ActionIdOrAbility } from '../../types/action.ids';
import { clientLogger } from '../../shared/game-logger';
import { gameConfig } from '../../config';
import { getOrCreatePlayerId } from '../session';

/**
 * Hook providing typed action dispatchers for the client.
 */
export function useGameActions() {
  const roomId = useGameStore((s) => s.roomId);
  const requestOptions = useGameStore((s) => s.requestOptions);

  const createRoom = useCallback(() => {
    useGameStore.getState().setError(null);
    if (gameConfig.logging.actions) clientLogger.info('room:create', 'Creating room', { playerId: getOrCreatePlayerId() });
    socket.emit('createRoom');
  }, []);

  const joinRoom = useCallback(
    (id: string) => {
      useGameStore.getState().setError(null);
      if (gameConfig.logging.actions) clientLogger.info('room:join', 'Joining room', { roomId: id, playerId: getOrCreatePlayerId() });
      socket.emit('joinRoom', { roomId: id });
    },
    [],
  );

  const playerAction = useCallback(
    (actionId: ActionIdOrAbility, cardUuid?: string, targets?: TargetPointer[], extraData?: Record<string, unknown>) => {
      if (!roomId || useGameStore.getState().room?.status === 'gameOver') return;
      const commandId = crypto.randomUUID();
      useGameStore.getState().setError(null);
      if (gameConfig.logging.actions) clientLogger.info('action:sent', 'Player action sent', {
        roomId, commandId, action: actionId, playerId: useGameStore.getState().myPlayerId, cardUuid,
        choiceId: extraData?.choiceId, cancel: extraData?.cancel, targets: targets?.length,
      });
      socket.emit('playerAction', { roomId, actionId, cardUuid, targets, ...extraData, commandId });
    },
    [roomId],
  );

  const getOptions = useCallback(
    (cardUuid: string, zone: 'hand' | 'battlefield', position?: { x: number; y: number }) => {
      if (!roomId || useGameStore.getState().room?.status === 'gameOver') return;
      requestOptions(cardUuid, zone, position);
      if (gameConfig.logging.actions) clientLogger.info('options:requested', 'Requesting card actions', { roomId, cardUuid, zone });
      socket.emit('getOptions', { roomId, cardUuid, zone });
    },
    [roomId, requestOptions],
  );

  return { createRoom, joinRoom, playerAction, getOptions };
}
