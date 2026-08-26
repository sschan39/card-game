import { useShallow } from 'zustand/react/shallow';
import { useGameStore, selectMyBattlefield, selectOpponentBattlefield } from '../store/gameStore';
import CardComponent from './CardComponent';

export default function Battlefield() {
  const myBattlefield = useGameStore(useShallow(selectMyBattlefield));
  const opponentBattlefield = useGameStore(useShallow(selectOpponentBattlefield));

  return (
    <div className="battlefield">
      <div className="battlefield-row">
        <h4>Opponent's Permanents</h4>
        <div className="battlefield-cards">
          {opponentBattlefield.map((card) => (
            <CardComponent key={card.uuid} card={card} zone="battlefield" />
          ))}
        </div>
      </div>
      <div className="battlefield-row">
        <h4>Your Permanents</h4>
        <div className="battlefield-cards">
          {myBattlefield.map((card) => (
            <CardComponent key={card.uuid} card={card} zone="battlefield" />
          ))}
        </div>
      </div>
    </div>
  );
}