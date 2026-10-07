import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createElement, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ContextMenu from '../../src/client/components/ContextMenu';
import CardComponent from '../../src/client/components/CardComponent';
import { useGameStore } from '../../src/client/store/gameStore';
import { createTestRoom } from '../helpers/test-room-factory';

const actions = vi.hoisted(() => ({ playerAction: vi.fn(), getOptions: vi.fn() }));
vi.mock('../../src/client/hooks/useGameActions', () => ({ useGameActions: () => actions }));
vi.mock('../../src/client/socket', () => ({ default: { emit: vi.fn(), on: vi.fn(), off: vi.fn() } }));
vi.mock('../../src/client/store/gameStore', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/client/store/gameStore')>();
  return { ...actual, useGameStore: Object.assign(
    (selector: (state: ReturnType<typeof actual.useGameStore.getState>) => unknown) => selector(actual.useGameStore.getState()), actual.useGameStore,
  ) };
});

describe('mana client options', () => {
  beforeEach(() => {
    actions.playerAction.mockClear();
    useGameStore.setState({ room: createTestRoom(), roomId: 'room', myPlayerId: 'player1', targeting: null, contextMenu: null });
  });
  it('forwards the selected ability and mana color through the real context-menu callback', () => {
    const data = { abilityIndex: 2, manaColor: 'blue' as const };
    useGameStore.setState({ contextMenu: { x: 0, y: 0, cardUuid: 'source', zone: 'battlefield', options: [
      { actionId: 'tapForMana', label: 'Activate for blue mana', data },
    ] } });
    const element = ContextMenu() as ReactElement<{ children: ReactElement<{ children: ReactElement<{ onClick: () => void }>[] }> }>;
    element.props.children.props.children[0].props.onClick();
    expect(actions.playerAction).toHaveBeenCalledWith('tapForMana', 'source', undefined, data);
    expect(useGameStore.getState().contextMenu).toBeNull();
  });
  it('renders generic numbers separately from explicit colorless symbols', () => {
    const card = useGameStore.getState().room!.players.player1.hand[0];
    card.blueprint = { ...card.blueprint, castRequirements: { ...card.blueprint.castRequirements, cost: { mana: { generic: 2, colorless: 1, red: 1 } } } };
    const html = renderToStaticMarkup(createElement(CardComponent, { card, zone: 'hand' }));
    expect(html).toContain('{2}{R}{C}');
  });
});
