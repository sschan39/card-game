import { useGameStore, selectCurrentPhase, selectIsMyTurn, selectHasPriority, selectRpsWaitingForOpponent } from '../store/gameStore';
import { useGameActions } from '../hooks/useGameActions';
import { ACTION_IDS } from '../../types/action.ids';
import { gameConfig } from '../../config';
import { declarationPlayer, PHASE_LABELS } from '../../shared/turn-utils';
import DebugControls from './DebugControls';

export default function PhaseBar() {
  const phase = useGameStore(selectCurrentPhase);
  const isMyTurn = useGameStore(selectIsMyTurn);
  const hasPriority = useGameStore(selectHasPriority);
  const waitingForOpponent = useGameStore(selectRpsWaitingForOpponent);
  const combatSelection = useGameStore((s) => s.combatSelection);
  const clearCombatSelection = useGameStore((s) => s.clearCombatSelection);
  const { playerAction } = useGameActions();

  // Read status and stack from the room for UI gating (Stack is a zone, not a phase)
  const status = useGameStore((s) => s.room?.status ?? null);
  const engineState = useGameStore((s) => s.room?.engineState ?? null);
  const stackLength = useGameStore((s) => s.room?.stack.length ?? 0);
  const debugMode = useGameStore((s) => s.room?.debugMode ?? gameConfig.debugMode);
  const room = useGameStore((s) => s.room);
  const declarationOwner = room ? declarationPlayer(room) : null;
  const myPlayerId = useGameStore((s) => s.myPlayerId);
  const outcome = useGameStore((s) => s.room?.outcome);
  const ready = status === 'playing' && engineState === 'waiting_for_player' && !outcome && !room?.pendingChoice;
  const isStackOpen = stackLength > 0;
  const mayDeclare = ready && !isStackOpen && myPlayerId !== null && declarationOwner === myPlayerId;

  const phaseLabel = phase ? PHASE_LABELS[phase] ?? phase : '—';

  return (
    <div className="phase-bar">
      <p>Phase: <strong>{phaseLabel}</strong></p>
      {engineState === 'resolving_stack' && <p className="engine-state">Resolving stack…</p>}
      {engineState === 'state_based_actions' && <p className="engine-state">Resolving state-based actions…</p>}
      {waitingForOpponent && <p className="rps-waiting">Waiting for opponent…</p>}
      {status === 'playing' && (
        <div className="phase-actions">
          {/* Passing toward combat preserves the opponent's main-phase response. */}
          {isMyTurn && hasPriority && !isStackOpen && phase === 'stateMainPhase' && (
            <button onClick={() => playerAction(ACTION_IDS.enterBattle)}>
              Pass to Combat
            </button>
          )}
          {/* Declare Attackers: active player decision, before the response window.
              Click creatures on the battlefield to toggle selection. */}
          {mayDeclare && phase === 'declareAttackersStep' && (
            <button
              onClick={() => {
                playerAction(
                  ACTION_IDS.declareAttackers,
                  undefined,
                  undefined,
                  { attackers: combatSelection.attackers.map((uuid) => ({ cardUuid: uuid })) },
                );
                clearCombatSelection();
              }}
            >
              Confirm Attackers ({combatSelection.attackers.length})
            </button>
          )}
          {/* Declare Blockers: defender decision, independent of priority.
              Click your creatures to select a blocker, then click an attacker to pair. */}
          {mayDeclare && phase === 'declareBlockersStep' && (
            <>
              <button
                onClick={() => {
                  const assignments = combatSelection.blockerPairs.reduce(
                    (acc, pair) => {
                      const existing = acc.find((a) => a.attackerUuid === pair.attackerUuid);
                      if (existing) {
                        existing.blockerUuids.push(pair.blockerUuid);
                      } else {
                        acc.push({ attackerUuid: pair.attackerUuid, blockerUuids: [pair.blockerUuid] });
                      }
                      return acc;
                    },
                    [] as { attackerUuid: string; blockerUuids: string[] }[],
                  );
                  playerAction(
                    ACTION_IDS.declareBlockers,
                    undefined,
                    undefined,
                    { assignments },
                  );
                  clearCombatSelection();
                }}
              >
                Confirm Blockers ({combatSelection.blockerPairs.length})
              </button>
              <button
                onClick={() => {
                  playerAction(
                    ACTION_IDS.declareBlockers,
                    undefined,
                    undefined,
                    { assignments: [] },
                  );
                  clearCombatSelection();
                }}
              >
                No Blocks
              </button>
            </>
          )}
          {/* Pass Priority: whoever has priority can pass (MTG 116.3d) */}
          {hasPriority && (
            <button onClick={() => playerAction(ACTION_IDS.passPriority)}>Pass Priority</button>
          )}
        </div>
      )}
      <DebugControls mode={debugMode} stackLength={stackLength} ready={ready} onAction={playerAction} />
    </div>
  );
}
