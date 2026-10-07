import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import DebugControls from '../../src/client/components/DebugControls';
import PhaseBar from '../../src/client/components/PhaseBar';
import { useGameStore } from '../../src/client/store/gameStore';
import { createTestRoom } from '../helpers/test-room-factory';
import type { DebugMode } from '../../src/types/debug-mode.types';

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
  beforeEach(() => {
    useGameStore.setState({ room: createTestRoom(), roomId: 'room', myPlayerId: 'player1' });
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
    expect(html).toContain('Pass Priority');
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
    expect(html).not.toContain('Enter Battle');
    expect(html).toContain('End Turn');
  });

  it('retains ordinary enter-battle and pass controls for the priority holder', () => {
    const html = renderToStaticMarkup(createElement(PhaseBar));
    expect(html).toContain('Enter Battle');
    expect(html).toContain('Pass Priority');
  });
});
