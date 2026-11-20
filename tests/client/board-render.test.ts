import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { CardView, PlayerView } from '@card-game/protocol';
import Battlefield from '@client/components/Battlefield';
import PermanentHalf from '@client/components/board/PermanentHalf';
import { CardPreview } from '@client/components/board/CardPreview';
import { PermanentStatus } from '@client/components/board/PermanentStatus';
import { useGameStore } from '@client/store/gameStore';
import type { TargetingState } from '@client/store/gameStore';
import { createTestRoom, instantiateCard } from '../helpers/client-view-fixture';

vi.mock('@client/socket', () => ({ default: { emit: vi.fn(), on: vi.fn(), off: vi.fn() } }));
vi.mock('@client/store/gameStore', async importOriginal => {
  const actual = await importOriginal<typeof import('@client/store/gameStore')>();
  return {
    ...actual,
    useGameStore: Object.assign(
      (selector: (state: ReturnType<typeof actual.useGameStore.getState>) => unknown) =>
        selector(actual.useGameStore.getState()),
      actual.useGameStore,
    ),
  };
});

function permanent(uuid: string, overrides: Partial<CardView> = {}): CardView {
  const card = instantiateCard('land-red');
  const name = overrides.name ?? 'Forest';
  return {
    ...card,
    uuid,
    name,
    label: name,
    cardTypes: overrides.cardTypes ?? ['Land'],
    ...overrides,
    state: { ...card.state, zone: 'battlefield', ...overrides.state },
  } as CardView;
}

function renderBattlefield(cards: CardView[], room: Partial<PlayerView> = {}, targeting: TargetingState | null = null) {
  useGameStore.setState({
    lastSeq: 0,
    room: { ...createTestRoom(), battlefield: cards, ...room },
    roomId: 'room',
    myPlayerId: 'player1',
    contextMenu: null,
    targeting,
    log: [],
  });
  return renderToStaticMarkup(createElement(Battlefield));
}

