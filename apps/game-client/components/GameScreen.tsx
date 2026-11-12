import { useGameStore } from '../store/gameStore';
import { useRef } from 'react';
import { recoverBoard } from '../socket';
import { useBoardMotion } from '../presentation/useBoardMotion';
import { TargetingLines } from '../presentation/TargetingLines';
import '../presentation/board-effects.css';
import PlayerInfo from './PlayerInfo';
import OpponentInfo from './OpponentInfo';
import Hand from './Hand';
import Battlefield from './Battlefield';
import StackDisplay from './StackDisplay';
import CombatDisplay from './CombatDisplay';
import PhaseBar from './PhaseBar';
import LogDrawer from './LogDrawer';
import ContextMenu from './ContextMenu';
import TargetSelector from './TargetSelector';
import ChoicePanel from './ChoicePanel';
import CardObservations from './CardObservations';
import RotateGate from './RotateGate';
import RoomControls from './RoomControls';

export default function GameScreen() {
  const room = useGameStore((s) => s.room);
  const roomSync = useGameStore((s) => s.roomSync);
  const myPlayerId = useGameStore((s) => s.myPlayerId);
  const stage = useRef<HTMLDivElement>(null);
  const effects = useRef<HTMLDivElement>(null);
  useBoardMotion(stage, effects, room);

  const gameOver = room?.status === 'gameOver';
  const outcome = room?.outcome;
  const unavailable = roomSync !== 'live';
  const choiceOpen = !!room?.pendingChoice;
  const blocked = unavailable || gameOver || choiceOpen;
  const syncLabel = {
    waiting: 'Loading board',
    live: 'Live',
    offline: 'Connection lost',
    recovering: 'Restoring board',
    'sync-failed': 'Board sync timed out',
  }[roomSync];

  return (
    <>
      <RotateGate />
      <main className="game-screen" aria-label="Match">
        <div className="board-stage" ref={stage}>
          <div className="board-top">
            <div className="board-seat" inert={blocked}><OpponentInfo /></div>
            <div className="board-banner">
              <span className="board-sync" data-state={roomSync} role="status">{syncLabel}</span>
              {(roomSync === 'offline' || roomSync === 'sync-failed') &&
                <button onClick={() => recoverBoard()}>Retry</button>}
              <div inert={unavailable}><RoomControls /></div>
            </div>
          </div>
          <div className="board-field" inert={blocked}>
            <Battlefield center={<><StackDisplay /><CombatDisplay /></>} />
          </div>
          {gameOver && (
            <div role="status" className="game-outcome">
              <strong>{outcome?.type === 'draw' ? 'Draw' : outcome?.type === 'win'
                ? (outcome.winnerId === myPlayerId ? 'You win' : 'You lose') : 'Game over'}</strong>
              {outcome && <span>{outcome.type === 'draw'
                ? 'Both players reached zero or less life.'
                : outcome.losses.some(loss => loss.reason === 'concede') ? 'A player conceded.'
                : outcome.losses.some(loss => loss.reason === 'failed_draw') ? 'A player could not draw a card.'
                : 'A player reached zero or less life.'}</span>}
            </div>
          )}
          <div className="board-bottom">
            <div className="board-seat" inert={blocked}><PlayerInfo /></div>
            <div className="board-pill" inert={unavailable}>
              <PhaseBar />
              <CardObservations />
              {!gameOver && <ChoicePanel />}
            </div>
          </div>
          <div className="hand-dock" inert={blocked}>
            <Hand />
          </div>
          <LogDrawer />
          {!blocked && room && <TargetingLines board={stage} room={room} />}
          <div className="board-effects" ref={effects} aria-hidden="true" />
        </div>
        {!blocked && <ContextMenu />}
        {!blocked && <TargetSelector />}
      </main>
    </>
  );
}
