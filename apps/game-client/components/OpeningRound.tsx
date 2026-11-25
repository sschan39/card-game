import { PROTOCOL_VERSION, RPS_PICKS } from '@card-game/protocol';
import socket from '../socket';
import { useGameStore } from '../store/gameStore';

export default function OpeningRound() {
  const roomId = useGameStore(state => state.roomId);
  const round = useGameStore(state => state.lobbyRps);
  const live = useGameStore(state => state.roomSync === 'live' && !state.matchPaused);
  const matchPaused = useGameStore(state => state.matchPaused);
  if (!round || !roomId) return <span>Waiting for opponent</span>;
  return <section aria-label="Choose who goes first">
    <p>{round.myPick ? 'Locked in: ' + round.myPick : 'Rock, Paper, Scissors'}</p>
    {matchPaused && <p role="status">Account service unavailable. Play will resume automatically.</p>}
    {!round.myPick && RPS_PICKS.map(pick => <button key={pick} type="button" disabled={!live}
      onClick={() => socket.emit('submitRps', { protocolVersion: PROTOCOL_VERSION, roomId, pick })}>
      {pick[0].toUpperCase() + pick.slice(1)}
    </button>)}
    <p role="status">{!round.myPick ? `Your turn to pick.${round.opponentReady ? ' Opponent is ready.' : ''}`
      : round.opponentReady ? 'Both picks are ready.' : 'Waiting for opponent’s pick'}</p>
  </section>;
}
