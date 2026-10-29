import { useGameStore } from '../store/gameStore';
import PlayerInfo from './PlayerInfo';
import OpponentInfo from './OpponentInfo';
import Hand from './Hand';
import Battlefield from './Battlefield';
import StackDisplay from './StackDisplay';
import CombatDisplay from './CombatDisplay';
import PhaseBar from './PhaseBar';
import GameLog from './GameLog';
import ContextMenu from './ContextMenu';
import TargetSelector from './TargetSelector';
import ChoicePanel from './ChoicePanel';

export default function GameScreen() {
  const roomId = useGameStore((s) => s.roomId);
  const room = useGameStore((s) => s.room);
  const myPlayerId = useGameStore((s) => s.myPlayerId);
  const gameOver = room?.status === 'gameOver';
  const outcome = room?.outcome;

  return (
    <div className="game-screen">
      <div className="room-banner">
        Room ID: <strong>{roomId}</strong>
        {gameOver && (
          <div role="status" className="game-outcome">
            <strong>{outcome?.type === 'draw' ? 'Draw' : outcome?.type === 'win'
              ? (outcome.winnerId === myPlayerId ? 'You win' : 'You lose') : 'Game over'}</strong>
            {outcome && <span> — {outcome.type === 'draw'
              ? 'Both players reached zero or less life.'
              : 'A player reached zero or less life.'}</span>}
          </div>
        )}
      </div>
      <div className="column column-left">
        <OpponentInfo />
        <PlayerInfo />
        <PhaseBar />
        {!gameOver && <ChoicePanel />}
      </div>
      <div className="column column-center" inert={gameOver || !!room?.pendingChoice}>
        <StackDisplay />
        <CombatDisplay />
        <Battlefield />
        <Hand />
      </div>
      <div className="column column-right">
        <GameLog />
      </div>
      {!gameOver && !room?.pendingChoice && <ContextMenu />}
      {!gameOver && !room?.pendingChoice && <TargetSelector />}
    </div>
  );
}
