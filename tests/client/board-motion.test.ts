import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DamageImpactView, PlayerView } from '@card-game/protocol';
import { cardAnchor, measureAnchors, seatAnchor } from '@client/presentation/board-anchors';
import { playImpact } from '@client/presentation/impact-motion';
import { createTestRoom, creature } from '../helpers/client-view-fixture';

type LayoutEffect = () => void | (() => void);
let layout: LayoutEffect[] = [];
let refs: { current: unknown }[] = [];
let refIndex = 0;

vi.mock('react', async importOriginal => ({
  ...await importOriginal<typeof import('react')>(),
  useRef: (initial: unknown) => refs[refIndex++] ??= { current: initial },
  useLayoutEffect: (callback: LayoutEffect) => { layout.push(callback); },
}));
// Read from the real Zustand store while driving the layout lifecycle in the Node test.
vi.mock('@client/store/gameStore', async importOriginal => {
  const { useGameStore: store } = await importOriginal<typeof import('@client/store/gameStore')>();
  return {
    useGameStore: Object.assign(
      (select: (state: ReturnType<typeof store.getState>) => unknown) => select(store.getState()),
      store,
    ),
  };
});

const { useBoardMotion } = await import('@client/presentation/useBoardMotion');
const { useGameStore } = await import('@client/store/gameStore');

class Motion {
  onfinish?: () => void;
  oncancel?: () => void;
  private resolve!: () => void;
  private reject!: () => void;
  readonly finished = new Promise<void>((resolve, reject) => {
    this.resolve = resolve;
    this.reject = reject;
  });
  constructor(readonly frames: Keyframe[], readonly options: KeyframeAnimationOptions) {}
  finish() { this.onfinish?.(); this.resolve(); }
  cancel() { this.oncancel?.(); this.reject(); }
}

function rect(left = 0, top = 0, width = 40, height = 60) {
  return { left, top, width, height, right: left + width, bottom: top + height };
}

class Element {
  readonly dataset: Record<string, string> = {};
  readonly style: Record<string, string> = {};
  readonly motions: Motion[] = [];
  readonly children: Element[] = [];
  readonly classList = { add: (name: string) => { this.className += ' ' + name; } };
  parent?: Element;
  anchors: Element[] = [];
  card: Element | null = null;
  viewport?: Element;
  scrollRow?: Element;
  className = '';
  textContent = '';
  offsetWidth = 0;

  constructor(readonly box = rect()) {}
  getBoundingClientRect() { return this.box; }
  querySelector() { return this.card; }
  querySelectorAll() { return this.anchors; }
  closest(selector: string) { return selector === '.permanent-row.is-scroll' ? this.scrollRow : this.viewport; }
  cloneNode() {
    const clone = new Element(this.box);
    clone.textContent = this.textContent;
    return clone;
  }
  append(child: Element) {
    child.parent = this;
    this.children.push(child);
  }
  remove() {
    if (!this.parent) return;
    this.parent.children.splice(this.parent.children.indexOf(this), 1);
    this.parent = undefined;
  }
  animate(frames: Keyframe[], options: KeyframeAnimationOptions) {
    const motion = new Motion(frames, options);
    this.motions.push(motion);
    return motion;
  }
}

function dom(element: Element): HTMLDivElement {
  return element as unknown as HTMLDivElement;
}

function anchor(key: string, box = rect(), hasFace = false) {
  const element = new Element(box);
  element.dataset.boardAnchor = key;
  if (hasFace) {
    element.card = new Element();
    element.card.textContent = key;
  }
  return element;
}

function hasClass(element: Element, name: string) {
  return element.className.split(/\s+/).includes(name);
}

let cleanup: (() => void) | void;
let layer: Element;
let board: Element;
const media = { matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() };

beforeEach(() => {
  cleanup = undefined;
  layout = [];
  refs = [];
  board = new Element();
  layer = new Element();
  media.matches = false;
  media.addEventListener.mockClear();
  media.removeEventListener.mockClear();
  useGameStore.setState(useGameStore.getInitialState(), true);
  vi.stubGlobal('window', { matchMedia: () => media });
  vi.stubGlobal('document', { createElement: () => new Element() });
});

afterEach(() => {
  cleanup?.();
  vi.unstubAllGlobals();
});

