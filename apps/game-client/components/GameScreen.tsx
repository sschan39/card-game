import { useGameStore } from '../store/gameStore';
import { useRef } from 'react';
import { CardBack, usePageEntrance } from '@card-game/ui';
import { recoverBoard } from '../socket';
import { useBoardMotion } from '../presentation/useBoardMotion';
import { TargetingLines } from '../presentation/TargetingLines';
import { STACK_LANE } from '../presentation/board-anchors';
import '../presentation/board-effects.css';
import battleTable from '../assets/battle-table.webp';
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

export default function GameScreen({ leaving = false }: { leaving?: boolean } = {}) {
  const room = useGameStore((s) => s.room);
  const roomSync = useGameStore((s) => s.roomSync);
  const myPlayerId = useGameStore((s) => s.myPlayerId);
  const stage = useRef<HTMLDivElement>(null);
  const effects = useRef<HTMLDivElement>(null);
  useBoardMotion(stage, effects, room);
  /* Every seat, the field and the hand read from `room`, which starts null: the board
     that mounts before the snapshot is an empty shell. The entrance therefore waits
     for the live sync, and the skeleton below holds the geometry in the meantime. */
  const entered = usePageEntrance({ ready: roomSync === 'live' && !!room, images: [battleTable] });

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
      <main className="game-screen" aria-label="Match" data-page-leaving={leaving}>
        {/* The board's own geometry, held while the snapshot is in flight: banner,
            both seats, the field and five card backs in the hand dock. */}
        <div className="board-skeleton" data-page-skeleton data-entered={entered} aria-hidden="true">
          <div className="board-skeleton-banner skeleton-block" />
          <div className="board-skeleton-seat skeleton-block" />
          <div className="board-skeleton-field skeleton-block" />
          <div className="board-skeleton-seat skeleton-block" />
          <div className="board-skeleton-hand">
            {Array.from({ length: 5 }, (_, index) => <CardBack key={index} className="board-skeleton-card" />)}
          </div>
        </div>
        <div className="board-stage" data-page-stage data-entered={entered} ref={stage}>
          <div className="board-banner">
            <span className="board-sync" data-state={roomSync} role="status">{syncLabel}</span>
            {(roomSync === 'offline' || roomSync === 'sync-failed') &&
              <button onClick={() => recoverBoard()}>Retry</button>}
            <div inert={unavailable}><RoomControls /></div>
          </div>
          <div className="board-seat board-top" inert={blocked}><OpponentInfo /></div>
          <div className="board-field" inert={blocked}>
            <Battlefield center={<CombatDisplay />} />
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
          <div className="board-seat board-bottom" inert={blocked}><PlayerInfo /></div>
          <aside className="board-rail" aria-label="Stack and phase controls">
            <div className="board-stack" data-board-anchor={STACK_LANE} inert={blocked}><StackDisplay /></div>
            <div className="board-pill" inert={unavailable}>
              <PhaseBar />
              <CardObservations />
              {!gameOver && <ChoicePanel />}
            </div>
          </aside>
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
