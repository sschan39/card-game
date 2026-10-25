import { CardCharacteristicService } from '@engine/card-characteristic-service';
import { create } from 'zustand';
import type { GameRoom, PlayerId } from '@shared/game.room.types';
import type { CardInstance } from '@shared/card.types';
import type { Phase } from '@shared/game.state.types';
import type { StateDelta } from '@shared/delta.types';
import type { ActionOption } from '@engine/option-service';
import type { TargetPointer, TargetingDefinition, TargetGroupDefinition } from '@shared/effect.types';
import type { ActionIdOrAbility } from '@shared/action.ids';
import { targetKey } from '@rules/target-legality';
import { applyDeltaChanges } from './deltaReducer';
import { getOrCreatePlayerId, setStoredRoomId, clearStoredRoomId } from '../session';
import { type CombatSelection, EMPTY_COMBAT_SELECTION, reconcileCombatSelection } from './combatSelection';
import { clientLogger } from '@rules/game-logger';
import { gameConfig } from '@config';
import { declarationPlayer, PHASE_LABELS } from '@rules/turn-utils';
import { battlefieldCardLabel } from '../card-label';
import { describeStackObject } from '../stack-description';

export interface ContextMenuState {
  choosePayment?: boolean;
  x: number;
  y: number;
  cardUuid: string;
  zone: 'hand' | 'battlefield';
  options: ActionOption[];
}

export interface TargetingState {
  groups?: TargetGroupDefinition[];
  groupIndex?: number;
  completedGroups?: { id: string; targets: TargetPointer[] }[];
  data?: Record<string, unknown>;
  cardUuid: string;
  zone: 'hand' | 'battlefield';
  actionId: ActionIdOrAbility;
  targeting: TargetingDefinition;
  collected: TargetPointer[];
}

interface GameStore {
  // Server-authoritative state
  room: GameRoom | null;
  roomId: string | null;
  myPlayerId: string | null;

  // UI state (client-only)
  contextMenu: ContextMenuState | null;
  targeting: TargetingState | null;
  pendingCard: { cardUuid: string; zone: 'hand' | 'battlefield'; position?: { x: number; y: number } } | null;
  error: string | null;
  log: { seq: number; action?: string; playerId?: string; commandId?: string; summary?: string; changes: number }[];
  combatSelection: CombatSelection;
  combatNotification: string | null;

  // Actions
  applyDelta: (delta: StateDelta) => void;
  setRoom: (room: GameRoom) => void;
  setRoomId: (id: string) => void;
  setMyPlayerId: (id: string) => void;
  clearSession: () => void;
  requestOptions: (cardUuid: string, zone: 'hand' | 'battlefield', position?: { x: number; y: number }) => void;
  showContextMenu: (options: ActionOption[]) => void;
  hideContextMenu: () => void;
  beginTargeting: (state: TargetingState) => void;
  addTarget: (pointer: TargetPointer) => void;
  removeTarget: (pointer: TargetPointer) => void;
  toggleTarget: (pointer: TargetPointer) => void;
  cancelTargeting: () => void;
  confirmTargeting: () => void;
  setError: (message: string | null) => void;
  toggleAttacker: (uuid: string) => void;
  selectBlocker: (uuid: string) => void;
  assignBlocker: (attackerUuid: string) => void;
  clearCombatSelection: () => void;
}

