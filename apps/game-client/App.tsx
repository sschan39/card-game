import { useGameStore } from './store/gameStore';
import StartScreen from './components/StartScreen';
import GameScreen from './components/GameScreen';
import AccountControls from './components/AccountControls';

export default function App() {
  const roomId = useGameStore((s) => s.roomId);
  const error = useGameStore(s => s.error);
  const setError = useGameStore(s => s.setError);

  return <>
    <AccountControls />
    {error && <div className="action-error" role="alert">
      <span>{error}</span><button onClick={() => setError(null)}>Dismiss</button>
    </div>}
    {roomId ? <GameScreen /> : <StartScreen />}
  </>;
}
