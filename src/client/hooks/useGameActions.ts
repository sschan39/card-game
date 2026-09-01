import { useCallback } from 'react';
import { useGameStore } from '../store/gameStore';
import socket from '../socket';
import type { TargetPointer } from '../../types/effect.types';

/**
 * Hook providing typed action dispatchers for the client.
 */
export function useGameActions() {
  const roomId = useGameStore((s) => s.roomId);
  const requestOptions = useGameStore((s) => s.requestOptions);

  const createRoom = useCallback(() => {
    socket.emit('createRoom');
  }, []);

  const joinRoom = useCallback(
    (id: string) => {
      socket.emit('joinRoom', { roomId: id });
    },
    [],
  );

  const playerAction = useCallback(
    (actionId: string, cardUuid?: string, targets?: TargetPointer[]) => {
      if (!roomId) return;
      socket.emit('playerAction', { roomId, actionId, cardUuid, targets });
    },
    [roomId],
  );

  const getOptions = useCallback(
    (cardUuid: string, zone: 'hand' | 'battlefield') => {
      if (!roomId) return;
      requestOptions(cardUuid, zone);
      socket.emit('getOptions', { roomId, cardUuid, zone });
    },
    [roomId, requestOptions],
  );

  const submitChoice = useCallback(
    (choice: 'rock' | 'paper' | 'scissors') => {
      if (!roomId) return;
      socket.emit('submitChoice', { roomId, choice });
    },
    [roomId],
  );

  return { createRoom, joinRoom, playerAction, getOptions, submitChoice };
}