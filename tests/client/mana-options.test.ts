import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createElement, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ContextMenu from '@client/components/ContextMenu';
import CardComponent from '@client/components/CardComponent';
import PlayerInfo from '@client/components/PlayerInfo';
import OpponentInfo from '@client/components/OpponentInfo';
import TargetSelector from '@client/components/TargetSelector';
import { createTargetingState } from '@client/targeting';
import { useGameStore } from '@client/store/gameStore';
import { createTestRoom } from '../helpers/client-view-fixture';
import StackDisplay from '@client/components/StackDisplay';
import { instantiateCard } from '../helpers/client-view-fixture';

const actions = vi.hoisted(() => ({ playerAction: vi.fn(), getOptions: vi.fn() }));
vi.mock('@client/hooks/useGameActions', () => ({ useGameActions: () => actions }));
vi.mock('@client/socket', () => ({ default: { emit: vi.fn(), on: vi.fn(), off: vi.fn() } }));
vi.mock('zustand/react/shallow', () => ({ useShallow: (selector: unknown) => selector }));
vi.mock('@client/store/gameStore', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@client/store/gameStore')>();
  return { ...actual, useGameStore: Object.assign(
    (selector: (state: ReturnType<typeof actual.useGameStore.getState>) => unknown) => selector(actual.useGameStore.getState()), actual.useGameStore,
  ) };
});