function publish(room: PlayerView, seq: number, viewUpdate: 'delta' | 'snapshot' = 'delta', lastImpacts?: DamageImpactView[]) {
  useGameStore.setState({ room, roomSync: 'live', lastSeq: seq, viewUpdate, lastImpacts });
}

function mount(room: PlayerView) {
  const stageRef = { current: dom(board) as HTMLDivElement | null };
  const layerRef = { current: dom(layer) as HTMLDivElement | null };
  const commit = () => {
    refIndex = 0;
    layout = [];
    useBoardMotion(stageRef, layerRef, useGameStore.getState().room);
    cleanup ??= layout[0]();
    layout[1]();
  };
  publish(room, 1, 'snapshot');
  commit();
  return { commit, stageRef, layerRef };
}

function withLife(room: PlayerView, seat: string, delta: number) {
  const player = room.players[seat];
  return { ...room, players: { ...room.players, [seat]: { ...player, life: player.life + delta } } };
}

it('measures visible anchors and maps grouped tokens to a single visible card', () => {
  const grouped = anchor('first', rect(15, 10), true);
  grouped.dataset.boardTokenMembers = 'second third';
  grouped.viewport = new Element(rect(0, 0, 80, 90));
  grouped.scrollRow = new Element(rect(0, 0, 60, 90));
  const empty = anchor('empty', rect(0, 0, 0, 60));
  const zeroHeight = anchor('zero-height', rect(0, 0, 40, 0));
  const above = anchor('above', rect(15, -80));
  const below = anchor('below', rect(15, 90));
  const left = anchor('left', rect(-40, 10));
  const right = anchor('right', rect(80, 10));
  above.viewport = below.viewport = grouped.viewport;
  left.scrollRow = right.scrollRow = grouped.scrollRow;
  board.anchors = [grouped, empty, zeroHeight, above, below, left, right];
  const measured = measureAnchors(dom(board));
  expect([...measured.keys()]).toEqual(['first', 'second', 'third']);
  expect(measured.get('second')).toBe(measured.get('first'));
  expect(measured.get('third')).toMatchObject({ card: grouped.card, tokenMembers: ['first', 'second', 'third'] });
});

