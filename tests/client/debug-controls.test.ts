import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createElement, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import DebugControls from '../../src/client/components/DebugControls';
import PhaseBar from '../../src/client/components/PhaseBar';
import { useGameStore } from '../../src/client/store/gameStore';
import { createTestRoom } from '../helpers/test-room-factory';
import type { DebugMode } from '../../src/types/debug-mode.types';
import socket from '../../src/client/socket';

vi.mock('../../src/client/socket', () => ({ default: { emit: vi.fn(), on: vi.fn(), off: vi.fn() } }));
// SSR otherwise reads Zustand's initial snapshot instead of the fixture state.
vi.mock('../../src/client/store/gameStore', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/client/store/gameStore')>();
  return { ...actual, useGameStore: Object.assign(
    (selector: (state: ReturnType<typeof actual.useGameStore.getState>) => unknown) => selector(actual.useGameStore.getState()),
    actual.useGameStore,
  ) };
});

describe('debug controls', () => {
  it.each<[DebugMode, number, string | null]>([
    ['off', 0, null], ['off', 1, null],
    ['stack', 0, null], ['stack', 1, 'Resolve Stack'],
    ['flow', 0, 'End Turn'], ['flow', 1, 'Resolve Stack'],
  ])('renders %s mode with stack length %i', (mode, stackLength, label) => {
    const html = renderToStaticMarkup(createElement(DebugControls, { mode, stackLength, ready: true, onAction: vi.fn() }));
    if (label) {
      expect(html).toContain('aria-label="Debug actions"');
      expect(html).toContain(label);
      expect(html).toContain('<details'); expect(html).toContain('<summary>Debug actions</summary>');
      expect(html).not.toMatch(/<details[^>]*\bopen/);
      expect(html).not.toContain(label === 'End Turn' ? 'Resolve Stack' : 'End Turn');
    } else {
      expect(html).toBe('');
    }
  });

  it.each<[DebugMode, number]>([['stack', 1], ['flow', 0], ['flow', 1]])('hides %s controls when not ready', (mode, stackLength) => {
    expect(renderToStaticMarkup(createElement(DebugControls, { mode, stackLength, ready: false, onAction: vi.fn() }))).toBe('');
  });
});

