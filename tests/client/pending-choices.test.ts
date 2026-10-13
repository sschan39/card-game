import { describe, expect, it, vi } from 'vitest';
import { createElement, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ChoicePanel, { ChoiceForm } from '../../src/client/components/ChoicePanel';
import CardComponent from '../../src/client/components/CardComponent';
import { useGameStore, selectHasPriority } from '../../src/client/store/gameStore';
import { createTestRoom } from '../helpers/test-room-factory';
import type { PendingChoice } from '../../src/types/choice.types';
import ContextMenu from '../../src/client/components/ContextMenu';
import TargetSelector from '../../src/client/components/TargetSelector';
import socket from '../../src/client/socket';

vi.mock('../../src/client/socket', () => ({ default: { emit: vi.fn(), on: vi.fn(), off: vi.fn() } }));
vi.mock('../../src/client/store/gameStore', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/client/store/gameStore')>();
  return { ...actual, useGameStore: Object.assign((selector: (state: ReturnType<typeof actual.useGameStore.getState>) => unknown) => selector(actual.useGameStore.getState()), actual.useGameStore) };
});
const choice: PendingChoice = { id: 'request', playerId: 'player1', kind: 'optional', prompt: 'Gain life?', min: 1, max: 1,
  options: [{ id: 'yes', label: 'Yes', value: true }, { id: 'no', label: 'No', value: false }],
  continuation: { type: 'action', actionId: 'cast_spell', data: {}, field: 'modes' } };