describe('board damage motion', () => {
  it('uses the pre-update location of a defeated creature and removes both lunges and the hit after playback', async () => {
    const attacker = anchor('attacker', rect(0, 0), true);
    const defeated = anchor('defeated', rect(100, 100), true);
    board.anchors = [attacker, defeated];
    const before = measureAnchors(dom(board));
    board.anchors = [attacker];
    const after = measureAnchors(dom(board));
    const animations = playImpact({ from: 'attacker', at: 'defeated', style: 'combat' }, before, after, dom(layer)) as unknown as Motion[];
    expect(layer.children).toHaveLength(3);
    const lunges = layer.children.filter(element => hasClass(element, 'board-lunge'));
    expect(lunges).toHaveLength(2);
    expect(lunges.some(element => element.children.some(face => face.textContent === 'defeated'))).toBe(true);
    const transforms = lunges.map(element => element.motions[0].frames[1].transform);
    expect(transforms[0]).toContain('translate3d(70px, 80px, 0)');
    expect(new Set(transforms).size).toBe(1);
    expect(layer.children.find(element => hasClass(element, 'board-burst'))?.motions[0].options.delay).toBe(150);
    for (const animation of animations) animation.finish();
    await Promise.all(animations.map(animation => animation.finished));
    expect(layer.children).toEqual([]);
  });

  it('travels from the new spell anchor to the new target position and skips a fully hidden destination', () => {
    const oldTarget = anchor('target', rect(20, 10));
    const target = anchor('target', rect(100, 10));
    const spell = anchor('spell', rect(0, 10));
    board.anchors = [oldTarget];
    const before = measureAnchors(dom(board));
    board.anchors = [spell, target];
    const after = measureAnchors(dom(board));
    expect(playImpact({ from: 'spell', at: 'hidden', style: 'red' }, before, after, dom(layer))).toHaveLength(0);
    expect(playImpact({ from: 'spell', at: 'target', style: 'red' }, before, after, dom(layer))).toHaveLength(2);
    const projectile = layer.children.find(element => hasClass(element, 'board-projectile'));
    const burst = layer.children.find(element => hasClass(element, 'board-burst'));
    expect(projectile?.dataset.impact).toBe('red');
    expect(projectile?.motions[0].frames[1].transform).toContain('translate3d(120px, 40px, 0)');
    expect(burst?.motions[0].options.delay).toBe(205);

    const selfHit = playImpact({ from: 'target', at: 'target', style: 'neutral' }, before, after, dom(layer)) as unknown as Motion[];
    expect(selfHit.map(motion => motion.options.delay)).toEqual([0]);
    const combatHit = playImpact({ from: 'spell', at: 'target', style: 'combat' }, before, after, dom(layer)) as unknown as Motion[];
    expect(combatHit.map(motion => motion.options.delay)).toEqual([150]);
  });

  it('coalesces live updates and plays one life total change alongside the hit after render', async () => {
    const initial = createTestRoom();
    const attacker = anchor('battlefield:attacker:0', rect(10, 10), true);
    attacker.card!.offsetWidth = 76;
    board.anchors = [attacker, anchor(seatAnchor('life', 'player1')), anchor(seatAnchor('life', 'player2'))];
    const { commit } = mount(initial);
    const hit: DamageImpactView = {
      source: { kind: 'permanent', cardUuid: 'attacker', zoneRevision: 0 },
      target: { kind: 'player', playerId: 'player2' }, combat: true,
    };
    publish(withLife(initial, 'player2', -1), 2);
    const current = withLife(withLife(initial, 'player2', -3), 'player1', 2);
    publish(current, 3, 'delta', [hit]);
    publish(current, 4);
    expect(layer.children).toHaveLength(0);
    commit();
    expect(layer.children).toHaveLength(4);
    expect(layer.children.map(element => [element.className, element.textContent, element.motions[0].options.delay])).toEqual(expect.arrayContaining([
      ['board-flight board-lunge', '', undefined], ['board-burst', '', 150],
      ['board-number is-gain', '+2', 0], ['board-number is-damage', '-3', 220],
    ]));
    expect(layer.children.find(element => hasClass(element, 'board-lunge'))?.style.width).toBe('76px');
    for (const element of [...layer.children]) element.motions[0].finish();
    await Promise.resolve();
    publish(current, 4);
    commit();
    expect(layer.children).toHaveLength(0);
  });

  it('cancels old motion on a fresh snapshot or offline state and honors reduced motion', () => {
    const original = createTestRoom();
    board.anchors = [anchor(seatAnchor('life', 'player1'))];
    const { commit } = mount(original);
    publish(withLife(original, 'player1', -2), 2);
    commit();
    expect(layer.children).toHaveLength(1);
    publish(original, 3, 'snapshot');
    publish(original, 3, 'snapshot');
    expect(layer.children).toHaveLength(0);
    publish(withLife(original, 'player1', 1), 4);
    commit();
    expect(layer.children).toHaveLength(0);
    publish(withLife(original, 'player1', 3), 5);
    commit();
    expect(layer.children.map(element => element.textContent)).toEqual(['+2']);

    media.matches = true;
    const onPreferenceChange = media.addEventListener.mock.calls[0][1] as () => void;
    onPreferenceChange();
    publish(withLife(original, 'player1', 4), 6);
    commit();
    expect(layer.children).toHaveLength(0);
    media.matches = false;
    publish(withLife(original, 'player1', 5), 7);
    commit();
    expect(layer.children).toHaveLength(1);
    useGameStore.setState({ roomSync: 'offline' });
    expect(layer.children).toHaveLength(0);
  });
});

it('animates a grouped token once, pulses the survivor, then removes the final ghost', () => {
  const room = createTestRoom();
  const first = { ...creature('first', 'player1'), isToken: true };
  const second = { ...creature('second', 'player1'), isToken: true };
  const firstKey = cardAnchor('battlefield', first), secondKey = cardAnchor('battlefield', second);
  const { commit } = mount(room);
  publish({ ...room, battlefield: [first, second] }, 2);
  const group = anchor(firstKey, rect(), true);
  group.dataset.boardTokenMembers = secondKey;
  board.anchors = [group];
  commit();
  expect(group.motions.map(motion => motion.options.duration)).toEqual([320]);

  publish({ ...room, battlefield: [second] }, 3);
  const survivor = anchor(secondKey, rect(), true);
  board.anchors = [survivor];
  commit();
  expect(survivor.motions.map(motion => motion.options.duration)).toEqual([260]);
  expect(layer.children).toHaveLength(0);

  publish(room, 4);
  board.anchors = [];
  commit();
  const ghost = layer.children.find(element => hasClass(element, 'board-token-ghost'));
  expect(ghost?.children.map(face => face.textContent)).toContain(secondKey);
  ghost!.motions[0].finish();
  expect(layer.children).toHaveLength(0);
});

