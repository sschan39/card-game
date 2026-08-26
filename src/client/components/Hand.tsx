import { useShallow } from 'zustand/react/shallow';
import { useGameStore, selectMyHand } from '../store/gameStore';
import CardComponent from './CardComponent';

export default function Hand() {
  const hand = useGameStore(useShallow(selectMyHand));

  return (
    <div className="hand">
      <h3>Your Hand ({hand.length})</h3>
      <div className="hand-cards">
        {hand.map((card) => (
          <CardComponent key={card.uuid} card={card} zone="hand" />
        ))}
      </div>
    </div>
  );
}