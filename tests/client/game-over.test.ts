import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import GameScreen from '@client/components/GameScreen';
import { useGameStore } from '@client/store/gameStore';
import { createTestRoom } from '../helpers/client-view-fixture';

vi.mock('@client/socket', () => ({ default: { emit: vi.fn(), on: vi.fn(), off: vi.fn() } }));
// SSR normally reads Zustand's initial snapshot. Feed the current test room
// to the real components instead, without requiring a browser dependency.
vi.mock('@client/store/gameStore', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@client/store/gameStore')>();
  return { ...actual, useGameStore: Object.assign(
    (selector: (state: ReturnType<typeof actual.useGameStore.getState>) => unknown) => selector(actual.useGameStore.getState()),
    actual.useGameStore,
  ) };
});

describe('game over screen', () => {
  beforeEach(() => {
    useGameStore.setState({ lastSeq: 0, room: createTestRoom(), roomId: 'room', myPlayerId: 'player1', contextMenu: null, targeting: null });
  });

  it.each([['player1', 'You win'], ['player2', 'You lose']])('shows %s their result and preserves the final board', (playerId, message) => {
    const room = createTestRoom({ status: 'gameOver', outcome: {
      type: 'win', winnerId: 'player1', losses: [{ playerId: 'player2', reason: 'life_total' }],
    } });
    useGameStore.setState({ room, myPlayerId: playerId });
    const html = renderToStaticMarkup(createElement(GameScreen));
    expect(html).toContain(message);
    expect(html).toContain('life');
    expect(html).toContain('Your Hand');
    expect(html).toContain('Permanents');
    expect(html).not.toContain('End Turn');
    expect(html).not.toContain('Enter Battle');
    expect(html).not.toContain('Pass Priority');
  });

  it('shows a simultaneous-loss draw', () => {
    useGameStore.setState({ lastSeq: 0, room: createTestRoom({ status: 'gameOver', outcome: {
      type: 'draw', losses: [{ playerId: 'player1', reason: 'life_total' }, { playerId: 'player2', reason: 'life_total' }],
    } }) });
    expect(renderToStaticMarkup(createElement(GameScreen))).toContain('Draw');
  });
});
