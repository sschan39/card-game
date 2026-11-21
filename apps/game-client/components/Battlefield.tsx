import { useMemo, type ReactNode } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useGameStore, selectMyBattlefield, selectOpponentBattlefield } from '../store/gameStore';
import OpeningRound from './OpeningRound';
import PermanentHalf from './board/PermanentHalf';
import { battlefieldAttachments } from '../presentation/permanent-statuses';
import { cardAnchor } from '../presentation/board-anchors';

/**
 * Two halves of the table with combat at the center line.
 */
export default function Battlefield({ center }: { center?: ReactNode } = {}) {
  const myBattlefield = useGameStore(useShallow(selectMyBattlefield));
  const opponentBattlefield = useGameStore(useShallow(selectOpponentBattlefield));
  const room = useGameStore(s => s.room);
  const opening = useGameStore(s => s.openingResult);
  const viewerId = useGameStore(s => s.myPlayerId);
  const seat = viewerId === room?.player1Id ? 0 : 1;
  const cards = room?.battlefield;
  const attachments = useMemo(() => battlefieldAttachments(cards ?? []), [cards]);
  const tucked = useMemo(() => new Set([...attachments.values()].flat()
    .map(card => cardAnchor('battlefield', card)).filter(anchor => !attachments.has(anchor))), [attachments]);

  return (
    <div className="battlefield">
      <h2 className="sr-only">Permanents</h2>
      <PermanentHalf cards={opponentBattlefield} side="opponent" attachments={attachments} tucked={tucked} />
      <div className="battlefield-center">
        <div className="battlefield-divider">
          {room?.status === 'playing' && <span>Turn {room.turnNumber}</span>}
          {room?.status === 'waiting' && <OpeningRound />}
          {room?.status === 'playing' && opening && <span role="status">You: {opening.picks[seat]} · Opponent: {opening.picks[1 - seat]} · {opening.picks[0] === opening.picks[1] && 'Tie goes to the host · '}{opening.firstPlayerId === viewerId ? 'You go first' : 'Opponent goes first'}</span>}
        </div>
        {center}
      </div>
      <PermanentHalf cards={myBattlefield} side="you" attachments={attachments} tucked={tucked} />
    </div>
  );
}
