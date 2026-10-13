import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createElement, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import CardComponent from '../../src/client/components/CardComponent';
import PhaseBar from '../../src/client/components/PhaseBar';
import CombatDisplay from '../../src/client/components/CombatDisplay';
import ChoicePanel from '../../src/client/components/ChoicePanel';
import { useGameStore } from '../../src/client/store/gameStore';
import socket from '../../src/client/socket';
import { creature } from '../helpers/combat-fixture';
import { createTestRoom } from '../helpers/test-room-factory';

vi.mock('../../src/client/socket', () => ({ default: { emit: vi.fn(), on: vi.fn(), off: vi.fn() } }));
vi.mock('zustand/react/shallow', () => ({ useShallow: (selector: unknown) => selector }));
vi.mock('../../src/client/store/gameStore', async importOriginal => {
  const actual = await importOriginal<typeof import('../../src/client/store/gameStore')>();
  return { ...actual, useGameStore: Object.assign((selector: (state: ReturnType<typeof actual.useGameStore.getState>) => unknown) => selector(actual.useGameStore.getState()), actual.useGameStore) };
});
function capture(component: () => ReactElement | null) {
  let element!: ReactElement<any>;
  renderToStaticMarkup(createElement(() => { element = component()!; return null; })); return element;
}
function button(element: ReactElement<any>, label: string): ReactElement<any> | undefined {
  if (!element || typeof element !== 'object') return;
  if (element.type === 'button' && renderToStaticMarkup(element).replace(/<[^>]*>/g, '').includes(label)) return element;
  const children = [element.props?.children].flat(Infinity);
  for (const child of children) { const found = button(child, label); if (found) return found; }
}
describe('ordinary combat controls', () => {
  beforeEach(() => { vi.clearAllMocks(); useGameStore.setState({ room: createTestRoom({ phase: 'declareAttackersStep', priorityPlayerId: null, combatDeclarations: { attackers: false, blockers: false } }), roomId: 'room', myPlayerId: 'player1', targeting: null,
    combatSelection: { attackers: [], blockerPairs: [], pendingBlocker: null }, combatNotification: null, error: null, log: [] }); });
  it('selects a sick candidate, preserves its rejected draft and lets the player repair it', () => {
    const room = useGameStore.getState().room!, card = creature('candidate', 'player1'); card.state.summoningSickness = true; room.battlefield = [card];
    capture(() => CardComponent({ card, zone: 'battlefield' })).props.onClick({});
    expect(useGameStore.getState().combatSelection.attackers).toEqual([card.uuid]);
    button(capture(PhaseBar), 'Confirm Attackers')!.props.onClick();
    expect(socket.emit).toHaveBeenCalledWith('playerAction', expect.objectContaining({ actionId: 'declare_attackers', attackers: [{ cardUuid: card.uuid }] }));
    useGameStore.getState().setError('candidate has summoning sickness');
    expect(useGameStore.getState().combatSelection.attackers).toEqual([card.uuid]);
    capture(() => CardComponent({ card, zone: 'battlefield' })).props.onClick({});
    expect(useGameStore.getState().combatSelection.attackers).toEqual([]);
  });
  it('retains a blocker draft after sending, supports clear, and clears on acceptance', () => {
    const room = useGameStore.getState().room!, attacker = creature('attacker', 'player1'), blocker = creature('blocker', 'player2');
    room.phase = 'declareBlockersStep'; room.combatDeclarations = { attackers: true, blockers: false }; room.battlefield = [attacker, blocker]; room.combat = [{ uuid: attacker.uuid, attacker, attackerPower: 1, blockers: [] }];
    useGameStore.setState({ myPlayerId: 'player2', combatSelection: { attackers: [], blockerPairs: [{ attackerUuid: attacker.uuid, blockerUuid: blocker.uuid }], pendingBlocker: null } });
    button(capture(PhaseBar), 'Confirm Blockers')!.props.onClick();
    expect(useGameStore.getState().combatSelection.blockerPairs).toHaveLength(1);
    button(capture(PhaseBar), 'Clear Selection')!.props.onClick();
    expect(useGameStore.getState().combatSelection.blockerPairs).toEqual([]);
    useGameStore.getState().selectBlocker(blocker.uuid); useGameStore.getState().assignBlocker(attacker.uuid);
    useGameStore.getState().applyDelta({ roomId: 'room', seq: 1, timestamp: 0, action: 'declare_blockers', changes: [{ op: 'update', path: 'combatDeclarations', value: { attackers: true, blockers: true } }] });
    expect(useGameStore.getState().combatSelection.blockerPairs).toEqual([]); expect(useGameStore.getState().combatNotification).toBeNull();
  });
  it('clears a settled attacker draft even if the accepted creature remains untapped', () => {
    const room = useGameStore.getState().room!, card = creature('untapped', 'player1'); room.battlefield = [card];
    useGameStore.setState({ combatSelection: { attackers: [card.uuid], blockerPairs: [], pendingBlocker: null } });
    useGameStore.getState().applyDelta({ roomId: 'room', seq: 1, timestamp: 0, changes: [{ op: 'update', path: 'combatDeclarations', value: { attackers: true, blockers: false } }] });
    expect(useGameStore.getState().combatSelection.attackers).toEqual([]); expect(useGameStore.getState().combatNotification).toBeNull();
  });
  it('removes an existing block pair through the same pairing controls', () => {
    const room = useGameStore.getState().room!; room.battlefield = [creature('b', 'player1')];
    useGameStore.getState().selectBlocker('b'); useGameStore.getState().assignBlocker('a');
    useGameStore.getState().selectBlocker('b'); useGameStore.getState().assignBlocker('a');
    expect(useGameStore.getState().combatSelection.blockerPairs).toEqual([]);
  });
  it('keeps a rejected duplicate-blocker draft editable and repairs the extra pair', () => {
    const room = useGameStore.getState().room!, a = creature('a', 'player1'), c = creature('c', 'player1'), b = creature('b', 'player2');
    room.battlefield = [a, c, b]; room.phase = 'declareBlockersStep'; room.combatDeclarations = { attackers: true, blockers: false };
    room.combat = [a, c].map(attacker => ({ uuid: attacker.uuid, attacker, attackerPower: 1, blockers: [] })); useGameStore.setState({ myPlayerId: 'player2' });
    for (const attacker of [a, c]) { useGameStore.getState().selectBlocker(b.uuid); useGameStore.getState().assignBlocker(attacker.uuid); }
    button(capture(PhaseBar), 'Confirm Blockers')!.props.onClick(); useGameStore.getState().setError('Blocker b is already assigned to another attacker');
    expect(useGameStore.getState().combatSelection.blockerPairs).toHaveLength(2);
    useGameStore.getState().selectBlocker(b.uuid); button(capture(CombatDisplay), 'c')!.props.onClick();
    expect(useGameStore.getState().combatSelection.blockerPairs).toEqual([{ attackerUuid: a.uuid, blockerUuid: b.uuid }]);
  });
  it('clears drafts on a committed snapshot and on ordinary phase handoff', () => {
    const card = creature('ready', 'player1'), room = useGameStore.getState().room!; room.battlefield = [card];
    useGameStore.getState().toggleAttacker(card.uuid);
    useGameStore.getState().setRoom({ ...room, combatDeclarations: { attackers: true, blockers: false } });
    expect(useGameStore.getState().combatSelection.attackers).toEqual([]);
    useGameStore.setState({ room, combatSelection: { attackers: [card.uuid], blockerPairs: [], pendingBlocker: null } });
    useGameStore.getState().applyDelta({ roomId: 'room', seq: 1, timestamp: 0, changes: [{ op: 'update', path: 'phase', value: 'endCombatStep' }] });
    expect(useGameStore.getState().combatSelection.attackers).toEqual([]); expect(useGameStore.getState().combatNotification).toBeNull();
  });
  it('discards an unsent local draft when a full snapshot restores an open declaration', () => {
    const room = useGameStore.getState().room!, card = creature('ready', 'player1'); room.battlefield = [card];
    useGameStore.getState().toggleAttacker(card.uuid);
    useGameStore.getState().setRoom(structuredClone(room));
    expect(useGameStore.getState().combatSelection.attackers).toEqual([]);
  });
  it('distinguishes identical names across both controllers in combat', () => {
    const room = useGameStore.getState().room!, a = creature('a', 'player1'), b = creature('b', 'player2');
    a.blueprint = { ...a.blueprint, name: 'Servant' }; b.blueprint = { ...b.blueprint, name: 'Servant' }; room.battlefield = [a, b];
    room.combat = [{ uuid: a.uuid, attacker: a, attackerPower: 1, blockers: [b], blocked: true }];
    const display = renderToStaticMarkup(createElement(CombatDisplay));
    expect(display).toContain('Servant #1'); expect(display).toContain('Servant #2');
  });
  it('uses matching distinct labels on identical creatures, combat and manual allocations', () => {
    const room = useGameStore.getState().room!, a = creature('a', 'player1'), b = creature('b', 'player2'), c = creature('c', 'player2');
    b.blueprint = { ...b.blueprint, name: 'Servant' }; c.blueprint = { ...c.blueprint, name: 'Servant' };
    room.battlefield = [a, b, c]; room.phase = 'combatDamageStep'; room.combatDeclarations = { attackers: true, blockers: true };
    room.combat = [{ uuid: a.uuid, attacker: a, attackerPower: 1, blockers: [b, c], blocked: true }];
    room.pendingChoice = { id: 'damage', playerId: 'player1', kind: 'distribution', prompt: 'Assign damage', min: 0, max: 2, total: 1, minimumPerOption: 0,
      options: [b, c].map(card => ({ id: card.uuid, label: 'Servant', value: { kind: 'permanent', cardUuid: card.uuid, zoneRevision: card.state.zoneRevision ?? 0 } })), continuation: { type: 'combat', sourceUuid: a.uuid, passIndex: 0 } };
    expect(renderToStaticMarkup(createElement(CardComponent, { card: b, zone: 'battlefield' }))).toContain('Servant #1');
    expect(renderToStaticMarkup(createElement(CombatDisplay))).toContain('Servant #2');
    expect(renderToStaticMarkup(createElement(ChoicePanel))).toContain('aria-label="Servant #1"');
    expect(renderToStaticMarkup(createElement(ChoicePanel))).toContain('aria-label="Servant #2"');
    const original = structuredClone(room.pendingChoice);
    renderToStaticMarkup(createElement(ChoicePanel)); expect(room.pendingChoice).toEqual(original);
    room.pendingChoice.options = [{ id: 'player:player2', label: 'player2', value: { kind: 'player', playerId: 'player2' } }];
    expect(renderToStaticMarkup(createElement(ChoicePanel))).toContain('aria-label="Opponent"');
  });
  it('summarizes accepted declarations, damage and departures', () => {
    const room = useGameStore.getState().room!, card = creature('fighter', 'player1'); room.battlefield = [card];
    useGameStore.getState().applyDelta({ roomId: 'room', seq: 1, timestamp: 0, changes: [
      { op: 'update', path: 'combatDeclarations', value: { attackers: true, blockers: false } }, { op: 'update', path: 'combat', value: [{ uuid: card.uuid, attacker: card, attackerPower: 1, blockers: [] }] },
    ] }); expect(useGameStore.getState().log.at(-1)?.summary).toContain('Attackers: fighter');
    useGameStore.getState().applyDelta({ roomId: 'room', seq: 2, timestamp: 0, changes: [{ op: 'update', path: 'battlefield', value: [] }] });
    expect(useGameStore.getState().log.at(-1)?.summary).toContain('Left battlefield: fighter');
    useGameStore.getState().applyDelta({ roomId: 'room', seq: 3, timestamp: 0, changes: [{ op: 'update', path: 'combatDamage', value: { completed: true } }] });
    expect(useGameStore.getState().log.at(-1)?.summary).toContain('Combat damage resolved');
  });
});