export const useGameStore = create<GameStore>((set, get) => ({
  room: null,
  roomId: null,
  myPlayerId: null,
  contextMenu: null,
  targeting: null,
  pendingCard: null,
  error: null,
  log: [],
  combatSelection: EMPTY_COMBAT_SELECTION,
  combatNotification: null,

  applyDelta: (delta) => {
    const current = get().room;
    if (!current) return;

    const nextRoom = applyDeltaChanges(current, delta.changes);
    const summaries: string[] = delta.notifications?.map(notification => notification.summary) ?? [];
    if (nextRoom.pendingChoice && nextRoom.pendingChoice.id !== current.pendingChoice?.id) summaries.push('Choice: ' + nextRoom.pendingChoice.prompt);
    if (current.pendingChoice && !nextRoom.pendingChoice) summaries.push('Choice closed');
    const added = nextRoom.stack.filter(object => !current.stack.some(previous => previous.uuid === object.uuid));
    if (added.length) summaries.push('On stack: ' + added.map(object => describeStackObject(nextRoom, object, get().myPlayerId)).join('; '));
    const removed = current.stack.filter(object => !nextRoom.stack.some(after => after.uuid === object.uuid));
    if (removed.length) summaries.push('Left stack: ' + removed.map(object => describeStackObject(current, object, get().myPlayerId)).join('; '));
    if (nextRoom.stack.length < current.stack.length) summaries.push('Stack: ' + nextRoom.stack.length + ' remaining');
    if (nextRoom.phase !== current.phase) summaries.push('Phase: ' + PHASE_LABELS[nextRoom.phase]);
    if (nextRoom.activeTurnPlayerId !== current.activeTurnPlayerId) summaries.push('Turn: ' + (nextRoom.activeTurnPlayerId === get().myPlayerId ? 'you' : 'opponent'));
    if (nextRoom.priorityPlayerId !== current.priorityPlayerId) summaries.push('Priority: ' + (nextRoom.priorityPlayerId === get().myPlayerId ? 'you' : nextRoom.priorityPlayerId ? 'opponent' : 'waiting'));
    const entered = nextRoom.battlefield.filter(card => !current.battlefield.some(before => before.uuid === card.uuid && before.state.zoneRevision === card.state.zoneRevision));
    if (entered.length) summaries.push('Entered: ' + entered.map(card => card.blueprint.name).join(', '));
    if (nextRoom.combatDeclarations?.attackers && !current.combatDeclarations?.attackers) summaries.push(nextRoom.combat.length
      ? 'Attackers: ' + nextRoom.combat.map(decl => battlefieldCardLabel(nextRoom, decl.attacker)).join(', ') : 'No attackers');
    if (nextRoom.combatDeclarations?.blockers && !current.combatDeclarations?.blockers) {
      const blocks = nextRoom.combat.filter(decl => decl.blockers.length).map(decl => battlefieldCardLabel(nextRoom, decl.attacker) + ' blocked by ' + decl.blockers.map(card => battlefieldCardLabel(nextRoom, card)).join(', '));
      summaries.push(blocks.length ? 'Blocks: ' + blocks.join('; ') : 'No blocks');
    }
    if (nextRoom.combatDamage?.completed && !current.combatDamage?.completed) summaries.push('Combat damage resolved');
    const departed = current.battlefield.filter(card => !nextRoom.battlefield.some(after => after.uuid === card.uuid && after.state.zoneRevision === card.state.zoneRevision));
    if (departed.length) summaries.push('Left battlefield: ' + departed.map(card => battlefieldCardLabel(current, card)).join(', '));
    for (const [id, player] of Object.entries(nextRoom.players)) {
      const owner = id === get().myPlayerId ? 'Your' : 'Opponent';
      if (player.life !== current.players[id]?.life) summaries.push(owner + ' life: ' + player.life);
      if (JSON.stringify(player.mana) !== JSON.stringify(current.players[id]?.mana)) summaries.push(owner + ' mana: ' + (Object.entries(player.mana).filter(([, value]) => value > 0).map(([color, value]) => `${color}:${value}`).join(' ') || 'none'));
    }
    const summary = summaries.join(' · ') || 'State updated';
    if (gameConfig.logging.actions) clientLogger.info('delta:applied', summary, {
      roomId: delta.roomId, commandId: delta.commandId, action: delta.action, seq: delta.seq,
      phase: nextRoom.phase, priorityPlayerId: nextRoom.priorityPlayerId, stack: nextRoom.stack.length,
      declarationPlayerId: declarationPlayer(nextRoom),
      triggerStack: nextRoom.stack.filter(object => object.type === 'triggered').map(object => ({
        stackUuid: object.uuid, abilityId: object.ability?.id ?? 'legacy', eventUuid: object.triggeringEvent?.eventUuid,
      })),
      choiceId: nextRoom.pendingChoice?.id, kind: nextRoom.pendingChoice?.kind,
      ...(nextRoom.pendingChoice ? nextRoom.pendingChoice.kind === 'number' ? { range: nextRoom.pendingChoice.range } : { total: nextRoom.pendingChoice.total } : {}),
    });

    const { selection: reconciled, changed } = reconcileCombatSelection(get().combatSelection, nextRoom);
    const declarationOpen = nextRoom.phase === 'declareAttackersStep' ? !nextRoom.combatDeclarations?.attackers
      : nextRoom.phase === 'declareBlockersStep' ? !nextRoom.combatDeclarations?.blockers : false;
    if (changed && nextRoom.status === 'playing' && nextRoom.phase === current.phase && declarationOpen) {
      // The player's combat selection was silently adjusted because a creature
      // left the battlefield or became ineligible. Notify briefly.
      set({ combatNotification: 'Selection updated due to board change' });
      setTimeout(() => set({ combatNotification: null }), 2000);
    }

    set((state) => ({
      room: nextRoom,
      combatSelection: reconciled,
      log: [
        ...state.log,
        {
          seq: delta.seq,
          action: delta.action,
          playerId: delta.playerId,
          commandId: delta.commandId,
          summary,
          changes: delta.changes.length,
        },
      ].slice(-100), // keep last 100 entries
    }));
  },

  setRoom: (room) => {
    if (gameConfig.logging.actions) clientLogger.info('snapshot:applied', 'Room restored', { roomId: room.roomId, phase: room.phase, stack: room.stack.length, choiceId: room.pendingChoice?.id });
    // Full restoration owns the board; an unsent local declaration is not part
    // of the snapshot. Committed combat remains on room.combat.
    set({ room, combatSelection: EMPTY_COMBAT_SELECTION, combatNotification: null });
  },

  setRoomId: (id) => {
    setStoredRoomId(id);
    set({ roomId: id });
  },
  setMyPlayerId: (id) => set({ myPlayerId: id }),

  clearSession: () => {
    clearStoredRoomId();
    set({
      room: null,
      roomId: null,
      myPlayerId: null,
      contextMenu: null,
      targeting: null,
      pendingCard: null,
      error: null,
      log: [],
    });
  },

  requestOptions: (cardUuid, zone, position) => set({ pendingCard: { cardUuid, zone, ...(position ? { position } : {}) } }),

  showContextMenu: (options) => {
    const { pendingCard } = get();
    if (!pendingCard) return;
    set({
      contextMenu: { x: pendingCard.position?.x ?? 0, y: pendingCard.position?.y ?? 0, cardUuid: pendingCard.cardUuid, zone: pendingCard.zone, options },
      pendingCard: null,
    });
  },

  hideContextMenu: () => set({ contextMenu: null }),

  beginTargeting: (state) => {
    if (gameConfig.logging.actions) clientLogger.info('targeting:started', 'Choose targets before sending action', { roomId: get().roomId, action: state.actionId, cardUuid: state.cardUuid });
    set({ targeting: state, contextMenu: null });
  },

  addTarget: (pointer) => {
    const { targeting } = get();
    if (!targeting) return;
    const max = targeting.targeting.maxTargets;
    if (max !== undefined && targeting.collected.length >= max) return;
    set({ targeting: { ...targeting, collected: [...targeting.collected, pointer] } });
  },

  removeTarget: (pointer) => {
    const { targeting } = get();
    if (!targeting) return;
    set({
      targeting: {
        ...targeting,
        collected: targeting.collected.filter(
          t => targetKey(t) !== targetKey(pointer)
        ),
      },
    });
  },

  toggleTarget: (pointer) => {
    const { targeting } = get();
    if (!targeting) return;
    const alreadyCollected = targeting.collected.some(
      t => targetKey(t) === targetKey(pointer)
    );
    if (alreadyCollected) {
      set({
        targeting: {
          ...targeting,
          collected: targeting.collected.filter(
            t => targetKey(t) !== targetKey(pointer)
          ),
        },
      });
    } else {
      const max = targeting.targeting.maxTargets;
      if (max !== undefined && targeting.collected.length >= max) return;
      set({ targeting: { ...targeting, collected: [...targeting.collected, pointer] } });
    }
  },

  cancelTargeting: () => {
    const target = get().targeting;
    if (target && gameConfig.logging.actions) clientLogger.info('targeting:cancelled', 'Unsent targeting cancelled', { roomId: get().roomId, action: target.actionId, cardUuid: target.cardUuid });
    set({ targeting: null });
  },

  confirmTargeting: () => {
    // The caller (TargetSelector) reads `targeting` and dispatches the action.
    // We keep the state here so the component can read `collected` before clearing.
    set({ targeting: null });
  },

  setError: (message) => set({ error: message }),

  toggleAttacker: (uuid) => {
    const { combatSelection, room, myPlayerId } = get();
    const idx = combatSelection.attackers.indexOf(uuid);
    if (idx >= 0) {
      set({ combatSelection: { ...combatSelection, attackers: combatSelection.attackers.filter(a => a !== uuid) } });
    } else {
      const card = room?.battlefield.find(c => c.uuid === uuid);
      if (!room || !card || CardCharacteristicService.resolveController(room, card) !== myPlayerId) return;
      set({ combatSelection: { ...combatSelection, attackers: [...combatSelection.attackers, uuid] } });
    }
  },

  selectBlocker: (uuid) => {
    const { combatSelection, room, myPlayerId } = get();
    // Toggle: if already pending, deselect; otherwise set as pending
    if (combatSelection.pendingBlocker === uuid) {
      set({ combatSelection: { ...combatSelection, pendingBlocker: null } });
    } else {
      const card = room?.battlefield.find(c => c.uuid === uuid);
      if (!room || !card || CardCharacteristicService.resolveController(room, card) !== myPlayerId) return;
      set({ combatSelection: { ...combatSelection, pendingBlocker: uuid } });
    }
  },

  assignBlocker: (attackerUuid) => {
    const { combatSelection } = get();
    if (!combatSelection.pendingBlocker) return;
    // The same pairing controls also remove a pair after a rejected draft.
    const alreadyPaired = combatSelection.blockerPairs.some(
      p => p.attackerUuid === attackerUuid && p.blockerUuid === combatSelection.pendingBlocker
    );
    if (alreadyPaired) {
      set({ combatSelection: { ...combatSelection, blockerPairs: combatSelection.blockerPairs.filter(
        pair => pair.attackerUuid !== attackerUuid || pair.blockerUuid !== combatSelection.pendingBlocker), pendingBlocker: null } });
      return;
    }
    set({
      combatSelection: {
        ...combatSelection,
        blockerPairs: [
          ...combatSelection.blockerPairs,
          { attackerUuid, blockerUuid: combatSelection.pendingBlocker! },
        ],
        pendingBlocker: null,
      },
    });
  },

  clearCombatSelection: () => set({ combatSelection: EMPTY_COMBAT_SELECTION }),
}));

