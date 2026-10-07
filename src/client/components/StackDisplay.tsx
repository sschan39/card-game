import { useShallow } from 'zustand/react/shallow';
import { useGameStore } from '../store/gameStore';
import { structuralTargetLegal } from '../../shared/target-legality';

const EMPTY_STACK: never[] = [];

export default function StackDisplay() {
  const stack = useGameStore(useShallow((s) => s.room?.stack ?? EMPTY_STACK));
  const room = useGameStore(s => s.room);
  const targeting = useGameStore(s => s.targeting);
  const playerId = useGameStore(s => s.myPlayerId);
  const toggleTarget = useGameStore(s => s.toggleTarget);

  if (stack.length === 0) return null;

  return (
    <div className="stack-display">
      <h3>Stack ({stack.length})</h3>
      <ol>
        {stack.map((so) => (
          <li key={so.uuid} className={[
            so.countered || so.fizzled ? 'countered' : '',
            room && targeting && structuralTargetLegal(room, playerId ?? '', { targetType: targeting.targeting.type, stackUuid: so.uuid }, targeting.targeting) ? 'targetable' : '',
            targeting?.collected.some(t => t.stackUuid === so.uuid) ? 'selected' : '',
          ].join(' ')} onClick={() => {
            if (room && targeting && structuralTargetLegal(room, playerId ?? '', { targetType: targeting.targeting.type, stackUuid: so.uuid }, targeting.targeting)) toggleTarget({ targetType: targeting.targeting.type, stackUuid: so.uuid });
          }}>
            {so.type} — {so.source?.blueprint?.name ?? so.source?.uuid ?? 'unknown'}
            {so.countered && ' (countered)'}
            {so.fizzled && ' (fizzled — no legal targets)'}
          </li>
        ))}
      </ol>
    </div>
  );
}
