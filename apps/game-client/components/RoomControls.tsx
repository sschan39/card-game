import { useGameStore } from '../store/gameStore';
import { useGameActions } from '../hooks/useGameActions';
import { useConfirmation } from '@card-game/ui';
import { useMatchConnection } from '../match-connection';

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
  const { confirm, dialog } = useConfirmation();
  const { playtest } = useMatchConnection();
  const active = room?.legalActions?.actions.includes('concede') ?? (!!room?.player2Id && room.status === 'playing');
  if (playtest) return null;
  return <div className="room-controls">
    {dialog}
    {active && <button onClick={async () => {
      if (await confirm({ title: 'Concede this match?', message: 'Your opponent will win.', confirmLabel: 'Concede' })) playerAction('concede');
    }}><FlagIcon />Concede</button>}
    <button onClick={async () => {
      if (!active || await confirm({ title: 'Concede and leave?', message: 'Your opponent will win and you’ll return to the lobby.', confirmLabel: 'Concede & Leave' })) leaveRoom();
    }}><LeaveIcon />{active ? 'Concede & Leave' : 'Leave room'}</button>
  </div>;
}
