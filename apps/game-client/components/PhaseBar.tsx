import { useGameStore, selectCurrentPhase, selectIsMyTurn, selectHasPriority } from '../store/gameStore';
import { useGameActions } from '../hooks/useGameActions';
import { ACTION_IDS } from '@card-game/protocol';
import { declarationPlayer, PHASE_LABELS } from '@card-game/protocol';
import DebugControls from './DebugControls';
import AutoPassControl from './AutoPassControl';
import { useRef, useState } from 'react';
import { useMatchConnection } from '../match-connection';

export default function PhaseBar() {
  const phase = useGameStore(selectCurrentPhase);
  const isMyTurn = useGameStore(selectIsMyTurn);
  const hasPriority = useGameStore(selectHasPriority);
  const combatSelection = useGameStore((s) => s.combatSelection);
  const clearCombatSelection = useGameStore((s) => s.clearCombatSelection);
  const { playerAction } = useGameActions();
  const { recover } = useMatchConnection();
  const submission = useRef<string | null>(null);
  const [feedback, setFeedback] = useState<{ window: string; pending: boolean; message?: string }>();

  // Read status and stack from the room for UI gating (Stack is a zone, not a phase)
  const status = useGameStore((s) => s.room?.status ?? null);
  const engineState = useGameStore((s) => s.room?.engineState ?? null);
  const stackLength = useGameStore((s) => s.room?.stack.length ?? 0);
  const debugMode = useGameStore((s) => s.room?.debugMode ?? 'off');
  const room = useGameStore((s) => s.room);
  const passUntilTurn = useGameStore((s) => s.autoPass.untilTurn);
  const targeting = useGameStore((s) => s.targeting);
  const declarationOwner = room ? declarationPlayer(room) : null;
  const myPlayerId = useGameStore((s) => s.myPlayerId);
  const outcome = useGameStore((s) => s.room?.outcome);
  const ready = status === 'playing' && engineState === 'waiting_for_player' && !outcome && !room?.pendingChoice && !targeting;
  const isStackOpen = stackLength > 0;
  const commandWindow = room?.legalActions;
  const mayDeclare = ready && (commandWindow ? !!commandWindow.combat : !isStackOpen && myPlayerId !== null && declarationOwner === myPlayerId);
  const passingForTurn = passUntilTurn !== undefined && passUntilTurn === room?.turnNumber;
  const mayPass = ready && !passingForTurn && (commandWindow ? commandWindow.actions.includes(ACTION_IDS.passPriority) : hasPriority && !declarationOwner);
  const combat = commandWindow?.combat;
  const hasCandidates = !combat || (combat.actionId === ACTION_IDS.declareAttackers
    ? combat.attackerUuids.length > 0 : combat.blockerUuids.length > 0);

  const phaseLabel = phase ? PHASE_LABELS[phase] ?? phase : '—';
  const towardCombat = commandWindow ? commandWindow.actions.includes(ACTION_IDS.enterBattle) : isMyTurn && !isStackOpen && phase === 'stateMainPhase';
  const combatWindow = `${room?.roomId}:${room?.turnNumber}:${phase}`;
  const currentFeedback = feedback?.window === combatWindow ? feedback : undefined;
  const submitDeclaration = (action: typeof ACTION_IDS.declareAttackers | typeof ACTION_IDS.declareBlockers, data: Record<string, unknown>) => {
    if (!room || submission.current === combatWindow) return;
    submission.current = combatWindow;
    setFeedback({ window: combatWindow, pending: true });
    const commandId = playerAction(action, undefined, undefined, data, receipt => {
      if (submission.current !== combatWindow) return;
      submission.current = null;
      const current = useGameStore.getState();
      if (current.roomId !== room.roomId || current.room?.viewerId !== room.viewerId || current.room.turnNumber !== room.turnNumber || current.room.phase !== phase) return;
      if (receipt?.accepted === false) {
        setFeedback({ window: combatWindow, pending: false, message: receipt.message });
        return;
      }
      const completed = action === ACTION_IDS.declareAttackers ? current.room.combatDeclarations?.attackers : current.room.combatDeclarations?.blockers;
      if (!completed && !current.room.pendingChoice) recover();
      setFeedback({ window: combatWindow, pending: false,
        message: !receipt && !completed ? 'Checking the board. If the declaration is still open, submit it again.' : undefined });
    });
    if (!commandId) { submission.current = null; setFeedback(undefined); }
  };
  const prompt = room?.pendingChoice ? room.pendingChoice.playerId === myPlayerId ? 'Choose below to continue.' : 'Waiting for opponent’s choice.'
    : targeting ? 'Choose targets on the board.'
    : engineState === 'resolving_stack' ? 'Resolving effects…'
    : engineState === 'state_based_actions' ? 'Updating the board…'
    : declarationOwner ? declarationOwner !== myPlayerId ? 'Waiting for opponent’s combat declaration.'
      : phase === 'declareAttackersStep'
        ? hasCandidates ? 'Choose your attackers, or choose No attacks.' : 'You have no eligible attackers.'
        : hasCandidates ? 'Pair your blockers, or choose No blocks.' : 'You have no eligible blockers.'
    : phase === 'declareAttackersStep' && room?.combatDeclarations?.attackers && !room.combat.length ? 'No attackers declared.'
    : passingForTurn ? 'Passing optional plays for this turn.'
    : !hasPriority ? 'Waiting for opponent to act.'
    : isStackOpen ? 'You can respond to these effects, or pass.'
    : towardCombat ? 'Play cards or continue toward combat.' : 'Take an action, or continue.';

  return (
    <div className="phase-bar">
      <p>Phase: <strong>{phaseLabel}</strong></p>
      {status === 'playing' && !outcome && <p className="action-owner" role="status">{prompt}</p>}
      {mayDeclare && currentFeedback?.message && <p className="combat-instructions" role="alert">{currentFeedback.message}</p>}
      {status === 'playing' && (
        <div className="phase-actions">
          {/* Declare Attackers: active player decision, before the response window.
              Click creatures on the battlefield to toggle selection. */}
          {mayDeclare && phase === 'declareAttackersStep' && (
            <button
              className="primary-action"
              disabled={currentFeedback?.pending}
              onClick={() => submitDeclaration(ACTION_IDS.declareAttackers, { attackers: combatSelection.attackers.map(cardUuid => ({ cardUuid })) })}
            >
              {currentFeedback?.pending ? 'Submitting…' : combatSelection.attackers.length ? `Confirm Attackers (${combatSelection.attackers.length})` : 'No attacks'}
            </button>
          )}
          {/* Declare Blockers: defender decision, independent of priority.
              Click your creatures to select a blocker, then click an attacker to pair. */}
          {mayDeclare && phase === 'declareBlockersStep' && (
            <>
              <button
                className="primary-action"
                disabled={currentFeedback?.pending}
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
                  submitDeclaration(ACTION_IDS.declareBlockers, { assignments });
                }}
              >
                {currentFeedback?.pending ? 'Submitting…' : combatSelection.blockerPairs.length ? `Confirm Blockers (${combatSelection.blockerPairs.length})` : 'No blocks'}
              </button>
            </>
          )}
          {mayDeclare && (combatSelection.attackers.length > 0 || combatSelection.blockerPairs.length > 0 || combatSelection.pendingBlocker) && (
            <button className="secondary-action" onClick={clearCombatSelection}>Clear Selection</button>
          )}
          {/* Pass Priority: whoever has priority can pass (MTG 116.3d) */}
          {mayPass && (
            <button className="primary-action" onClick={() => playerAction(towardCombat ? ACTION_IDS.enterBattle : ACTION_IDS.passPriority)}>
              {towardCombat ? 'Go to combat' : 'Pass priority'}
            </button>
          )}
          {mayPass && <p className="pass-hint">{isStackOpen
            ? 'Effects resolve after both players pass.' : 'The next step starts after both players pass. Your opponent can respond.'}</p>}
        </div>
      )}
      {mayDeclare && hasCandidates && <p className="combat-instructions">{phase === 'declareAttackersStep'
        ? 'Click your creatures to select or remove attackers, then confirm. Confirmation checks whether they can attack.'
        : 'Select your blocker, then the attacking card on the battlefield. Select the same pair again to remove it.'}</p>}
      {status === 'playing' && !outcome && <AutoPassControl />}
      <DebugControls mode={debugMode} stackLength={stackLength} ready={ready} actions={commandWindow?.actions} onAction={playerAction} />
    </div>
  );
}
