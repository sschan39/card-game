import { useShallow } from 'zustand/react/shallow';
import { useGameStore } from '../store/gameStore';

const EMPTY_STACK: never[] = [];

export default function StackDisplay() {
  const stack = useGameStore(useShallow((s) => s.room?.stack ?? EMPTY_STACK));

  if (stack.length === 0) return null;

  return (
    <div className="stack-display">
      <h3>Stack ({stack.length})</h3>
      <ol>
        {stack.map((so) => (
          <li key={so.uuid} className={so.countered || so.fizzled ? 'countered' : ''}>
            {so.type} — {so.source?.blueprint?.name ?? so.source?.uuid ?? 'unknown'}
            {so.countered && ' (countered)'}
            {so.fizzled && ' (fizzled — no legal targets)'}
          </li>
        ))}
      </ol>
    </div>
  );
}