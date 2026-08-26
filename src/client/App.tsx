import { useGameStore } from './store/gameStore';
import StartScreen from './components/StartScreen';
import GameScreen from './components/GameScreen';

export default function App() {
  const roomId = useGameStore((s) => s.roomId);

  if (!roomId) {
    return <StartScreen />;
  }

  return <GameScreen />;
}