// ---------------------------------------------------------------------------
// Derived selectors (computed from room + myPlayerId)
// ---------------------------------------------------------------------------

export function selectMyPlayerId(state: GameStore): PlayerId | null {
  return state.myPlayerId;
}

export function selectMyHand(state: GameStore): CardInstance[] {
  const { room, myPlayerId } = state;
  if (!room || !myPlayerId) return [];
  return room.players[myPlayerId]?.hand ?? [];
}

export function selectMyBattlefield(state: GameStore): CardInstance[] {
  const { room, myPlayerId } = state;
  if (!room || !myPlayerId) return [];
  return room.battlefield.filter((c) => CardCharacteristicService.resolveController(room, c) === myPlayerId);
}

export function selectOpponentBattlefield(state: GameStore): CardInstance[] {
  const { room, myPlayerId } = state;
  if (!room || !myPlayerId) return [];
  return room.battlefield.filter((c) => CardCharacteristicService.resolveController(room, c) !== myPlayerId);
}

export function selectOpponentId(state: GameStore): PlayerId | null {
  const { room, myPlayerId } = state;
  if (!room || !myPlayerId) return null;
  return room.player1Id === myPlayerId ? room.player2Id : room.player1Id;
}

export function selectOpponentHandCount(state: GameStore): number {
  const { room } = state;
  const opponentId = selectOpponentId(state);
  if (!room || !opponentId) return 0;
  return room.players[opponentId]?.hand.length ?? 0;
}

