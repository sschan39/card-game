import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  PROTOCOL_VERSION,
  type ActionOption,
  type ChoiceView,
  type PlayerView,
  type StackView,
  type TargetPointer,
  type ViewChange,
  type ViewDelta,
} from '@card-game/protocol';
import {
  selectCurrentPhase,
  selectHasPriority,
  selectIsMyTurn,
  selectMyBattlefield,
  selectMyHand,
  selectMyPlayerId,
  selectOpponentBattlefield,
  selectOpponentHandCount,
  selectOpponentId,
  selectRpsWaitingForOpponent,
  selectTargeting,
  useGameStore,
  type TargetingState,
} from '@client/store/gameStore';
import { clientFlags as gameConfig } from '@client/config';
import { clientLogger } from '@client/logger';
import { createTestRoom, creature } from '../helpers/client-view-fixture';

function createStorage(): Storage {
  const data = new Map<string, string>();
  return {
    get length() { return data.size; },
    clear: () => data.clear(),
    getItem: (key: string) => data.get(key) ?? null,
    key: (index: number) => Array.from(data.keys())[index] ?? null,
    removeItem: (key: string) => { data.delete(key); },
    setItem: (key: string, value: string) => { data.set(key, String(value)); },
  } as Storage;
}

const freshState = () => ({
  room: null,
  roomId: null,
  lastSeq: 0,
  myPlayerId: null,
  contextMenu: null,
  targeting: null,
  pendingCard: null,
  error: null,
  log: [] as { seq: number; changes: number; summary?: string }[],
  combatSelection: { attackers: [], blockerPairs: [], pendingBlocker: null },
  combatNotification: null,
  autoPass: { enabled: false, passAt: null },
});

function seed(overrides: Partial<PlayerView> = {}, myPlayerId: string | null = 'player1') {
  const room = { ...createTestRoom(), ...overrides } as PlayerView;
  useGameStore.setState({ ...freshState(), room, roomId: room.roomId, myPlayerId });
  return room;
}

const update = (path: string, value: unknown): ViewChange => ({ path, op: 'update', value });

function apply(changes: ViewChange[], extra: Partial<ViewDelta> = {}): ViewDelta {
  const state = useGameStore.getState();
  const room = state.room!;
  const delta: ViewDelta = {
    protocolVersion: PROTOCOL_VERSION, roomId: room.roomId, viewerId: room.viewerId,
    seq: state.lastSeq + 1, timestamp: 0, changes, ...extra,
  };
  state.applyDelta(delta);
  return delta;
}

const summary = () => useGameStore.getState().log.at(-1)?.summary ?? '';

function stackObject(uuid: string, type: StackView['type'], description: string, abilityId?: string): StackView {
  return { uuid, type, controllerId: 'player1', source: null, description, ...(abilityId ? { abilityId } : {}) };
}
const triggered = (uuid: string, abilityId?: string) => stackObject(uuid, 'triggered', uuid + ' description', abilityId);
const spell = (uuid: string) => stackObject(uuid, 'spell', uuid + ' description');

const listedChoice = (id: string, prompt = 'Prompt ' + id, kind: 'targets' | 'selection' | 'modes' = 'targets'): ChoiceView =>
  ({ id, playerId: 'player1', kind, prompt, cancellable: true, options: [], min: 0, max: 1 } as ChoiceView);
const numericChoice = (id = 'n1'): ChoiceView =>
  ({ id, playerId: 'player1', kind: 'number', prompt: 'Choose a number ' + id, range: { min: 0, max: 4 }, cancellable: true });

const target = (cardUuid: string, zoneRevision = 1): TargetPointer => ({ targetType: 'permanent', cardUuid, zoneRevision });
function targetingState(overrides: Partial<TargetingState> = {}): TargetingState {
  return {
    cardUuid: 'source', zone: 'hand', actionId: 'cast_spell', groupIndex: 0,
    groups: [{ id: 'group', targeting: { type: 'permanent', required: true, maxTargets: 2 }, legalTargets: [target('a'), target('b')] }],
    targeting: { type: 'permanent', required: true, maxTargets: 2 },
    collected: [],
    ...overrides,
  };
}
const option = (actionId: string): ActionOption => ({ actionId: actionId as ActionOption['actionId'], label: actionId });

