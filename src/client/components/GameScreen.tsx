import { useSocket } from '../hooks/useSocket';
import { useGameStore } from '../store/gameStore';
import PlayerInfo from './PlayerInfo';
import OpponentInfo from './OpponentInfo';
import Hand from './Hand';
import Battlefield from './Battlefield';
import StackDisplay from './StackDisplay';
import PhaseBar from './PhaseBar';
import GameLog from './GameLog';
import ContextMenu from './ContextMenu';
import TargetSelector from './TargetSelector';

export default function GameScreen() {
  useSocket();
  const roomId = useGameStore((s) => s.roomId);

  return (
    <div className="game-screen">
      <div className="room-banner">
        Room ID: <strong>{roomId}</strong>
      </div>
      <div className="column column-left">
        <OpponentInfo />
        <PlayerInfo />
        <PhaseBar />
      </div>
      <div className="column column-center">
        <StackDisplay />
        <Battlefield />
        <Hand />
      </div>
      <div className="column column-right">
        <GameLog />
      </div>
      <ContextMenu />
      <TargetSelector />
    </div>
  );
}