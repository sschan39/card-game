import { useMemo, useState, type ReactNode } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useGameStore, selectMyBattlefield, selectOpponentBattlefield } from '../store/gameStore';
import PermanentHalf from './board/PermanentHalf';
import { CardPreview, type PreviewRequest } from './board/CardPreview';
import { battlefieldAttachments } from '../presentation/permanent-statuses';
import { cardAnchor } from '../presentation/board-anchors';

/**
 * Two halves of the table with combat at the center line.
 */
export default function Battlefield({ center }: { center?: ReactNode } = {}) {
  const myBattlefield = useGameStore(useShallow(selectMyBattlefield));
  const opponentBattlefield = useGameStore(useShallow(selectOpponentBattlefield));
  const room = useGameStore(s => s.room);
  const cards = room?.battlefield;
  const attachments = useMemo(() => battlefieldAttachments(cards ?? []), [cards]);
  const [preview, setPreview] = useState<PreviewRequest | null>(null);
  const inspected = preview && cards?.find(card => cardAnchor('battlefield', card) === preview.anchor);

  return (
    <div className="battlefield">
      <h2 className="sr-only">Permanents</h2>
      <PermanentHalf cards={opponentBattlefield} side="opponent" attachments={attachments} onPreview={setPreview} />
      <div className="battlefield-center">
        <div className="battlefield-divider">
          {room?.status === 'playing' && <span>Turn {room.turnNumber}</span>}
          {room?.status === 'waiting' && <span>Waiting for opponent</span>}
          {room?.status === 'RPS' && <span>Rock, Paper, Scissors</span>}
        </div>
        {center}
      </div>
      <PermanentHalf cards={myBattlefield} side="you" attachments={attachments} onPreview={setPreview} />
      {preview && inspected && <CardPreview card={inspected} rect={preview.rect} attachments={attachments.get(preview.anchor)} />}
    </div>
  );
}
