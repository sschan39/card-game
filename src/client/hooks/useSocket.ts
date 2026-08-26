import { useEffect } from 'react';
import { useGameStore } from '../store/gameStore';
import socket from '../socket';

/**
 * Hook that binds socket events to the Zustand store.
 * Call once in the root component.
 */
export function useSocket() {
  const setMyPlayerId = useGameStore((s) => s.setMyPlayerId);

  useEffect(() => {
    // Set my player ID from the socket connection
    if (socket.id) {
      setMyPlayerId(socket.id);
    }

    const handleConnect = () => {
      setMyPlayerId(socket.id!);
    };

    socket.on('connect', handleConnect);
    return () => {
      socket.off('connect', handleConnect);
    };
  }, [setMyPlayerId]);
}