export function selectIsMyTurn(state: GameStore): boolean {
  const { room, myPlayerId } = state;
  if (!room || !myPlayerId) return false;
  return room.activeTurnPlayerId === myPlayerId;
}

export function selectCurrentPhase(state: GameStore): Phase | null {
  return state.room?.phase ?? null;
}

export function selectRpsWaitingForOpponent(state: GameStore): boolean {
  const { room, myPlayerId } = state;
  if (!room || !myPlayerId) return false;
  if (room.status !== 'RPS') return false;
  const opponentId = selectOpponentId(state);
  if (!opponentId) return false;
  const myChoice = room.rpsState.playedCards[myPlayerId];
  const oppChoice = room.rpsState.playedCards[opponentId];
  return Boolean(myChoice) && !oppChoice;
}

/**
 * Does the current player have priority? (MTG 116)
 * Priority determines who can cast spells, activate abilities, or pass.
 * Only meaningful when the engine is waiting for a player to act — while the
 * stack is resolving or state-based actions run, priority is suspended.
 */
export function selectHasPriority(state: GameStore): boolean {
  const { room, myPlayerId } = state;
  if (!room || !myPlayerId) return false;
  if (room.engineState !== 'waiting_for_player' || room.pendingChoice) return false;
  return room.priorityPlayerId === myPlayerId;
}

export function selectTargeting(state: GameStore): TargetingState | null {
  return state.targeting;
}
