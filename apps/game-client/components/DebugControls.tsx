import { ACTION_IDS, type ActionIdOrAbility } from '../../types/action.ids';
import type { DebugMode } from '../../types/debug-mode.types';

interface DebugControlsProps {
  mode: DebugMode;
  stackLength: number;
  ready: boolean;
  onAction: (actionId: ActionIdOrAbility) => void;
}

export default function DebugControls({ mode, stackLength, ready, onAction }: DebugControlsProps) {
  if (!ready || mode === 'off') return null;
  const canResolve = stackLength > 0;
  const canEndTurn = mode === 'flow' && stackLength === 0;
  if (!canResolve && !canEndTurn) return null;

  return (
    <details className="debug-controls" aria-label="Debug actions">
      <summary>Debug actions</summary>
      {canResolve && <button onClick={() => onAction(ACTION_IDS.resolveStack)}>Resolve Stack</button>}
      {canEndTurn && <button onClick={() => onAction(ACTION_IDS.endTurn)}>End Turn</button>}
    </details>
  );
}
