import { useEffect } from 'react';
import { useGameStore } from '../store/gameStore';
import socket from '../socket';
import { getOrCreatePlayerId } from '../session';

/**
 * Hook that binds socket events to the Zustand store.
 * Call once in the root component.
 *
 * myPlayerId is the STABLE player id (from sessionStorage), NOT socket.id —
 * socket.id changes on every reconnect and would break identity.
 */
export function useSocket() {
  const setMyPlayerId = useGameStore((s) => s.setMyPlayerId);

  useEffect(() => {
    // Set my player ID from the stable per-tab identity.
    setMyPlayerId(getOrCreatePlayerId());

    const handleConnect = () => {
      // On reconnect, keep the stable id (the server remaps socket.id → playerId).
      setMyPlayerId(getOrCreatePlayerId());
    };

    socket.on('connect', handleConnect);
    return () => {
      socket.off('connect', handleConnect);
    };
  }, [setMyPlayerId]);
}