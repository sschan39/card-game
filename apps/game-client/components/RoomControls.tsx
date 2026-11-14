import { useGameStore } from '../store/gameStore';
import AutoPassControl from './AutoPassControl';
import { useGameActions } from '../hooks/useGameActions';

/** White flag: the standard "give up" glyph, drawn as a stroke so it inherits the
    button's own colour. */
function FlagIcon() {
  return (
    <svg className="button-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M5 3v18" />
      <path d="M5 4h11l-1.6 3.5L16 11H5z" />
    </svg>
  );
}

/** Leaving the room: a door frame with an arrow pointing out of it. */
function LeaveIcon() {
  return (
    <svg className="button-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M14 4h4a1.5 1.5 0 0 1 1.5 1.5v13A1.5 1.5 0 0 1 18 20h-4" />
      <path d="M10 8l-4 4 4 4" />
      <path d="M6 12h9" />
    </svg>
  );
}

/** Explicit exits are available even while an opponent owns priority or a choice is open. */
export default function RoomControls() {
  const room = useGameStore(state => state.room);
  const { playerAction, leaveRoom } = useGameActions();
  const active = !!room?.player2Id && (room.status === 'playing' || room.status === 'RPS');
  return <div className="room-controls">
    {active && <AutoPassControl />}
    {active && <button onClick={() => {
      if (window.confirm('Concede this match? Your opponent will win.')) playerAction('concede');
    }}><FlagIcon />Concede</button>}
    <button onClick={() => {
      if (!active || window.confirm('Leave this room and concede the match?')) leaveRoom();
    }}><LeaveIcon />{active ? 'Concede & Leave' : 'Leave room'}</button>
  </div>;
}
