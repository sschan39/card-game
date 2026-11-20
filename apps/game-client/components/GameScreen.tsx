import { useGameStore } from '../store/gameStore';
import { useEffect, useRef, useState } from 'react';
import { CardBack, usePageEntrance, useT, type MessageKey } from '@card-game/ui';
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

/** Board-sync state to its interface key; one entry per value the store can hold. */
const SYNC_KEYS: Record<string, MessageKey> = {
  waiting: 'board.syncWaiting',
  live: 'board.syncLive',
  offline: 'board.syncOffline',
  recovering: 'board.syncRecovering',
  'sync-failed': 'board.syncFailed',
};

export default function GameScreen({ leaving = false }: { leaving?: boolean } = {}) {
  const t = useT();
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

  /* The deal-in plays as soon as a snapshot exists — the host waits in an empty room
     with no hand, so gating on `playing` alone meant nothing ever animated — and it
     replays when the first hand arrives. A language switch or reconnect changes neither
     flag, so it does not replay. */
  const playing = room?.status === 'playing';
  const hasRoom = !!room;
  const hasHand = useGameStore((s) => (s.room && s.myPlayerId ? (s.room.players[s.myPlayerId]?.hand?.length ?? 0) > 0 : false));
  const [dealing, setDealing] = useState(false);
  useEffect(() => {
    if (!hasRoom) return undefined;
    setDealing(true);
    const timer = setTimeout(() => setDealing(false), 1600);
    return () => clearTimeout(timer);
  }, [hasRoom, playing, hasHand]);

  const gameOver = room?.status === 'gameOver';
  const outcome = room?.outcome;
  const unavailable = roomSync !== 'live';
  const choiceOpen = !!room?.pendingChoice;
  const blocked = unavailable || gameOver || choiceOpen;
  const syncLabel = t(SYNC_KEYS[roomSync] ?? 'board.syncWaiting');
  const outcomeTitle: MessageKey = outcome?.type === 'draw' ? 'board.outcomeDraw'
    : outcome?.type === 'win' ? (outcome.winnerId === myPlayerId ? 'board.outcomeWin' : 'board.outcomeLose') : 'board.outcomeOver';

  return (
    <>
      <RotateGate />
      <main className="game-screen" aria-label={t('board.match')} data-page-leaving={leaving} data-deal={dealing ? 'on' : undefined}>
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
              <button onClick={() => recoverBoard()}>{t('board.retry')}</button>}
            <div inert={unavailable}><RoomControls /></div>
          </div>
          <div className="board-seat board-top" inert={blocked}><OpponentInfo /></div>
          <div className="board-field" inert={blocked}>
            <Battlefield center={<CombatDisplay />} />
          </div>
          {gameOver && (
            <div role="status" className="game-outcome">
              <strong>{t(outcomeTitle)}</strong>
              {outcome && <span>{t(outcome.type === 'draw' ? 'board.outcomeBothZero'
                : outcome.losses.some(loss => loss.reason === 'concede') ? 'board.outcomeConcede'
                : outcome.losses.some(loss => loss.reason === 'failed_draw') ? 'board.outcomeFailedDraw'
                : 'board.outcomeZero')}</span>}
            </div>
          )}
          <div className="board-seat board-bottom" inert={blocked}><PlayerInfo /></div>
          <aside className="board-rail" aria-label={t('board.rail')}>
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
