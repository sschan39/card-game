import { useSocket } from '../hooks/useSocket';
import PlayerInfo from './PlayerInfo';
import OpponentInfo from './OpponentInfo';
import Hand from './Hand';
import Battlefield from './Battlefield';
import StackDisplay from './StackDisplay';
import PhaseBar from './PhaseBar';
import GameLog from './GameLog';
import ContextMenu from './ContextMenu';
import RpsPicker from './RpsPicker';

export default function GameScreen() {
  useSocket();

  return (
    <div className="game-screen">
      <div className="column column-left">
        <OpponentInfo />
        <PlayerInfo />
        <PhaseBar />
      </div>
      <div className="column column-center">
        <RpsPicker />
        <StackDisplay />
        <Battlefield />
        <Hand />
      </div>
      <div className="column column-right">
        <GameLog />
      </div>
      <ContextMenu />
    </div>
  );
}