describe('PhaseBar debug integration', () => {
  it('offers zero-attacker confirmation without priority and hides it after declaration', () => {
    const room = createTestRoom({ phase: 'declareAttackersStep', priorityPlayerId: null, debugMode: 'off' });
    useGameStore.setState({ room, myPlayerId: 'player1' });
    let html = renderToStaticMarkup(createElement(PhaseBar));
    expect(html).toContain('No attacks'); expect(html).not.toContain('disabled');
    expect(html).not.toContain('Pass Priority');
    room.combatDeclarations = { attackers: true, blockers: false }; room.priorityPlayerId = 'player1';
    useGameStore.setState({ room: { ...room } });
    html = renderToStaticMarkup(createElement(PhaseBar));
    expect(html).not.toContain('No attacks'); expect(html).toContain('Continue');
  });
  it('offers blocker choices to the defender independently of priority', () => {
    useGameStore.setState({ room: createTestRoom({ phase: 'declareBlockersStep', priorityPlayerId: null }), myPlayerId: 'player2' });
    const html = renderToStaticMarkup(createElement(PhaseBar));
    expect(html).toContain('No blocks'); expect(html).not.toContain('Pass Priority');
    useGameStore.setState({ myPlayerId: 'player1' });
    expect(renderToStaticMarkup(createElement(PhaseBar))).not.toContain('No blocks');
  });
  it('labels postcombat main and offers no second combat shortcut', () => {
    useGameStore.setState({ room: createTestRoom({ phase: 'postcombatMainPhase' }), myPlayerId: 'player1' });
    const html = renderToStaticMarkup(createElement(PhaseBar));
    expect(html).toContain('Postcombat Main'); expect(html).not.toContain('Pass to Combat');
  });
  beforeEach(() => {
    useGameStore.setState({ room: createTestRoom(), roomId: 'room', myPlayerId: 'player1', targeting: null,
      combatSelection: { attackers: [], blockerPairs: [], pendingBlocker: null } });
  });

  it('uses the flow default for an older room and allows the nonactive player to end the turn', () => {
    useGameStore.setState({ myPlayerId: 'player2' });
    const html = renderToStaticMarkup(createElement(PhaseBar));
    expect(html).toContain('Debug actions');
    expect(html).toContain('End Turn');
  });

  it('respects a room override disabling debug controls', () => {
    useGameStore.setState({ room: createTestRoom({ debugMode: 'off' }) });
    const html = renderToStaticMarkup(createElement(PhaseBar));
    expect(html).not.toContain('End Turn');
    expect(html).not.toContain('Debug actions');
    expect(html).toContain('Go to combat');
  });

  it('allows the player without priority to resolve an open stack', () => {
    const room = createTestRoom({ debugMode: 'stack' });
    // Rendering only consumes stack length, so no effect execution fixture is needed.
    room.stack.length = 1;
    useGameStore.setState({ room, myPlayerId: 'player2' });
    const html = renderToStaticMarkup(createElement(PhaseBar));
    expect(html).toContain('Resolve Stack');
    expect(html).not.toContain('End Turn');
    expect(html).not.toContain('Pass Priority');
  });

  it.each(['resolving_stack', 'state_based_actions', 'game_over'] as const)('hides debug controls while %s', (engineState) => {
    useGameStore.setState({ room: createTestRoom({ engineState }) });
    expect(renderToStaticMarkup(createElement(PhaseBar))).not.toContain('Debug actions');
  });

  it.each(['RPS', 'gameOver'] as const)('hides debug controls in %s status', (status) => {
    useGameStore.setState({ room: createTestRoom({ status }) });
    expect(renderToStaticMarkup(createElement(PhaseBar))).not.toContain('Debug actions');
  });

  it('hides debug controls as soon as an outcome exists', () => {
    useGameStore.setState({ room: createTestRoom({ outcome: { type: 'draw', losses: [] } }) });
    expect(renderToStaticMarkup(createElement(PhaseBar))).not.toContain('Debug actions');
  });

  it('requires priority to enter battle even on the active player turn', () => {
    useGameStore.setState({ room: createTestRoom({ priorityPlayerId: 'player2' }) });
    const html = renderToStaticMarkup(createElement(PhaseBar));
    expect(html).not.toContain('primary-action');
    expect(html).not.toContain('Play cards or continue toward combat');
    expect(html).toContain('Waiting for opponent to act');
    expect(html).toContain('End Turn');
  });

  it('offers one main-phase action using the existing enter-battle command', () => {
    const html = renderToStaticMarkup(createElement(PhaseBar));
    expect(html).toContain('Go to combat');
    expect(html).not.toContain('Pass Priority');
    expect((html.match(/class="primary-action"/g) ?? [])).toHaveLength(1);
    let tree!: ReactElement<any>;
    renderToStaticMarkup(createElement(() => { tree = PhaseBar(); return null; }));
    const find = (node: any): any => node?.props?.className === 'primary-action' ? node
      : [node?.props?.children].flat(Infinity).filter(child => child && typeof child === 'object').map(find).find(Boolean);
    vi.mocked(socket.emit).mockClear(); find(tree).props.onClick();
    expect(socket.emit).toHaveBeenCalledTimes(1);
    expect(socket.emit).toHaveBeenCalledWith('playerAction', expect.objectContaining({ actionId: 'enter_battle' }));
  });

  it('offers one no-block action for an empty draft and no phase action while targeting', () => {
    useGameStore.setState({ room: createTestRoom({ phase: 'declareBlockersStep', priorityPlayerId: null, debugMode: 'off' }), myPlayerId: 'player2',
      combatSelection: { attackers: [], blockerPairs: [], pendingBlocker: null } });
    const html = renderToStaticMarkup(createElement(PhaseBar));
    expect(html).toContain('No blocks'); expect(html).not.toContain('Confirm Blockers (0)');
    expect((html.match(/class="primary-action"/g) ?? [])).toHaveLength(1);
    useGameStore.setState({ room: createTestRoom(), myPlayerId: 'player1', targeting: { actionId: 'cast_spell', cardUuid: 'card', zone: 'hand', targeting: { type: 'player', required: true }, collected: [] } });
    const targeting = renderToStaticMarkup(createElement(PhaseBar));
    expect(targeting).toContain('Choose targets on the board'); expect(targeting).not.toContain('primary-action'); expect(targeting).not.toContain('Debug actions');
  });

  it('explains a pending choice instead of reporting board resolution', () => {
    const room = createTestRoom({ engineState: 'state_based_actions' });
    room.pendingChoice = { id: 'choice', playerId: 'player1', kind: 'targets', prompt: 'Choose a target', min: 1, max: 1, options: [], continuation: { type: 'trigger', field: 'targetGroups', triggerUuid: 'trigger', groupId: 'effect-0' } };
    useGameStore.setState({ room, targeting: null });
    const html = renderToStaticMarkup(createElement(PhaseBar));
    expect(html).toContain('Choose below to continue'); expect(html).not.toContain('Updating the board'); expect(html).not.toContain('primary-action');
  });
});