beforeEach(() => {
  vi.stubGlobal('sessionStorage', createStorage());
  useGameStore.setState(freshState());
  vi.spyOn(console, 'info').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('delta interpretation', () => {
  it('ignores updates until a room snapshot exists', () => {
    const state = useGameStore.getState();
    expect(() => state.applyDelta({ protocolVersion: PROTOCOL_VERSION, roomId: 'room', viewerId: 'player1', seq: 1, timestamp: 0, changes: [] })).not.toThrow();
    expect(useGameStore.getState().log).toEqual([]);
    expect(useGameStore.getState().lastSeq).toBe(0);
  });

  it('rejects foreign, duplicate and out-of-order updates before touching the board', () => {
    const room = seed();
    const before = useGameStore.getState().room;

    for (const patch of [{ protocolVersion: 2 }, { roomId: 'other-room' }, { viewerId: 'player2' }]) {
      useGameStore.getState().applyDelta({ protocolVersion: PROTOCOL_VERSION, roomId: room.roomId, viewerId: room.viewerId, seq: 1, timestamp: 0, changes: [], ...patch } as ViewDelta);
    }
    expect(useGameStore.getState().room).toBe(before);

    apply([update('players.player1.life', 19)]);
    expect(useGameStore.getState().lastSeq).toBe(1);
    apply([update('players.player1.life', 18)], { seq: 1 });
    expect(useGameStore.getState().lastSeq).toBe(1);
    expect(summary()).toContain('life: 19');

    expect(useGameStore.getState().applyDelta({
      protocolVersion: PROTOCOL_VERSION, roomId: room.roomId, viewerId: room.viewerId,
      seq: 5, timestamp: 0, changes: [update('players.player1.life', 17)],
    })).toBe('gap');
    expect(useGameStore.getState().lastSeq).toBe(1);
  });

  it('mentions public notifications and a newly opened choice over the previous one', () => {
    seed({ pendingChoice: listedChoice('q1') });

    apply([update('pendingChoice', listedChoice('q2', 'New prompt', 'selection'))], {
      notifications: [{ eventId: 'ACTION_RESOLVED', eventUuid: 'event-1', summary: 'Opponent drew a card.' }],
    });

    expect(summary()).toContain('Opponent drew a card.');
    expect(summary()).toContain('Choice: New prompt');
    expect(useGameStore.getState().log.at(-1)).toMatchObject({ seq: 1, changes: 1 });
  });

  it('describes numeric and waiting choices without inventing ranges', () => {
    seed();
    apply([update('pendingChoice', numericChoice())]);
    expect(summary()).toContain('Choose a number n1');

    seed();
    apply([update('pendingChoice', { kind: 'waiting', playerId: 'player1' })]);
    expect(summary()).toBe('State updated');
    expect(useGameStore.getState().room?.pendingChoice).toEqual({ kind: 'waiting', playerId: 'player1' });
  });

  it('closes a choice the server withdrew', () => {
    seed({ pendingChoice: listedChoice('q1') });
    apply([update('pendingChoice', null)]);
    expect(summary()).toContain('Choice closed');
  });

  it('narrates stack arrivals, departures and the remaining count', () => {
    seed({ stack: [triggered('triggered-one'), spell('spell-two')] });

    apply([update('stack', [triggered('triggered-one'), triggered('triggered-four', 'ability-1')])]);
    expect(summary()).toContain('On stack: triggered-four description');
    expect(summary()).toContain('Left stack: spell-two description');

    apply([update('stack', [])]);
    expect(summary()).toContain('Left stack: triggered-one description; triggered-four description');
    expect(summary()).toContain('Stack: 0 remaining');
  });

  it('narrates phase, turn and priority transitions for either seat', () => {
    seed();

    apply([update('phase', 'stateDrawPhase')]);
    expect(summary()).toContain('Phase: Draw Step');

    apply([update('activeTurnPlayerId', 'player2')]);
    expect(summary()).toContain('Turn: opponent');
    apply([update('activeTurnPlayerId', 'player1')]);
    expect(summary()).toContain('Turn: you');

    apply([update('priorityPlayerId', 'player2')]);
    expect(summary()).toContain('Priority: opponent');
    apply([update('priorityPlayerId', null)]);
    expect(summary()).toContain('Priority: waiting');
    apply([update('priorityPlayerId', 'player1')]);
    expect(summary()).toContain('Priority: you');
  });

  it('narrates permanents entering and leaving plus life and mana changes', () => {
    const card = creature('bear', 'player1');
    seed();
    apply([update('battlefield', [card])]);
    expect(summary()).toContain('Entered: bear');

    apply([update('battlefield', [])]);
    expect(summary()).toContain('Left battlefield: bear');

    const life = structuredClone(useGameStore.getState().room!.players);
    life.player1.life = 19;
    life.player2.life = 18;
    apply([update('players', life)]);
    expect(summary()).toContain('Your life: 19');
    expect(summary()).toContain('Opponent life: 18');

    const drained = structuredClone(useGameStore.getState().room!.players);
    for (const key of Object.keys(drained.player1.mana)) (drained.player1.mana as unknown as Record<string, number>)[key] = 0;
    apply([update('players', drained)]);
    expect(summary()).toContain('Your mana: none');

    const charged = structuredClone(useGameStore.getState().room!.players);
    for (const key of Object.keys(charged.player1.mana)) (charged.player1.mana as unknown as Record<string, number>)[key] = 0;
    (charged.player1.mana as unknown as Record<string, number>).red = 3;
    apply([update('players', charged)]);
    expect(summary()).toContain('Your mana: red:3');
  });

  it('narrates both attacker and blocker declaration transitions', () => {
    const attacker = creature('attacker', 'player1');
    const blocker = creature('blocker', 'player2');

    seed({ battlefield: [attacker, blocker], phase: 'declareAttackersStep' });
    apply([
      update('combatDeclarations', { attackers: true, blockers: false }),
      update('combat', [{ uuid: attacker.uuid, attacker, attackerPower: 2, blockers: [], blocked: false }]),
    ]);
    expect(summary()).toContain('Attackers: attacker');

    apply([
      update('combatDeclarations', { attackers: true, blockers: true }),
      update('combat', [{ uuid: attacker.uuid, attacker, attackerPower: 2, blockers: [blocker], blocked: true }]),
    ]);
    expect(summary()).toContain('Blocks: attacker blocked by blocker');

    seed({ battlefield: [attacker, blocker], phase: 'declareAttackersStep', combat: [], combatDeclarations: undefined });
    apply([update('combatDeclarations', { attackers: true, blockers: false })]);
    expect(summary()).toContain('No attackers');

    seed({
      battlefield: [attacker, blocker],
      phase: 'declareBlockersStep',
      combat: [{ uuid: attacker.uuid, attacker, attackerPower: 2, blockers: [], blocked: false }],
      combatDeclarations: { attackers: true, blockers: false },
    } as Partial<PlayerView>);
    apply([update('combatDeclarations', { attackers: true, blockers: true })]);
    expect(summary()).toContain('No blocks');
  });

  it('announces completed combat damage', () => {
    seed({ combatDamage: null });
    apply([update('combatDamage', { completed: true })]);
    expect(summary()).toContain('Combat damage resolved');
  });

  it('announces a concession from either seat and a plain game over', () => {
    seed();
    apply([update('outcome', { type: 'draw', losses: [{ playerId: 'player1', reason: 'concede' }] })]);
    expect(summary()).toContain('You conceded');

    seed();
    apply([update('outcome', { type: 'draw', losses: [{ playerId: 'player2', reason: 'concede' }] })]);
    expect(summary()).toContain('Opponent conceded');

    seed();
    apply([update('outcome', { type: 'draw', losses: [{ playerId: 'player1', reason: 'failed_draw' }] })]);
    expect(summary()).toContain('Game over');
  });

  it('warns briefly when a board change invalidates the drafted attack', () => {
    vi.useFakeTimers();
    const card = creature('doomed', 'player1');
    seed({ battlefield: [card], phase: 'declareAttackersStep', status: 'playing', combatDeclarations: { attackers: false, blockers: false } });
    useGameStore.setState({ combatSelection: { attackers: [card.uuid], blockerPairs: [], pendingBlocker: null } });

    apply([update('battlefield', [])]);

    expect(useGameStore.getState().combatSelection.attackers).toEqual([]);
    expect(useGameStore.getState().combatNotification).toBe('Selection updated due to board change');
    vi.advanceTimersByTime(2000);
    expect(useGameStore.getState().combatNotification).toBeNull();
  });
});

describe('snapshot restoration', () => {
  it('replaces the board, clears local drafts and rewinds the log boundary', () => {
    const room = seed();
    useGameStore.setState({ targeting: targetingState(), contextMenu: { x: 1, y: 2, cardUuid: 'c', zone: 'hand', options: [] }, pendingCard: { cardUuid: 'c', zone: 'hand' } });

    apply([update('players.player1.life', 19)]);
    expect(useGameStore.getState().log).toHaveLength(1);

    useGameStore.getState().setRoom(room, 0);

    const state = useGameStore.getState();
    expect(state.room).toEqual(room);
    expect(state.lastSeq).toBe(0);
    expect(state.targeting).toBeNull();
    expect(state.contextMenu).toBeNull();
    expect(state.pendingCard).toBeNull();
    expect(state.combatSelection).toEqual({ attackers: [], blockerPairs: [], pendingBlocker: null });
    expect(state.log).toEqual([]);
  });

  it('refuses a snapshot from another protocol version', () => {
    const room = createTestRoom();
    useGameStore.getState().setRoom(room);
    useGameStore.getState().setRoom({ ...room, protocolVersion: 2 } as unknown as PlayerView);

    expect(useGameStore.getState().room).toEqual(room);
  });

  it('restores an owned pending choice and can stay silent about diagnostics', () => {
    const room = { ...createTestRoom(), pendingChoice: listedChoice('restored') } as PlayerView;
    const log = vi.spyOn(clientLogger, 'info');

    useGameStore.getState().setRoom(room);
    expect(log).toHaveBeenCalledWith('snapshot:applied', 'Room restored', expect.objectContaining({ roomId: room.roomId, choiceId: 'restored' }));

    const original = gameConfig.logging.actions;
    (gameConfig.logging as { actions: boolean }).actions = false;
    try {
      log.mockClear();
      useGameStore.getState().setRoom(createTestRoom());
      expect(log).not.toHaveBeenCalled();
    } finally {
      (gameConfig.logging as { actions: boolean }).actions = original;
    }
  });
});

describe('context menu lifecycle', () => {
  it('opens at the requested position or at the origin and closes again', () => {
    seed();
    useGameStore.getState().requestOptions('card-1', 'hand');
    expect(useGameStore.getState().pendingCard).toEqual({ cardUuid: 'card-1', zone: 'hand' });

    useGameStore.getState().showContextMenu([option('pass_priority')]);
    expect(useGameStore.getState().contextMenu).toEqual({
      x: 0, y: 0, cardUuid: 'card-1', zone: 'hand', options: [option('pass_priority')],
    });
    expect(useGameStore.getState().pendingCard).toBeNull();

    useGameStore.getState().hideContextMenu();
    expect(useGameStore.getState().contextMenu).toBeNull();

    useGameStore.getState().showContextMenu([]);
    expect(useGameStore.getState().contextMenu).toBeNull();

    useGameStore.getState().requestOptions('card-2', 'battlefield', { x: 12, y: 34 });
    useGameStore.getState().showContextMenu([]);
    expect(useGameStore.getState().contextMenu).toMatchObject({ x: 12, y: 34, zone: 'battlefield' });
  });
});

describe('target drafting', () => {
  it('requires a draft before accepting targets and honours the group maximum', () => {
    seed();
    useGameStore.getState().addTarget(target('a'));
    useGameStore.getState().removeTarget(target('a'));
    useGameStore.getState().toggleTarget(target('a'));
    expect(useGameStore.getState().targeting).toBeNull();

    useGameStore.getState().beginTargeting(targetingState());
    useGameStore.getState().addTarget(target('unknown'));
    expect(useGameStore.getState().targeting?.collected).toEqual([]);

    useGameStore.getState().addTarget(target('a'));
    useGameStore.getState().addTarget(target('b'));
    expect(useGameStore.getState().targeting?.collected.map(pointer => pointer.cardUuid)).toEqual(['a', 'b']);

    useGameStore.getState().addTarget(target('a'));
    expect(useGameStore.getState().targeting?.collected).toHaveLength(2);

    useGameStore.getState().removeTarget(target('a'));
    expect(useGameStore.getState().targeting?.collected.map(pointer => pointer.cardUuid)).toEqual(['b']);
  });

  it('toggles a collected target off and refuses an uncollected one at the limit', () => {
    seed();
    useGameStore.getState().beginTargeting(targetingState());
    useGameStore.getState().toggleTarget(target('unknown'));
    expect(useGameStore.getState().targeting?.collected).toEqual([]);

    useGameStore.getState().toggleTarget(target('a'));
    expect(useGameStore.getState().targeting?.collected.map(pointer => pointer.cardUuid)).toEqual(['a']);
    useGameStore.getState().toggleTarget(target('a'));
    expect(useGameStore.getState().targeting?.collected).toEqual([]);

    useGameStore.getState().beginTargeting(targetingState({
      targeting: { type: 'permanent', required: true, maxTargets: 1 },
      collected: [target('b')],
    }));
    useGameStore.getState().toggleTarget(target('a'));
    expect(useGameStore.getState().targeting?.collected.map(pointer => pointer.cardUuid)).toEqual(['b']);
  });

  it('cancels, confirms and logs only when diagnostics are enabled', () => {
    seed();
    const log = vi.spyOn(clientLogger, 'info');

    useGameStore.getState().beginTargeting(targetingState());
    useGameStore.getState().cancelTargeting();
    expect(useGameStore.getState().targeting).toBeNull();
    expect(log).toHaveBeenCalledWith('targeting:cancelled', 'Unsent targeting cancelled', expect.objectContaining({ cardUuid: 'source' }));

    useGameStore.getState().beginTargeting(targetingState());
    useGameStore.getState().confirmTargeting();
    expect(useGameStore.getState().targeting).toBeNull();

    const original = gameConfig.logging.actions;
    (gameConfig.logging as { actions: boolean }).actions = false;
    try {
      log.mockClear();
      useGameStore.getState().beginTargeting(targetingState());
      useGameStore.getState().cancelTargeting();
      expect(log).not.toHaveBeenCalled();
      expect(useGameStore.getState().targeting).toBeNull();
    } finally {
      (gameConfig.logging as { actions: boolean }).actions = original;
    }
  });
});

describe('combat selection controls', () => {
  it('toggles attackers only for permanents this seat controls', () => {
    const mine = creature('mine', 'player1');
    seed({ battlefield: [mine] });

    useGameStore.getState().toggleAttacker('mine');
    expect(useGameStore.getState().combatSelection.attackers).toEqual(['mine']);
    useGameStore.getState().toggleAttacker('mine');
    expect(useGameStore.getState().combatSelection.attackers).toEqual([]);

    useGameStore.getState().toggleAttacker('missing');
    expect(useGameStore.getState().combatSelection.attackers).toEqual([]);

    seed({ battlefield: [mine] }, 'player2');
    useGameStore.getState().toggleAttacker('mine');
    expect(useGameStore.getState().combatSelection.attackers).toEqual([]);

    seed();
    useGameStore.setState({ room: null });
    useGameStore.getState().toggleAttacker('mine');
    expect(useGameStore.getState().combatSelection.attackers).toEqual([]);
  });

  it('selects, deselects and pairs blockers through the same controls', () => {
    const first = creature('first', 'player1');
    const second = creature('second', 'player1');
    seed({ battlefield: [first, second] });

    useGameStore.getState().selectBlocker('second');
    expect(useGameStore.getState().combatSelection.pendingBlocker).toBe('second');
    useGameStore.getState().selectBlocker('second');
    expect(useGameStore.getState().combatSelection.pendingBlocker).toBeNull();

    useGameStore.getState().assignBlocker('first');
    expect(useGameStore.getState().combatSelection.blockerPairs).toEqual([]);

    useGameStore.getState().selectBlocker('second');
    useGameStore.getState().assignBlocker('first');
    expect(useGameStore.getState().combatSelection.blockerPairs).toEqual([{ attackerUuid: 'first', blockerUuid: 'second' }]);

    useGameStore.getState().selectBlocker('second');
    useGameStore.getState().assignBlocker('first');
    expect(useGameStore.getState().combatSelection.blockerPairs).toEqual([]);

    useGameStore.getState().selectBlocker('missing');
    expect(useGameStore.getState().combatSelection.pendingBlocker).toBeNull();

    useGameStore.setState({ myPlayerId: 'player2' });
    useGameStore.getState().selectBlocker('first');
    expect(useGameStore.getState().combatSelection.pendingBlocker).toBeNull();

    useGameStore.getState().clearCombatSelection();
    expect(useGameStore.getState().combatSelection).toEqual({ attackers: [], blockerPairs: [], pendingBlocker: null });
  });
});

describe('session and error state', () => {
  it('persists the room and seat and clears every tab-local trace on exit', () => {
    seed();
    const room = { ...createTestRoom(), roomId: 'room-77' };
    useGameStore.getState().setRoomId(room.roomId);
    expect(useGameStore.getState().room).toBeNull();
    useGameStore.getState().setRoom(room);
    useGameStore.getState().setMyPlayerId('player1');
    useGameStore.getState().setError('Not your priority!');
    apply([update('players.player1.life', 19)]);
    expect(sessionStorage.getItem('cardgame.roomId')).toBe('room-77');

    useGameStore.getState().clearSession();

    const state = useGameStore.getState();
    expect(state.roomId).toBeNull();
    expect(state.room).toBeNull();
    expect(state.myPlayerId).toBeNull();
    expect(state.error).toBeNull();
    expect(state.log).toEqual([]);
    expect(state.autoPass).toEqual({ enabled: false, passAt: null });
    expect(state.combatSelection).toEqual({ attackers: [], blockerPairs: [], pendingBlocker: null });
    expect(sessionStorage.getItem('cardgame.roomId')).toBeNull();
  });
});

describe('derived selectors', () => {
  it('return neutral values without a room or a seat', () => {
    useGameStore.setState(freshState());
    const state = useGameStore.getState();

    expect(selectMyPlayerId(state)).toBeNull();
    expect(selectMyHand(state)).toEqual([]);
    expect(selectMyBattlefield(state)).toEqual([]);
    expect(selectOpponentBattlefield(state)).toEqual([]);
    expect(selectOpponentId(state)).toBeNull();
    expect(selectOpponentHandCount(state)).toBe(0);
    expect(selectIsMyTurn(state)).toBe(false);
    expect(selectCurrentPhase(state)).toBeNull();
    expect(selectRpsWaitingForOpponent(state)).toBe(false);
    expect(selectHasPriority(state)).toBe(false);
    expect(selectTargeting(state)).toBeNull();
  });

  it('scopes the board and hand to the viewing seat', () => {
    const mine = creature('mine', 'player1');
    const theirs = creature('theirs', 'player2');
    const room = seed({ battlefield: [mine, theirs] });
    const state = useGameStore.getState();

    expect(selectMyPlayerId(state)).toBe('player1');
    expect(selectMyHand(state)).toEqual(room.players.player1.hand);
    expect(selectMyBattlefield(state)).toEqual([mine]);
    expect(selectOpponentBattlefield(state)).toEqual([theirs]);
    expect(selectOpponentId(state)).toBe('player2');
    expect(selectOpponentHandCount(state)).toBe(0);
    expect(selectIsMyTurn(state)).toBe(true);
    expect(selectCurrentPhase(state)).toBe('stateMainPhase');
  });

  it('tolerates a seat missing from the projected players record', () => {
    const room = createTestRoom();
    const withoutOpponent = {
      ...room,
      players: Object.fromEntries(Object.entries(room.players).filter(([id]) => id !== 'player2')),
    } as PlayerView;
    useGameStore.setState({ room: withoutOpponent, myPlayerId: 'player1' });
    expect(selectOpponentHandCount(useGameStore.getState())).toBe(0);

    useGameStore.setState({ room, myPlayerId: 'ghost' });
    expect(selectMyHand(useGameStore.getState())).toEqual([]);
    expect(selectOpponentId(useGameStore.getState())).toBe('player1');
    expect(selectOpponentHandCount(useGameStore.getState())).toBe(room.players.player1.handCount);

    const noOpponent = { ...createTestRoom(), player2Id: null } as PlayerView;
    useGameStore.setState({ room: noOpponent, myPlayerId: 'player1' });
    expect(selectOpponentId(useGameStore.getState())).toBeNull();
    expect(selectOpponentHandCount(useGameStore.getState())).toBe(0);
    expect(selectRpsWaitingForOpponent(useGameStore.getState())).toBe(false);
  });

  it('reports only a waiting rock-paper-scissors round', () => {
    const base = createTestRoom({ status: 'RPS' });
    const choosing = { ...base, rpsState: { status: 'choosing', playedCards: { player1: 'rock' } } } as PlayerView;
    useGameStore.setState({ room: choosing, myPlayerId: 'player1' });
    expect(selectRpsWaitingForOpponent(useGameStore.getState())).toBe(true);

    const answered = { ...choosing, rpsState: { status: 'choosing', playedCards: { player1: 'rock', player2: 'scissors' } } } as PlayerView;
    useGameStore.setState({ room: answered });
    expect(selectRpsWaitingForOpponent(useGameStore.getState())).toBe(false);

    const undecided = { ...choosing, rpsState: { status: 'choosing', playedCards: {} } } as PlayerView;
    useGameStore.setState({ room: undecided });
    expect(selectRpsWaitingForOpponent(useGameStore.getState())).toBe(false);

    const emptySeat = { ...choosing, player2Id: null } as PlayerView;
    useGameStore.setState({ room: emptySeat, myPlayerId: 'player1' });
    expect(selectRpsWaitingForOpponent(useGameStore.getState())).toBe(false);

    useGameStore.setState({ room: createTestRoom({ status: 'playing' }), myPlayerId: 'player1' });
    expect(selectRpsWaitingForOpponent(useGameStore.getState())).toBe(false);
  });

  it('reports priority only while the engine waits for this player without a pending choice', () => {
    useGameStore.setState({ room: createTestRoom({ priorityPlayerId: 'player1', engineState: 'waiting_for_player' }), myPlayerId: 'player1' });
    expect(selectHasPriority(useGameStore.getState())).toBe(true);

    seed({ priorityPlayerId: 'player1', engineState: 'waiting_for_player', pendingChoice: listedChoice('q') });
    expect(selectHasPriority(useGameStore.getState())).toBe(false);

    useGameStore.setState({ room: createTestRoom({ priorityPlayerId: 'player1', engineState: 'resolving_stack' }), myPlayerId: 'player1' });
    expect(selectHasPriority(useGameStore.getState())).toBe(false);

    useGameStore.setState({ room: createTestRoom({ priorityPlayerId: 'player2', engineState: 'waiting_for_player' }), myPlayerId: 'player1' });
    expect(selectHasPriority(useGameStore.getState())).toBe(false);

    useGameStore.setState({ room: createTestRoom() , myPlayerId: null });
    expect(selectHasPriority(useGameStore.getState())).toBe(false);
  });

  it('exposes the current targeting draft', () => {
    seed();
    const draft = targetingState();
    useGameStore.getState().beginTargeting(draft);
    expect(selectTargeting(useGameStore.getState())).toEqual(draft);
  });
});