describe('mana client options', () => {
  it('highlights and selects a creature or either player through one any-target group', () => {
    const room = useGameStore.getState().room!; const source = room.players.player1.hand[0];
    const creature = instantiateCard('empire-servant'), land = instantiateCard('land-red');
    for (const card of [creature, land]) card.state = { ...card.state, zone: 'battlefield', ownerId: 'player2', controllerId: 'player2' };
    room.battlefield = [creature, land];
    const begin = () => useGameStore.getState().beginTargeting({ cardUuid: source.uuid, zone: 'hand', actionId: 'cast_spell', groups: [{ id: 'any', targeting: { type: 'any', required: true, maxTargets: 1 }, legalTargets: [{ targetType: 'permanent', cardUuid: creature.uuid }, { targetType: 'player', playerId: 'player1' }, { targetType: 'player', playerId: 'player2' }] }], targeting: { type: 'any', required: true, maxTargets: 1 }, collected: [] });
    begin();
    expect(renderToStaticMarkup(createElement(CardComponent, { card: creature, zone: 'battlefield' }))).toContain('targetable');
    expect(renderToStaticMarkup(createElement(CardComponent, { card: land, zone: 'battlefield' }))).not.toContain('targetable');
    (CardComponent({ card: creature, zone: 'battlefield' }) as ReactElement<{ onClick: (event: unknown) => void }>).props.onClick({});
    expect(useGameStore.getState().targeting?.collected).toEqual([{ targetType: 'permanent', cardUuid: creature.uuid }]);
    begin(); const self = PlayerInfo() as ReactElement<{ onClick: () => void; className: string }>;
    expect(self.props.className).toContain('targetable'); self.props.onClick();
    expect(useGameStore.getState().targeting?.collected).toEqual([{ targetType: 'player', playerId: 'player1' }]);
    begin(); const enemy = OpponentInfo() as ReactElement<{ onClick: () => void; className: string }>;
    expect(enemy.props.className).toContain('targetable'); enemy.props.onClick();
    expect(useGameStore.getState().targeting?.collected).toEqual([{ targetType: 'player', playerId: 'player2' }]);
  });
  beforeEach(() => {
    actions.playerAction.mockClear();
    useGameStore.setState({ lastSeq: 0, room: createTestRoom(), roomId: 'room', myPlayerId: 'player1', targeting: null, contextMenu: null });
  });
  it('forwards the selected ability and mana color through the real context-menu callback', () => {
    const data = { abilityIndex: 2, manaColor: 'blue' as const };
    useGameStore.setState({ contextMenu: { x: 0, y: 0, cardUuid: 'source', zone: 'battlefield', options: [
      { actionId: 'tapForMana', label: 'Activate for blue mana', data },
    ] } });
    const element = ContextMenu() as ReactElement<{ children: ReactElement<{ children: ReactElement<{ onClick: () => void }>[] }> }>;
    element.props.children.props.children.flat().find((child: ReactElement) => child?.type === 'button').props.onClick();
    expect(actions.playerAction).toHaveBeenCalledWith('tapForMana', 'source', undefined, data);
    expect(useGameStore.getState().contextMenu).toBeNull();
  });
  it('renders generic numbers separately from explicit yellow symbols', () => {
    const card = useGameStore.getState().room!.players.player1.hand[0];
    card.manaCost = '{2}{R}{Y}';
    const html = renderToStaticMarkup(createElement(CardComponent, { card, zone: 'hand' }));
    expect(html).toContain('{2}{R}{Y}');
  });
  it('forwards the chosen Hellkite ability through the real menu callback', () => {
    useGameStore.setState({ contextMenu: { x: 0, y: 0, cardUuid: 'hellkite', zone: 'battlefield', options: [
      { actionId: 'activate_ability', label: 'Activate: firebreathing', data: { abilityId: 'firebreathing' } },
    ] } });
    const element = ContextMenu() as ReactElement<{ children: ReactElement<{ children: ReactElement<{ onClick: () => void }>[] }> }>;
    element.props.children.props.children.flat().find((child: ReactElement) => child?.type === 'button').props.onClick();
    expect(actions.playerAction).toHaveBeenCalledWith('activate_ability', 'hellkite', undefined, { abilityId: 'firebreathing' });
  });
  it('collects separate target groups before sending a single action', () => {
    const card = useGameStore.getState().room!.players.player1.hand[0];
    card.targetGroups.cast_spell = [
      { id: 'creature', targeting: { type: 'permanent', required: true, maxTargets: 1 }, legalTargets: [{ targetType: 'permanent', cardUuid: 'creature' }] },
      { id: 'player', targeting: { type: 'player', required: true, maxTargets: 1 }, legalTargets: [{ targetType: 'player', playerId: 'player2' }] },
    ];
    useGameStore.getState().beginTargeting(createTargetingState(card, 'hand', 'cast_spell')!);
    useGameStore.getState().addTarget({ targetType: 'permanent', cardUuid: 'creature' });
    const clickConfirm = () => {
      const element = TargetSelector() as ReactElement<{ children: ReactElement<{ children: ReactElement<{ onClick: () => void }>[] }>[] }>;
      element.props.children.find((child: ReactElement) => child?.props?.className === 'targeting-banner-actions').props.children[1].props.onClick();
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
    useGameStore.getState().beginTargeting({ cardUuid: 'counter', zone: 'hand', actionId: 'cast_spell', groups: [{ id: 'stack', targeting: { type: 'stack', required: true, maxTargets: 2 }, legalTargets: ['first', 'second'].map(stackUuid => ({ targetType: 'stack' as const, stackUuid })) }], targeting: { type: 'stack', required: true, maxTargets: 2 }, collected: [] });
    useGameStore.getState().toggleTarget({ targetType: 'stack', stackUuid: 'first' });
    useGameStore.getState().toggleTarget({ targetType: 'stack', stackUuid: 'second' });
    expect(useGameStore.getState().targeting?.collected.map(t => t.stackUuid)).toEqual(['first', 'second']);
    useGameStore.getState().removeTarget({ targetType: 'stack', stackUuid: 'first' });
    expect(useGameStore.getState().targeting?.collected.map(t => t.stackUuid)).toEqual(['second']);
  });
  it('lets the server ask for modes before beginning local targeting', () => {
    const card = useGameStore.getState().room!.players.player1.hand[0];
    card.targetGroups = {}; // Server announcement choices precede local targeting.
    expect(createTargetingState(card, 'hand', 'cast_spell')).toBeNull();
  });
  it('selects a counterspell target through the actual stack callback and submits it', () => {
    const room = useGameStore.getState().room!; const counter = instantiateCard('counterspell-fixture'), source = instantiateCard('broken-fireball');
    room.players.player1.hand = [counter];
    room.stack = [{ uuid: 'selected-spell', type: 'spell', source, controllerId: 'player2', effects: [], countered: false }];
    counter.targetGroups.cast_spell = [{ id: 'effect-0', targeting: { type: 'spell', required: true, maxTargets: 1 }, legalTargets: [{ targetType: 'spell', stackUuid: 'selected-spell' }] }];
    useGameStore.getState().beginTargeting(createTargetingState(counter, 'hand', 'cast_spell')!);
    const stack = StackDisplay() as ReactElement<{ children: ReactElement[] }>;
    const list = stack.props.children[1] as ReactElement<{ children: ReactElement<{ onClick: () => void }>[] }>;
    list.props.children[0].props.onClick();
    expect(useGameStore.getState().targeting?.collected).toEqual([{ targetType: 'spell', stackUuid: 'selected-spell' }]);
    const selector = TargetSelector() as ReactElement<{ children: ReactElement<{ children: ReactElement<{ onClick: () => void }>[] }>[] }>;
    selector.props.children.find((child: ReactElement) => child?.props?.className === 'targeting-banner-actions').props.children[1].props.onClick();
    expect(actions.playerAction).toHaveBeenCalledWith('cast_spell', counter.uuid, undefined, { targetGroups: [{ id: 'effect-0', targets: [{ targetType: 'spell', stackUuid: 'selected-spell' }] }] });
  });
});
