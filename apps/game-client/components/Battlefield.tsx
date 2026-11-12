import { useState, type ReactNode } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useGameStore, selectMyBattlefield, selectOpponentBattlefield } from '../store/gameStore';
import PermanentHalf from './board/PermanentHalf';
import { CardPreview, type PreviewRequest } from './board/CardPreview';
import { STACK_LANE } from '../presentation/board-anchors';

/**
 * Two halves of the table with a shared center lane for stack and combat.
 */
export default function Battlefield({ center }: { center?: ReactNode } = {}) {
  const myBattlefield = useGameStore(useShallow(selectMyBattlefield));
  const opponentBattlefield = useGameStore(useShallow(selectOpponentBattlefield));
  const status = useGameStore(s => s.room?.status);
  const turn = useGameStore(s => s.room?.turnNumber);
  const [preview, setPreview] = useState<PreviewRequest | null>(null);

  return (
    <div className="battlefield">
      <h2 className="sr-only">Permanents</h2>
      <PermanentHalf cards={opponentBattlefield} side="opponent" onPreview={setPreview} />
      <div className="battlefield-center" data-board-anchor={STACK_LANE}>
        <div className="battlefield-divider">
          {status === 'playing' && <span>Turn {turn}</span>}
          {status === 'waiting' && <span>Waiting for opponent</span>}
          {status === 'RPS' && <span>Rock, Paper, Scissors</span>}
        </div>
        {center}
      </div>
      <PermanentHalf cards={myBattlefield} side="you" onPreview={setPreview} />
      {preview && <CardPreview card={preview.card} rect={preview.rect} />}
    </div>
  );
}