it('moves a card between visible zones and falls back to a pulse when its origin is clipped', () => {
  const initial = createTestRoom();
  const player = initial.players.player1;
  const card = player.hand[0];
  const hand = cardAnchor('hand', card);
  const graveKey = seatAnchor('graveyard', player.id);
  const grave = anchor(graveKey, rect(150, 10));
  const { commit } = mount(initial);
  const discarded = { ...initial, players: { ...initial.players,
    player1: { ...player, hand: player.hand.slice(1), graveyard: [card] },
  } };
  publish(discarded, 2);
  board.anchors = [grave];
  commit();
  expect(grave.motions.map(motion => motion.options.duration)).toEqual([440]);
  expect(layer.children).toHaveLength(0);

  publish(initial, 3);
  const handAnchor = anchor(hand, rect(15, 10), true);
  board.anchors = [handAnchor];
  commit();
  const arriving = layer.children.find(element => element.children.some(face => face.textContent === hand));
  expect(arriving?.style.width).toBe('72px');
  expect(handAnchor.card?.motions[0].frames).toEqual([
    { opacity: 0 }, { opacity: 0, offset: .72 }, { opacity: 1 },
  ]);
  arriving!.motions[0].finish();
  expect(layer.children).toHaveLength(0);

  publish(discarded, 4);
  board.anchors = [grave];
  commit();
  const departing = layer.children.find(element => element.children.some(face => face.textContent === hand));
  expect(departing).toBeDefined();
  departing!.motions[0].finish();

  publish(initial, 5);
  board.anchors = [anchor(hand)];
  commit();
  expect(layer.children.find(element => hasClass(element, 'board-flight-label'))?.textContent).toBe(card.name);
});



it('plays anonymous backs for an opposing draw, caps the burst, and cleans up on resync', () => {
  const before = createTestRoom();
  const opponent = before.players.player2;
  const deck = anchor(seatAnchor('deck', opponent.id), rect(5, 10));
  board.anchors = [deck];
  const { commit } = mount(before);

  const after = structuredClone(before);
  after.players.player2.deckCount -= 4;
  after.players.player2.handCount += 4;
  publish(after, 2);
  board.anchors = [deck, anchor(seatAnchor('hand', opponent.id), rect(110, 30))];
  commit();
  expect(layer.children.slice().sort((a, b) => Number(a.motions[0].options.delay) - Number(b.motions[0].options.delay))
    .map(element => [element.className, element.children.length, element.textContent, element.motions[0].options.delay]))
    .toEqual([0, 55, 110].map(delay => ['board-flight board-flight-back', 0, '', delay]));

  publish(after, 3, 'snapshot');
  commit();
  expect(layer.children).toEqual([]);
});

it('does not draw a disappearing token when its anchor has no card face', () => {
  const room = createTestRoom();
  const token = { ...creature('unpainted', 'player1'), isToken: true };
  board.anchors = [anchor(cardAnchor('battlefield', token))];
  const { commit } = mount({ ...room, battlefield: [token] });
  publish(room, 2);
  board.anchors = [];
  commit();
  expect(layer.children).toEqual([]);
});

it('caps a large damage update at twelve visible cues and skips clipped cards', () => {
  const cards = Array.from({ length: 14 }, (_, index) => creature('creature-' + index, 'player1'));
  const room = { ...createTestRoom(), battlefield: cards };
  board.anchors = cards.slice(1).map(card => anchor(cardAnchor('battlefield', card)));
  const { commit } = mount(room);
  publish({ ...room }, 2);
  commit();
  expect(layer.children).toHaveLength(0);

  const damaged = cards.map((card, index) => ({ ...card, state: { ...card.state, damageTaken: index + 1 } }));
  publish({ ...room, battlefield: damaged }, 3);
  commit();
  expect(layer.children.map(visual => visual.textContent).sort())
    .toEqual(Array.from({ length: 12 }, (_, index) => String(-2 - index)).sort());
});