describe('pending choice controls', () => {
  it('shows the declared range without needing to inspect input attributes', () => {
    const numeric = { id: 'range', playerId: 'player1', kind: 'number' as const, prompt: 'Choose X', range: { min: 0, max: 4 },
      continuation: { type: 'action' as const, actionId: 'cast_spell', data: {}, field: 'numericBindings' as const, bindingName: 'X' } };
    expect(renderToStaticMarkup(createElement(ChoiceForm, { choice: numeric, selected: [], allocations: {}, onSelection: vi.fn(), onAllocation: vi.fn(), onAnswer: vi.fn() }))).toContain('0–4');
  });
  it('carries explicit payment from the existing spell option into local targeting', () => {
    const room = createTestRoom(); const card = room.players.player1.hand[0];
    card.blueprint = { ...card.blueprint, onCastEffects: [{ action: 'MODIFY_LIFE', params: { amount: -1 }, tags: [], targeting: { type: 'player', controller: 'opponent', required: true } }] };
    useGameStore.setState({ room, roomId: 'room', myPlayerId: 'player1', targeting: null, contextMenu: { x: 0, y: 0, cardUuid: card.uuid, zone: 'hand', options: [{ actionId: 'cast_spell', label: 'Cast spell' }] } });
    let tree!: ReactElement<any>;
    renderToStaticMarkup(createElement(() => { tree = ContextMenu()!; return null; }));
    const menu = tree.props.children;
    const input = menu.props.children.flat?.().find((child: ReactElement) => child?.type === 'label')?.props.children.find((child: ReactElement) => child?.type === 'input');
    expect(input).toBeDefined(); input.props.onChange({ target: { checked: true } });
    renderToStaticMarkup(createElement(() => { tree = ContextMenu()!; return null; }));
    const button = tree.props.children.props.children.flat().find((child: ReactElement) => child?.type === 'button');
    button.props.onClick(); expect(useGameStore.getState().targeting?.data?.choosePayment).toBe(true);
    useGameStore.getState().toggleTarget({ targetType: 'player', playerId: 'player2' });
    renderToStaticMarkup(createElement(() => { tree = TargetSelector()!; return null; }));
    const actions = tree.props.children.find((child: ReactElement) => child?.props?.className === 'targeting-banner-actions');
    actions.props.children.find((child: ReactElement) => child?.type === 'button' && child.props.children === 'Confirm').props.onClick();
    expect(socket.emit).toHaveBeenCalledWith('playerAction', expect.objectContaining({ choosePayment: true }));
  });
  it('renders payment routes through the existing list form and submits the selected ID', () => {
    const routes = { ...choice, kind: 'options' as const, prompt: 'Choose how to pay', options: [
      { id: 'base', label: 'Pay base cost', value: { kind: 'base' } },
      { id: 'alternative:life', label: 'Pay two life', value: { kind: 'alternative', id: 'life' } },
    ], continuation: { type: 'action' as const, actionId: 'cast_spell', data: {}, field: 'costRoute' as const } };
    const onAnswer = vi.fn(); const props = { choice: routes, selected: ['alternative:life'], allocations: {}, onSelection: vi.fn(), onAllocation: vi.fn(), onAnswer };
    const html = renderToStaticMarkup(createElement(ChoiceForm, props)); expect(html).toContain('Pay two life'); expect(html).toContain('Pay base cost');
    const element = ChoiceForm(props) as ReactElement<{ children: ReactElement[] }>;
    const confirm = element.props.children.find(child => child?.props?.['data-action'] === 'confirm') as ReactElement<{ onClick: () => void }>;
    confirm.props.onClick(); expect(onAnswer).toHaveBeenCalledWith({ choiceId: 'request', choices: ['alternative:life'] });
  });
  it('labels authored generic mana without displaying an expression object', () => {
    const room = createTestRoom(); const card = room.players.player1.hand[0];
    card.blueprint = { ...card.blueprint, numericDeclarations: [{ name: 'X', min: 0 }], castRequirements: { allowedZones: ['hand'], speed: 'instant',
      cost: { mana: { generic: { numeric: { kind: 'binding', name: 'X' } } } } } };
    useGameStore.setState({ room, myPlayerId: 'player1' });
    const html = renderToStaticMarkup(createElement(CardComponent, { card, zone: 'hand' }));
    expect(html).toContain('{X}'); expect(html).not.toContain('[object Object]');
  });
  it('renders an announced number, keeps blank distinct from zero and submits a scalar', () => {
    const numeric = { id: 'number-request', playerId: 'player1', kind: 'number' as const, prompt: 'Choose X', range: { min: 0, max: 5 },
      continuation: { type: 'action' as const, actionId: 'cast_spell', data: {}, field: 'numericBindings' as const, bindingName: 'X' } };
    const onAnswer = vi.fn();
    const props = { choice: numeric, selected: [], allocations: {}, onSelection: vi.fn(), onAllocation: vi.fn(), onAnswer, numberText: '' };
    expect(renderToStaticMarkup(createElement(ChoiceForm, props))).toContain('disabled');
    const zero = { ...props, numberText: '0' };
    const html = renderToStaticMarkup(createElement(ChoiceForm, zero));
    expect(html).toContain('type="number"'); expect(html).not.toContain('disabled');
    const element = ChoiceForm(zero) as ReactElement<{ children: ReactElement[] }>;
    const confirm = element.props.children.find(child => child?.props?.['data-action'] === 'confirm') as ReactElement<{ onClick: () => void }>;
    confirm.props.onClick(); expect(onAnswer).toHaveBeenCalledWith({ choiceId: 'number-request', number: 0 });
    for (const numberText of ['1.5', '6', '-1']) expect(renderToStaticMarkup(createElement(ChoiceForm, { ...props, numberText }))).toContain('disabled');
  });
  it('numbers an ordered subset and submits its top-to-bottom sequence', () => {
    const ordered = { ...choice, kind: 'ordering' as const, prompt: 'Choose 2 cards in top-to-bottom order', min: 2, max: 2,
      options: ['a', 'b', 'c'].map(id => ({ id, label: `Card ${id}`, value: { targetType: 'card', cardUuid: id, zone: 'library', zoneRevision: 0 } })) };
    const onAnswer = vi.fn();
    const props = { choice: ordered, selected: ['c', 'a'], allocations: {}, onSelection: vi.fn(), onAllocation: vi.fn(), onAnswer };
    const html = renderToStaticMarkup(createElement(ChoiceForm, props));
    expect(html).toContain(ordered.prompt); expect(html).toContain('Select items in the desired order');
    expect(html).toContain('2. Card a'); expect(html).toContain('1. Card c'); expect(html).not.toContain('disabled');
    const element = ChoiceForm(props) as ReactElement<{ children: ReactElement[] }>;
    const confirm = element.props.children.find(child => child?.props?.['data-action'] === 'confirm') as ReactElement<{ onClick: () => void }>;
    confirm.props.onClick(); expect(onAnswer).toHaveBeenCalledWith({ choiceId: 'request', choices: ['c', 'a'] });
  });
  it('restores the owner prompt from a snapshot and shows only waiting status to the opponent', () => {
    const room = JSON.parse(JSON.stringify({ ...createTestRoom(), pendingChoice: choice }));
    useGameStore.setState({ room, roomId: 'room', myPlayerId: 'player1' });
    const html = renderToStaticMarkup(createElement(ChoicePanel));
    expect(html).toContain('Gain life?'); expect(html).toContain('Yes'); expect(html).toContain('Cancel');
    expect(selectHasPriority(useGameStore.getState())).toBe(false);
    useGameStore.setState({ myPlayerId: 'player2' });
    const opponent = renderToStaticMarkup(createElement(ChoicePanel));
    expect(opponent).toContain('Waiting for'); expect(opponent).not.toContain('Gain life?'); expect(opponent).not.toContain('button');
  });
  it('submits selected IDs with the current request ID', () => {
    const onAnswer = vi.fn();
    const element = ChoiceForm({ choice, selected: ['yes'], allocations: {}, onSelection: vi.fn(), onAllocation: vi.fn(), onAnswer }) as ReactElement<{ children: ReactElement[] }>;
    const confirm = element.props.children.find(child => child?.props?.['data-action'] === 'confirm') as ReactElement<{ onClick: () => void }>;
    confirm.props.onClick(); expect(onAnswer).toHaveBeenCalledWith({ choiceId: 'request', choices: ['yes'] });
  });
  it('submits exact allocations and disables incorrect totals', () => {
    const distribution = { ...choice, kind: 'distribution' as const, total: 3, min: 0, max: 2 };
    const onAnswer = vi.fn();
    const props = { choice: distribution, selected: [], allocations: { yes: 1, no: 2 }, onSelection: vi.fn(), onAllocation: vi.fn(), onAnswer };
    const element = ChoiceForm(props) as ReactElement<{ children: ReactElement[] }>;
    const confirm = element.props.children.find(child => child?.props?.['data-action'] === 'confirm') as ReactElement<{ onClick: () => void; disabled: boolean }>;
    expect(confirm.props.disabled).toBe(false); confirm.props.onClick();
    expect(onAnswer).toHaveBeenCalledWith({ choiceId: 'request', allocations: { yes: 1, no: 2 } });
    expect(renderToStaticMarkup(createElement(ChoiceForm, { ...props, allocations: { yes: 1, no: 1 } }))).toContain('disabled');
  });
});
