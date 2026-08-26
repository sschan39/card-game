import { useState } from 'react';
import { useGameActions } from '../hooks/useGameActions';
import { useGameStore } from '../store/gameStore';

export default function StartScreen() {
  const { createRoom, joinRoom } = useGameActions();
  const roomId = useGameStore((s) => s.roomId);
  const [joinId, setJoinId] = useState('');

  return (
    <div className="start-screen">
      <h1>Multiplayer Card Game</h1>
      <button onClick={createRoom}>Create New Room</button>
      <div>
        <input
          type="text"
          placeholder="Enter Room ID to join"
          value={joinId}
          onChange={(e) => setJoinId(e.target.value)}
        />
        <button onClick={() => joinRoom(joinId)} disabled={!joinId.trim()}>
          Join Room
        </button>
      </div>
      {roomId && <p>Your Room ID: <strong>{roomId}</strong></p>}
    </div>
  );
}