describe('battlefield board', () => {
  beforeEach(() => vi.clearAllMocks());

  it('shows Scorch from a snapshot and removes the overlay when its counters are cleared', () => {
    const card = permanent('scorched');
    card.state.counters.scorch = 2;
    expect(renderBattlefield([card])).toContain('aria-label="Scorch 2"');
    expect(renderToStaticMarkup(createElement(PermanentStatus, { badges: [] }))).toBe('');
  });


  it('orders several counters and labels a granted keyword through its duration', () => {
    const card = permanent('effect', {
      effects: [{ kind: 'keyword', keyword: 'Flying', duration: 'combat', sourceName: 'Wind' }],
    });
    card.state.counters = { frost: 1, charge: 2, scorch: 3 };
    const html = renderBattlefield([card]);
    expect(html).toContain('aria-label="Scorch 3, charge 2, frost 1, Flying · Until end of combat · Wind"');
  });

  it('groups an attachment from a legacy snapshot with its original host', () => {
    const host = permanent('original');
    delete host.state.zoneRevision;
    const attached = permanent('attachment', { name: 'Old equipment', cardTypes: ['Artifact'] });
    attached.state.attachedTo = host.uuid;
    const html = renderBattlefield([host, attached]);
    expect(html).toContain('Attached Old equipment');
    expect(html.match(/data-board-anchor="battlefield:attachment:0"/g)).toHaveLength(1);
  });

  it('renders both halves of the felt', () => {
    const html = renderBattlefield([]);
    expect(html).toContain('board-half-opponent');
    expect(html).toContain('board-half-you');
  });

  it('says a half is empty rather than rendering a blank box', () => {
    const html = renderBattlefield([]);
    expect(html).toContain('Permanents');
    expect(html).toContain('empty');
  });

  it('groups permanents into labelled bands', () => {
    const html = renderBattlefield([
      permanent('c1', { cardTypes: ['Creature'], name: 'Bear' }),
      permanent('l1', { cardTypes: ['Land'], name: 'Forest' }),
    ]);
    expect(html).toContain('permanent-band-creature');
    expect(html).toContain('permanent-band-land');
    expect(html).toContain('Creatures');
    expect(html).toContain('Lands');
    expect(html).toMatch(/permanent-lands"><section class="permanent-band permanent-band-land"/);
    expect(html).toMatch(/permanent-front"><section class="permanent-band permanent-band-creature"/);
  });

  it('mirrors support rows around the center with creatures on the inside', () => {
    const cards = ['player1', 'player2'].flatMap(controllerId => ['Creature', 'Artifact'].map(type => {
      const card = permanent(`${controllerId}-${type}`, { cardTypes: [type] });
      card.state.controllerId = controllerId;
      return card;
    }));
    const html = renderBattlefield(cards);
    const anchors = [...html.matchAll(/data-board-anchor="([^"]+)"/g)].map(([, anchor]) => anchor);
    expect(anchors).toEqual([
      'battlefield:player2-Artifact:0', 'battlefield:player2-Creature:0',
      'battlefield:player1-Creature:0', 'battlefield:player1-Artifact:0',
    ]);
  });

  it('renders one slot per permanent', () => {
    const html = renderBattlefield([
      permanent('c1', { cardTypes: ['Creature'], name: 'Bear' }),
      permanent('c2', { cardTypes: ['Creature'], name: 'Wolf' }),
    ]);
    expect(html.match(/permanent-slot/g)).toHaveLength(2);
  });

  it('overlaps matching lands into one slot and separates a tapped copy', () => {
    const lands = Array.from({ length: 8 }, (_, index) => permanent(`land-${index}`));
    const stacked = renderBattlefield(lands);
    expect(stacked.match(/permanent-slot/g)).toHaveLength(1);
    expect(stacked.match(/permanent-stack-layer/g)).toHaveLength(2);
    expect(stacked.match(/class="card(?: |")/g)).toHaveLength(1);
    expect(stacked).toContain('×8');
    expect(stacked).not.toContain('board-half-many-lands');

    lands[0].state.isTapped = true;
    lands[1].state.isTapped = true;
    const split = renderBattlefield(lands);
    expect(split.match(/permanent-slot/g)).toHaveLength(2);
    expect(split).toContain('×6');
    expect(split).toContain('×2');
    expect(split).toContain('data-board-token-members="battlefield:land-1:0"');
  });

  it('stacks printed creatures, artifacts and enchantments in their own bands', () => {
    const types = ['Creature', 'Artifact', 'Enchantment'];
    const html = renderBattlefield(types.flatMap(type => ['a', 'b'].map(copy =>
      permanent(`${type}-${copy}`, { name: type, cardTypes: [type] }))));
    expect(html.match(/2 identical permanents, open stack picker/g)).toHaveLength(3);
  });

  it('keeps Equipment grouped by host and highlights a stack containing a legal target', () => {
    const first = permanent('first-host', { name: 'First host', cardTypes: ['Creature'] });
    const second = permanent('second-host', { name: 'Second host', cardTypes: ['Creature'] });
    const gear = (uuid: string, attachedTo: string) => permanent(uuid, {
      name: 'Matching gear', cardTypes: ['Artifact'], state: { attachedTo } as CardView['state'],
    });
    const cards = [first, second, gear('gear-a', first.uuid), gear('gear-b', first.uuid), gear('gear-c', second.uuid)];
    const html = renderBattlefield(cards);
    expect(html.match(/2 identical attachments, open stack picker/g)).toHaveLength(1);
    expect(html).toContain('data-board-token-members="battlefield:gear-b:0"');
    expect(html).toContain('data-board-anchor="battlefield:gear-c:0"');

    const targeting: TargetingState = {
      cardUuid: 'spell', zone: 'hand', actionId: 'cast_spell', collected: [],
      targeting: { type: 'permanent', required: true },
      groups: [{ id: 'targets', targeting: { type: 'permanent', required: true },
        legalTargets: [{ targetType: 'permanent', cardUuid: 'gear-b', zoneRevision: 0 }] }],
    };
    const choosing = renderBattlefield(cards, {}, targeting);
    expect(choosing).toContain('data-board-token-members="battlefield:gear-b:0"');
    expect(choosing).toContain('permanent-attachment is-stack is-selectable-stack');
  });

  it('collapses identical tokens into a counted stack', () => {
    const token = (uuid: string) =>
      permanent(uuid, {
        cardTypes: ['Creature'],
        name: 'Soldier',
        isToken: true,
        power: 1,
        toughness: 1,
      });
    const html = renderBattlefield([token('t1'), token('t2'), token('t3')]);
    expect(html.match(/permanent-slot/g)).toHaveLength(1);
    expect(html).toContain('×3');
    /* Tokens are marked by the printed face's own status line, not by a board class:
       the wide layout groups permanents into bands and rows instead. */
    expect(html).toContain('permanent-band permanent-band-creature');
    expect(html).toContain('permanent-line');
    expect(html).toContain('>Token<');
    expect(html).toContain('data-board-token-members="battlefield:t2:0 battlefield:t3:0"');
    expect(html).toContain('3 identical permanents, open stack picker');
  });

  it('keeps target and combat stacks in place and highlights available choices', () => {
    const tokens = ['t1', 't2', 't3', 't4'].map((uuid, index) =>
      permanent(uuid, { isToken: true, name: index < 2 ? 'Soldier' : 'Wolf', cardTypes: ['Creature'] }));
    const targeting = {
      cardUuid: 'spell', zone: 'hand', actionId: 'cast_spell', collected: [],
      targeting: { type: 'permanent', required: true },
      groups: [{ id: 'targets', targeting: { type: 'permanent', required: true },
        legalTargets: [{ targetType: 'permanent', cardUuid: 't2', zoneRevision: 0 }] }],
    } satisfies TargetingState;
    const choosing = renderBattlefield(tokens, {}, targeting);
    expect(choosing.match(/permanent-slot/g)).toHaveLength(2);
    expect(choosing).toContain('data-board-token-members="battlefield:t2:0"');
    expect(choosing.match(/is-selectable-stack/g)).toHaveLength(1);
    const declaring = renderBattlefield(tokens, { phase: 'declareAttackersStep', legalActions: {
      actions: ['concede'], combat: { actionId: 'declare_attackers', attackerUuids: tokens.map(card => card.uuid) },
    } });
    expect(declaring.match(/permanent-slot/g)).toHaveLength(2);
    expect(declaring.match(/is-selectable-stack/g)).toHaveLength(2);
  });

  it('keeps an attached token individual and only links the current host revision', () => {
    const token = (uuid: string) => permanent(uuid, {
      isToken: true, name: 'Soldier', cardTypes: ['Creature'],
      state: { zoneRevision: 4 } as CardView['state'],
    });
    const attachment = (uuid: string, name: string, revision: number) => permanent(uuid, {
      name, cardTypes: ['Artifact'], state: { attachedTo: 't2', attachedToRevision: revision } as CardView['state'],
    });
    const html = renderBattlefield([token('t1'), token('t2'),
      attachment('equip', 'Equipment', 4), attachment('stale', 'Stale equipment', 3)]);
    expect(html.match(/permanent-slot/g)).toHaveLength(3);
    expect(html).toContain('Attached Equipment');
    expect(html).not.toContain('Attached Stale equipment');
    expect(html).toContain('data-board-anchor="battlefield:equip:0"');
  });

  it('keeps distinct tokens as separate slots', () => {
    const html = renderBattlefield([
      permanent('t1', { cardTypes: ['Creature'], name: 'Soldier', isToken: true, power: 1, toughness: 1 }),
      permanent('t2', { cardTypes: ['Creature'], name: 'Soldier', isToken: true, power: 2, toughness: 2 }),
    ]);
    expect(html.match(/permanent-slot/g)).toHaveLength(2);
  });

  it('makes every slot keyboard reachable', () => {
    const html = renderBattlefield([permanent('c1', { cardTypes: ['Creature'], name: 'Bear' })]);
    expect(html).toContain('tabindex="0"');
  });

  it('gives distinct permanents their own slots in a wrapping band', () => {
    const html = renderBattlefield(Array.from({ length: 12 }, (_, index) =>
      permanent(`distinct-${index}`, { cardTypes: ['Creature'], name: `Creature ${index}` })));
    expect(html.match(/permanent-line/g)).toHaveLength(1);
    expect(html.match(/permanent-slot/g)).toHaveLength(12);
  });
});

describe('card preview', () => {
  const rect = { left: 100, top: 100, right: 240, bottom: 296, width: 140, height: 196, x: 100, y: 100, toJSON: () => ({}) } as DOMRect;

  it('never intercepts pointer events', () => {
    const html = renderToStaticMarkup(
      createElement(CardPreview, { card: permanent('c1', { name: 'Bear' }), rect }),
    );
    expect(html).toContain('card-preview');
    expect(html).toContain('aria-hidden="true"');
  });

  it('positions itself from the hovered card', () => {
    const html = renderToStaticMarkup(
      createElement(CardPreview, { card: permanent('c1', { name: 'Bear' }), rect }),
    );
    expect(html).toMatch(/left:\s*\d+px/);
    expect(html).toMatch(/top:\s*\d+px/);
  });

  it('shows the card name', () => {
    const html = renderToStaticMarkup(
      createElement(CardPreview, { card: permanent('c1', { name: 'Bear' }), rect }),
    );
    expect(html).toContain('Bear');
  });

  it('calls out tapped permanents', () => {
    const html = renderToStaticMarkup(
      createElement(CardPreview, {
        card: permanent('c1', { name: 'Bear', state: { isTapped: true } as CardView['state'] }),
        rect,
      }),
    );
    expect(html).toContain('Tapped');
  });

  it('shows counter counts, marked damage, and the duration and public source of an effect', () => {
    const card = permanent('c1', {
      state: { counters: { '+1/+1': 1 }, damageTaken: 2 } as CardView['state'],
      effects: [{ kind: 'stats', power: 2, toughness: 0, duration: 'turn', sourceName: 'Banner' }],
    });
    const html = renderToStaticMarkup(createElement(CardPreview, { card, rect }));
    expect(html).toContain('+1/+1 1');
    expect(html).toContain('2 marked damage');
    expect(html).toContain('+2/0 · Until end of turn · Banner');
  });
});

describe('permanent half', () => {
  it('renders an empty message when it has no permanents', () => {
    const html = renderToStaticMarkup(
      createElement(PermanentHalf, { cards: [], side: 'you', onPreview: () => {} }),
    );
    expect(html).toContain('Your Permanents');
    expect(html).toContain('empty');
  });

  it('labels the opponent half differently', () => {
    const html = renderToStaticMarkup(
      createElement(PermanentHalf, { cards: [], side: 'opponent', onPreview: () => {} }),
    );
    expect(html).toContain('board-half-opponent');
    expect(html).toContain('empty');
  });
});
