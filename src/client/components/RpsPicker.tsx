import { useGameStore, selectCurrentPhase } from '../store/gameStore';
import { useGameActions } from '../hooks/useGameActions';

const CHOICES: Array<{ id: 'rock' | 'paper' | 'scissors'; label: string; emoji: string; beats: string }> = [
  { id: 'rock', label: 'Rock', emoji: '🪨', beats: 'scissors' },
  { id: 'paper', label: 'Paper', emoji: '📄', beats: 'rock' },
  { id: 'scissors', label: 'Scissors', emoji: '✂️', beats: 'paper' },
];

/**
 * Rock/Paper/Scissors coin-flip stage. Both players pick a gesture; a tie
 * re-prompts, a non-tie advances the game with the winner taking the first turn.
 */
export default function RpsPicker() {
  const phase = useGameStore(selectCurrentPhase);
  const prompt = useGameStore((s) => s.rpsPrompt);
  const hasChosen = useGameStore((s) => {
    const myId = s.myPlayerId;
    return !!s.room && !!myId && (s.room.rpsState.playedCards[myId] != null || s.room.currentPhase !== 'RPS');
  });
  const { submitChoice } = useGameActions();

  if (phase !== 'RPS') return null;

  return (
    <div className="rps-picker">
      <h3>{prompt ?? 'Choose Rock, Paper, or Scissors!'}</h3>
      <div className="rps-options">
        {CHOICES.map((c) => (
          <button
            key={c.id}
            className="rps-option"
            onClick={() => submitChoice(c.id)}
            disabled={hasChosen}
            title={`${c.label} beats ${c.beats}`}
          >
            <span className="rps-emoji">{c.emoji}</span>
            <span className="rps-label">{c.label}</span>
          </button>
        ))}
      </div>
      {hasChosen && <p className="rps-waiting">Waiting for your opponent…</p>}
    </div>
  );
}