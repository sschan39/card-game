import { useShallow } from 'zustand/react/shallow';
import { useGameStore, selectCurrentPhase, selectIsMyTurn, selectHasPriority, selectRpsWaitingForOpponent, selectMyBattlefield } from '../store/gameStore';
import { useGameActions } from '../hooks/useGameActions';
import { ACTION_IDS } from '../../types/action.ids';
import type { Phase } from '../../types/game.state.types';

const PHASE_LABELS: Record<Phase, string> = {
  stateTurnStart: 'Untap Step',
  stateDrawPhase: 'Draw Step',
  stateMainPhase: 'Main Phase',
  beginCombatStep: 'Beginning of Combat',
  declareAttackersStep: 'Declare Attackers',
  declareBlockersStep: 'Declare Blockers',
  combatDamageStep: 'Combat Damage',
  endCombatStep: 'End of Combat',
  stateEndPhase: 'End Step',
  cleanupStep: 'Cleanup Step',
};

export default function PhaseBar() {
  const phase = useGameStore(selectCurrentPhase);
  const isMyTurn = useGameStore(selectIsMyTurn);
  const hasPriority = useGameStore(selectHasPriority);
  const waitingForOpponent = useGameStore(selectRpsWaitingForOpponent);
  const myBattlefield = useGameStore(useShallow(selectMyBattlefield));
  const { playerAction } = useGameActions();

  // Read status and stack from the room for UI gating (Stack is a zone, not a phase)
  const status = useGameStore((s) => s.room?.status ?? null);
  const engineState = useGameStore((s) => s.room?.engineState ?? null);
  const stackLength = useGameStore((s) => s.room?.stack.length ?? 0);
  const isStackOpen = stackLength > 0;

  const phaseLabel = phase ? PHASE_LABELS[phase] ?? phase : '—';

  // Build the list of available attackers (untapped, non-sick creatures)
  const availableAttackers = myBattlefield.filter(
    (c) =>
      c.blueprint.cardTypes.includes('Creature') &&
      !c.state.isTapped &&
      !c.state.summoningSickness &&
      !c.state.attackedThisTurn,
  );

  return (
    <div className="phase-bar">
      <p>Phase: <strong>{phaseLabel}</strong></p>
      {engineState === 'resolving_stack' && <p className="engine-state">Resolving stack…</p>}
      {engineState === 'state_based_actions' && <p className="engine-state">Resolving state-based actions…</p>}
      {waitingForOpponent && <p className="rps-waiting">Waiting for opponent…</p>}
      {status !== 'RPS' && (
        <div className="phase-actions">
          {/* Enter Battle: from Main Phase, advances into the Battle Phase and
              stops at declareAttackersStep. Only the turn player can do this. */}
          {isMyTurn && !isStackOpen && phase === 'stateMainPhase' && (
            <button onClick={() => playerAction(ACTION_IDS.enterBattle)}>
              Enter Battle
            </button>
          )}
          {/* End Turn: skips straight to the end phase and completes the turn.
              Hidden while the stack is open — the turn cannot end during the
              stack (MTG 116). */}
          {isMyTurn && !isStackOpen && (
            <button onClick={() => playerAction(ACTION_IDS.endTurn)}>
              End Turn
            </button>
          )}
          {/* Declare Attackers: active player in declareAttackersStep.
              Sends all available attackers. A proper selection UI is deferred. */}
          {isMyTurn && hasPriority && phase === 'declareAttackersStep' && (
            <button
              onClick={() =>
                playerAction(
                  ACTION_IDS.declareAttackers,
                  undefined,
                  undefined,
                  { attackers: availableAttackers.map((c) => ({ cardUuid: c.uuid })) },
                )
              }
            >
              Declare Attackers ({availableAttackers.length})
            </button>
          )}
          {/* Declare Blockers: defending player in declareBlockersStep.
              Sends empty assignments (no blockers). A proper selection UI is deferred. */}
          {!isMyTurn && hasPriority && phase === 'declareBlockersStep' && (
            <button
              onClick={() =>
                playerAction(
                  ACTION_IDS.declareBlockers,
                  undefined,
                  undefined,
                  { assignments: [] },
                )
              }
            >
              Declare Blockers (0)
            </button>
          )}
          {/* Pass Priority: whoever has priority can pass (MTG 116.3d) */}
          {hasPriority && (
            <button onClick={() => playerAction(ACTION_IDS.passPriority)}>Pass Priority</button>
          )}
          {/* Resolve Stack: whoever has priority can resolve (MTG 116.4) */}
          {hasPriority && isStackOpen && (
            <button onClick={() => playerAction(ACTION_IDS.resolveStack)}>Resolve Stack</button>
          )}
        </div>
      )}
    </div>
  );
}