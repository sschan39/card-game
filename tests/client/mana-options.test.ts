import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createElement, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ContextMenu from '../../src/client/components/ContextMenu';
import CardComponent from '../../src/client/components/CardComponent';
import TargetSelector from '../../src/client/components/TargetSelector';
import { createTargetingState } from '../../src/client/targeting';
import { useGameStore } from '../../src/client/store/gameStore';
import { createTestRoom } from '../helpers/test-room-factory';
import StackDisplay from '../../src/client/components/StackDisplay';
import { instantiateCard } from '../../src/library/card-factory';

const actions = vi.hoisted(() => ({ playerAction: vi.fn(), getOptions: vi.fn() }));
vi.mock('../../src/client/hooks/useGameActions', () => ({ useGameActions: () => actions }));
vi.mock('../../src/client/socket', () => ({ default: { emit: vi.fn(), on: vi.fn(), off: vi.fn() } }));
vi.mock('zustand/react/shallow', () => ({ useShallow: (selector: unknown) => selector }));
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
  it('forwards the chosen Hellkite ability through the real menu callback', () => {
    useGameStore.setState({ contextMenu: { x: 0, y: 0, cardUuid: 'hellkite', zone: 'battlefield', options: [
      { actionId: 'activate_ability', label: 'Activate: firebreathing', data: { abilityId: 'firebreathing' } },
    ] } });
    const element = ContextMenu() as ReactElement<{ children: ReactElement<{ children: ReactElement<{ onClick: () => void }>[] }> }>;
    element.props.children.props.children[0].props.onClick();
    expect(actions.playerAction).toHaveBeenCalledWith('activate_ability', 'hellkite', undefined, { abilityId: 'firebreathing' });
  });
  it('collects separate target groups before sending a single action', () => {
    const card = useGameStore.getState().room!.players.player1.hand[0];
    card.blueprint = { ...card.blueprint, onCastEffects: [
      { targetGroup: 'creature', action: 'TAP', params: {}, targeting: { type: 'permanent', required: true, maxTargets: 1 } },
      { targetGroup: 'player', action: 'MODIFY_LIFE', params: { amount: -1 }, targeting: { type: 'player', required: true, maxTargets: 1 } },
    ] };
    useGameStore.getState().beginTargeting(createTargetingState(card, 'hand', 'cast_spell')!);
    useGameStore.getState().addTarget({ targetType: 'permanent', cardUuid: 'creature' });
    const clickConfirm = () => {
      const element = TargetSelector() as ReactElement<{ children: ReactElement<{ children: ReactElement<{ onClick: () => void }>[] }>[] }>;
      element.props.children[1].props.children[1].props.onClick();
    };
    clickConfirm();
    expect(actions.playerAction).not.toHaveBeenCalled();
    expect(useGameStore.getState().targeting?.targeting.type).toBe('player');
    useGameStore.getState().addTarget({ targetType: 'player', playerId: 'player2' });
    clickConfirm();
    expect(actions.playerAction).toHaveBeenCalledWith('cast_spell', card.uuid, undefined, { targetGroups: [
      { id: 'creature', targets: [{ targetType: 'permanent', cardUuid: 'creature' }] },
      { id: 'player', targets: [{ targetType: 'player', playerId: 'player2' }] },
    ] });
    expect(useGameStore.getState().targeting).toBeNull();
  });
  it('selects and removes distinct stack objects independently', () => {
    useGameStore.getState().beginTargeting({ cardUuid: 'counter', zone: 'hand', actionId: 'cast_spell', targeting: { type: 'stack', required: true, maxTargets: 2 }, collected: [] });
    useGameStore.getState().toggleTarget({ targetType: 'stack', stackUuid: 'first' });
    useGameStore.getState().toggleTarget({ targetType: 'stack', stackUuid: 'second' });
    expect(useGameStore.getState().targeting?.collected.map(t => t.stackUuid)).toEqual(['first', 'second']);
    useGameStore.getState().removeTarget({ targetType: 'stack', stackUuid: 'first' });
    expect(useGameStore.getState().targeting?.collected.map(t => t.stackUuid)).toEqual(['second']);
  });
  it('lets the server ask for modes before beginning local targeting', () => {
    const card = useGameStore.getState().room!.players.player1.hand[0];
    card.blueprint = { ...card.blueprint, modes: [{ id: 'mode', label: 'Mode', effects: [] }], onCastEffects: [
      { action: 'TAP', params: {}, targeting: { type: 'permanent', required: true } },
    ] };
    expect(createTargetingState(card, 'hand', 'cast_spell')).toBeNull();
  });
  it('selects a counterspell target through the actual stack callback and submits it', () => {
    const room = useGameStore.getState().room!; const counter = instantiateCard('counterspell-fixture'), source = instantiateCard('broken-fireball');
    room.players.player1.hand = [counter];
    room.stack = [{ uuid: 'selected-spell', type: 'spell', source, controllerId: 'player2', effects: [], countered: false }];
    useGameStore.getState().beginTargeting(createTargetingState(counter, 'hand', 'cast_spell')!);
    const stack = StackDisplay() as ReactElement<{ children: ReactElement[] }>;
    const list = stack.props.children[1] as ReactElement<{ children: ReactElement<{ onClick: () => void }>[] }>;
    list.props.children[0].props.onClick();
    expect(useGameStore.getState().targeting?.collected).toEqual([{ targetType: 'spell', stackUuid: 'selected-spell' }]);
    const selector = TargetSelector() as ReactElement<{ children: ReactElement<{ children: ReactElement<{ onClick: () => void }>[] }>[] }>;
    selector.props.children[1].props.children[1].props.onClick();
    expect(actions.playerAction).toHaveBeenCalledWith('cast_spell', counter.uuid, undefined, { targetGroups: [{ id: 'effect-0', targets: [{ targetType: 'spell', stackUuid: 'selected-spell' }] }] });
  });
});
