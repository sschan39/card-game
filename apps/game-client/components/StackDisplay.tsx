import { useShallow } from 'zustand/react/shallow';
import { useGameStore } from '../store/gameStore';
import { isLegalTarget } from '../targeting';
import { describeStackObject } from '../stack-description';

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
            room && targeting && isLegalTarget(targeting, { targetType: targeting.targeting.type, stackUuid: so.uuid }) ? 'targetable' : '',
            targeting?.collected.some(t => t.stackUuid === so.uuid) ? 'selected' : '',
          ].join(' ')} onClick={() => {
            if (room && targeting && isLegalTarget(targeting, { targetType: targeting.targeting.type, stackUuid: so.uuid })) toggleTarget({ targetType: targeting.targeting.type, stackUuid: so.uuid });
          }}>
            {room && describeStackObject(room, so, playerId)}
            {so.countered && ' (countered)'}
            {so.fizzled && ' (fizzled — no legal targets)'}
          </li>
        ))}
      </ol>
    </div>
  );
}
