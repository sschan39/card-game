import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createElement, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import App from '@client/App';
import GameLog from '@client/components/GameLog';
import { useGameStore } from '@client/store/gameStore';
import { useGameActions } from '@client/hooks/useGameActions';
import socket from '@client/socket';
import { createTestRoom } from '../helpers/test-room-factory';
import { clientLogger } from '@rules/game-logger';
import { gameConfig } from '@config';

vi.mock('@client/socket', () => ({ default: { emit: vi.fn(), on: vi.fn(), off: vi.fn() } }));
vi.mock('@client/store/gameStore', async importOriginal => {
  const actual = await importOriginal<typeof import('@client/store/gameStore')>();
  return { ...actual, useGameStore: Object.assign((selector: (state: ReturnType<typeof actual.useGameStore.getState>) => unknown) => selector(actual.useGameStore.getState()), actual.useGameStore) };
});

describe('action feedback and tracing', () => {
  beforeEach(() => useGameStore.setState({ room: createTestRoom(), roomId: null, myPlayerId: 'player1', error: null, log: [], targeting: null }));
  afterEach(() => vi.restoreAllMocks());
  it.each([null, 'room'])('shows a dismissible rejection on screen %s without changing room data', roomId => {
    useGameStore.setState({ roomId, error: 'Not your priority!' });
    const before = useGameStore.getState().room;
    const html = renderToStaticMarkup(createElement(App));
    expect(html).toContain('role="alert"'); expect(html).toContain('Not your priority!'); expect(html).toContain('Dismiss');
    const tree = App() as ReactElement<{ children: ReactElement[] }>;
    const alert = tree.props.children.find(child => child?.props?.role === 'alert')!;
    const button = alert.props.children.find((child: ReactElement) => child?.type === 'button');
    button.props.onClick(); expect(useGameStore.getState().error).toBeNull(); expect(useGameStore.getState().room).toBe(before);
  });
  it('sends and logs one generated command ID through the existing hook', () => {
    useGameStore.setState({ roomId: 'room' });
    let actions!: ReturnType<typeof useGameActions>;
    const Harness = () => { actions = useGameActions(); return null; };
    renderToStaticMarkup(createElement(Harness));
    const logged = vi.spyOn(clientLogger, 'info');
    actions.playerAction('choose', undefined, undefined, { choiceId: 'q', choices: ['yes'] });
    const packet = vi.mocked(socket.emit).mock.calls.at(-1)![1];
    expect(packet.commandId).toEqual(expect.any(String));
    expect(logged).toHaveBeenCalledWith('action:sent', expect.any(String), expect.objectContaining({ commandId: packet.commandId, action: 'choose', choiceId: 'q' }));
    expect(packet).toMatchObject({ roomId: 'room', actionId: 'choose', choiceId: 'q', choices: ['yes'] });
  });
  it('logs chosen numbers and compact selection/payment totals', () => {
    useGameStore.setState({ roomId: 'room' }); let actions!: ReturnType<typeof useGameActions>;
    renderToStaticMarkup(createElement(() => { actions = useGameActions(); return null; }));
    const logged = vi.spyOn(clientLogger, 'info');
    actions.playerAction('choose', undefined, undefined, { choiceId: 'q', number: 0 });
    expect(logged).toHaveBeenLastCalledWith('action:sent', expect.any(String), expect.objectContaining({ choiceId: 'q', number: 0 }));
    actions.playerAction('choose', undefined, undefined, { choiceId: 'q2', choices: ['a'], allocations: { red: 2, blue: 1, green: 0 } });
    expect(logged).toHaveBeenLastCalledWith('action:sent', expect.any(String), expect.objectContaining({ selected: 1, allocationTotal: 3,
      allocationChoices: [{ id: 'red', amount: 2 }, { id: 'blue', amount: 1 }] }));
  });
  it('retains the delta ID and explains opening a choice in the recent action view', () => {
    const choice = { id: 'q1', playerId: 'player1', kind: 'number', prompt: 'Choose X', range: { min: 0, max: 4 },
      continuation: { type: 'action', actionId: 'cast_spell', data: {}, field: 'numericBindings', bindingName: 'X' } };
    useGameStore.getState().applyDelta({ roomId: 'room', seq: 3, timestamp: 0, commandId: 'trace-3', action: 'cast_spell', playerId: 'player1',
      changes: [{ op: 'add', path: 'pendingChoice', value: choice }] });
    expect(useGameStore.getState().log[0]).toMatchObject({ commandId: 'trace-3', summary: expect.stringContaining('Choose X') });
    const html = renderToStaticMarkup(createElement(GameLog)); expect(html).toContain('Choose X'); expect(html).toContain('trace-3');
  });
  it('uses readable phase names in the recent action view', () => {
    useGameStore.getState().applyDelta({ roomId: 'room', seq: 4, timestamp: 0, changes: [{ op: 'update', path: 'phase', value: 'stateDrawPhase' }] });
    expect(renderToStaticMarkup(createElement(GameLog))).toContain('Draw Step');
  });
  it('logs local targeting cancellation without sending a command', () => {
    const info = vi.spyOn(clientLogger, 'info'); const before = vi.mocked(socket.emit).mock.calls.length;
    useGameStore.getState().beginTargeting({ cardUuid: 'c', zone: 'hand', actionId: 'cast_spell', targeting: { type: 'player', required: true }, collected: [] });
    useGameStore.getState().cancelTargeting();
    expect(info).toHaveBeenCalledWith('targeting:cancelled', expect.any(String), expect.objectContaining({ cardUuid: 'c' }));
    expect(vi.mocked(socket.emit).mock.calls).toHaveLength(before);
  });
  it('can silence normal action diagnostics centrally', () => {
    const original = (gameConfig.logging as any).actions; (gameConfig.logging as any).actions = false;
    try {
      const info = vi.spyOn(clientLogger, 'info');
      useGameStore.getState().cancelTargeting();
      useGameStore.getState().applyDelta({ roomId: 'room', seq: 1, timestamp: 0, changes: [] });
      expect(info).not.toHaveBeenCalled();
    } finally { (gameConfig.logging as any).actions = original; }
  });
});
