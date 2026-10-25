import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createElement, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import CardComponent from '@client/components/CardComponent';
import ContextMenu from '@client/components/ContextMenu';
import PhaseBar from '@client/components/PhaseBar';
import { useGameStore } from '@client/store/gameStore';
import socket from '@client/socket';
import { createTestRoom } from '../helpers/test-room-factory';
import { instantiateCard } from '@library/card-factory';

vi.mock('@client/socket', () => ({ default: { emit: vi.fn(), on: vi.fn(), off: vi.fn() } }));
vi.mock('@client/store/gameStore', async importOriginal => {
  const actual = await importOriginal<typeof import('@client/store/gameStore')>();
  return { ...actual, useGameStore: Object.assign((selector: (state: ReturnType<typeof actual.useGameStore.getState>) => unknown) => selector(actual.useGameStore.getState()), actual.useGameStore) };
});
describe('basic play controls', () => {
  beforeEach(() => { vi.clearAllMocks(); useGameStore.setState({ room: createTestRoom(), roomId: 'room', myPlayerId: 'player1', contextMenu: null, targeting: null, log: [] }); });
  it('routes an effective Land click to direct play with the live revision', () => {
    const card = instantiateCard('land-red'); card.state.zone = 'hand'; card.state.zoneRevision = 4;
    useGameStore.getState().room!.players.player1.hand = [card];
    let tree!: ReactElement<any>;
    renderToStaticMarkup(createElement(() => { tree = CardComponent({ card, zone: 'hand' }); return null; }));
    tree.props.onClick({});
    expect(socket.emit).toHaveBeenCalledWith('playerAction', expect.objectContaining({ actionId: 'play_land', cardUuid: card.uuid, zoneRevision: 4 }));
    expect(useGameStore.getState().targeting).toBeNull();
  });
  it('shows the disabled option and reason rather than an empty menu', () => {
    useGameStore.setState({ contextMenu: { x: 0, y: 0, cardUuid: 'land', zone: 'hand', options: [{ actionId: 'play_land' as any, label: 'Play land', disabled: true, disabledReason: 'No land plays remaining this turn', description: '0 of 1 land plays remaining' }] } });
    const html = renderToStaticMarkup(createElement(ContextMenu));
    expect(html).toContain('Play land'); expect(html).toContain('disabled'); expect(html).toContain('No land plays remaining this turn');
  });
  it('keeps the options beside the clicked card after the server response', () => {
    const card = useGameStore.getState().room!.players.player1.hand[0]; let tree!: ReactElement<any>;
    renderToStaticMarkup(createElement(() => { tree = CardComponent({ card, zone: 'hand' }); return null; }));
    tree.props.onContextMenu({ preventDefault() {}, clientX: 280, clientY: 380 });
    useGameStore.getState().showContextMenu([]);
    expect(useGameStore.getState().contextMenu).toMatchObject({ x: 280, y: 380 });
  });
  it('reserves the summoning-sickness marker for battlefield creatures', () => {
    const card = instantiateCard('land-red'); card.state.summoningSickness = true;
    expect(renderToStaticMarkup(createElement(CardComponent, { card, zone: 'battlefield' }))).not.toContain('summoning-sick');
  });
  it('makes priority ownership visible on both views', () => {
    expect(renderToStaticMarkup(createElement(PhaseBar))).toContain('Play cards or continue toward combat');
    useGameStore.setState({ myPlayerId: 'player2' });
    expect(renderToStaticMarkup(createElement(PhaseBar))).toContain('Waiting for opponent');
  });
  it('summarizes battlefield and mana changes for the action trace', () => {
    const room = useGameStore.getState().room!; const card = instantiateCard('land-red');
    useGameStore.getState().applyDelta({ roomId: 'room', seq: 1, timestamp: 0, commandId: 'land-trace', action: 'play_land',
      changes: [{ op: 'update', path: 'battlefield', value: [card] }, { op: 'update', path: 'players.player1.mana', value: { ...room.players.player1.mana, red: 6 } }] });
    const summary = useGameStore.getState().log[0].summary;
    expect(summary).toContain(card.blueprint.name); expect(summary).toContain('red:6');
  });
});
