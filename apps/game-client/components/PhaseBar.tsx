import { useGameStore, selectCurrentPhase, selectIsMyTurn, selectHasPriority, selectRpsWaitingForOpponent } from '../store/gameStore';
import { useGameActions } from '../hooks/useGameActions';
import { ACTION_IDS } from '@shared/action.ids';
import { gameConfig } from '@config';
import { declarationPlayer, PHASE_LABELS } from '@rules/turn-utils';
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
  const targeting = useGameStore((s) => s.targeting);
  const declarationOwner = room ? declarationPlayer(room) : null;
  const myPlayerId = useGameStore((s) => s.myPlayerId);
  const outcome = useGameStore((s) => s.room?.outcome);
  const ready = status === 'playing' && engineState === 'waiting_for_player' && !outcome && !room?.pendingChoice && !targeting;
  const isStackOpen = stackLength > 0;
  const mayDeclare = ready && !isStackOpen && myPlayerId !== null && declarationOwner === myPlayerId;

  const phaseLabel = phase ? PHASE_LABELS[phase] ?? phase : '—';
  const towardCombat = isMyTurn && !isStackOpen && phase === 'stateMainPhase';
  const prompt = room?.pendingChoice ? room.pendingChoice.playerId === myPlayerId ? 'Choose below to continue.' : 'Waiting for opponent’s choice.'
    : targeting ? 'Choose targets on the board.'
    : engineState === 'resolving_stack' ? 'Resolving effects…'
    : engineState === 'state_based_actions' ? 'Updating the board…'
    : declarationOwner ? declarationOwner !== myPlayerId ? 'Waiting for opponent’s combat declaration.'
      : phase === 'declareAttackersStep' ? 'Choose your attackers, or choose No attacks.' : 'Pair your blockers, or choose No blocks.'
    : !hasPriority ? 'Waiting for opponent to act.'
    : isStackOpen ? 'You can respond to these effects, or pass.'
    : towardCombat ? 'Play cards or continue toward combat.' : 'Take an action, or continue.';

  return (
    <div className="phase-bar">
      <p>Phase: <strong>{phaseLabel}</strong></p>
      {status === 'playing' && !outcome && <p className="action-owner" role="status">{prompt}</p>}
      {waitingForOpponent && <p className="rps-waiting">Waiting for opponent…</p>}
      {status === 'playing' && (
        <div className="phase-actions">
          {/* Declare Attackers: active player decision, before the response window.
              Click creatures on the battlefield to toggle selection. */}
          {mayDeclare && phase === 'declareAttackersStep' && (
            <button
              className="primary-action"
              onClick={() => {
                playerAction(
                  ACTION_IDS.declareAttackers,
                  undefined,
                  undefined,
                  { attackers: combatSelection.attackers.map((uuid) => ({ cardUuid: uuid })) },
                );
              }}
            >
              {combatSelection.attackers.length ? `Confirm Attackers (${combatSelection.attackers.length})` : 'No attacks'}
            </button>
          )}
          {/* Declare Blockers: defender decision, independent of priority.
              Click your creatures to select a blocker, then click an attacker to pair. */}
          {mayDeclare && phase === 'declareBlockersStep' && (
            <>
              <button
                className="primary-action"
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
                }}
              >
                {combatSelection.blockerPairs.length ? `Confirm Blockers (${combatSelection.blockerPairs.length})` : 'No blocks'}
              </button>
            </>
          )}
          {mayDeclare && (combatSelection.attackers.length > 0 || combatSelection.blockerPairs.length > 0 || combatSelection.pendingBlocker) && (
            <button className="secondary-action" onClick={clearCombatSelection}>Clear Selection</button>
          )}
          {/* Pass Priority: whoever has priority can pass (MTG 116.3d) */}
          {ready && hasPriority && !declarationOwner && (
            <button className="primary-action" onClick={() => playerAction(towardCombat ? ACTION_IDS.enterBattle : ACTION_IDS.passPriority)}>
              {towardCombat ? 'Go to combat' : isStackOpen ? 'Pass' : 'Continue'}
            </button>
          )}
          {ready && hasPriority && !declarationOwner && <p className="pass-hint">{isStackOpen
            ? 'Effects resolve after both players pass.' : 'The next step starts after both players pass. Your opponent can respond.'}</p>}
        </div>
      )}
      {mayDeclare && <p className="combat-instructions">{phase === 'declareAttackersStep'
        ? 'Click your creatures to select or remove attackers, then confirm. Confirmation checks whether they can attack.'
        : 'Click your blocker, then an attacker in Combat to pair them. Repeat the same pair to remove it, or clear your selection.'}</p>}
      <DebugControls mode={debugMode} stackLength={stackLength} ready={ready} onAction={playerAction} />
    </div>
  );
}
