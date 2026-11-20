import { describe, expect, it } from 'vitest';
import type { CardView, ClientLocale, PlayerView } from '@card-game/protocol';
import { applyViewLocale } from '@server/projection/localize-view';

/** Minimal CardView: only the fields the localizer reads are meaningful here. */
function card(overrides: Partial<CardView> & { definitionId: string; name: string; label: string }): CardView {
  return {
    uuid: 'u-' + overrides.definitionId,
    cardTypes: ['Spell'],
    subTypes: [],
    keywords: [],
    rulesText: 'authored rules',
    manaCost: '{R}{R}',
    state: { visibility: 'public', zone: 'battlefield', ownerId: 'p1', controllerId: 'p1', zoneRevision: 1, isTapped: false, damageTaken: 0, summoningSickness: false, attackedThisTurn: false, counters: {} },
    actions: [],
    targetGroups: {},
    canAttack: false,
    canBlock: false,
    ...overrides,
  } as CardView;
}

function viewWith(cards: CardView[]): PlayerView {
  return {
    protocolVersion: 1,
    seq: 1,
    viewerId: 'p1',
    roomId: 'room',
    player1Id: 'p1',
    player2Id: 'p2',
    players: {
      p1: { id: 'p1', life: 20, mana: {}, hand: [cards[0]], handCount: 1, deckCount: 0, graveyard: [], exile: [] },
      p2: { id: 'p2', life: 20, mana: {}, hand: [], handCount: 0, deckCount: 0, graveyard: [], exile: [] },
    },
    phase: 'stateMainPhase',
    status: 'playing',
    debugMode: 'off',
    turnNumber: 1,
    engineState: 'waiting_for_player',
    activeTurnPlayerId: 'p1',
    priorityPlayerId: 'p1',
    lastPassedPlayerId: null,
    declarationPlayerId: null,
    landPlayLimit: 1,
    turnHistory: { landPlays: {} },
    stack: [{ uuid: 's1', type: 'spell', controllerId: 'p1', source: cards[1], description: 'cast' }],
    battlefield: [cards[2]],
    combat: [],
    pendingChoice: null,
    rpsState: { status: 'none', playedCards: {} },
  } as unknown as PlayerView;
}

const fireball = (locale: ClientLocale) => card({
  definitionId: 'fireball',
  name: locale === 'en' ? '火球術' : '火球術',
  label: '火球術',
  rulesText: '主 ; 灼熱2：放置兩個灼熱指數在對手場上的僕從/遺跡',
  subTypes: ['炎兵'],
});

describe('projected view localization', () => {
  it('swaps card text to English while leaving the rest of the view alone', () => {
    const view = viewWith([fireball('en'), fireball('en'), fireball('en')]);
    const localized = applyViewLocale(view, 'en');
    const hand = localized.players.p1.hand[0];
    expect(hand.name).toBe('Fireball');
    expect(hand.label).toBe('Fireball');
    expect(hand.rulesText).toContain('Scorch 2');
    expect(hand.subTypes).toEqual(['Flame Soldier']);
    expect(localized.stack[0].source?.name).toBe('Fireball');
    expect(localized.battlefield[0].name).toBe('Fireball');
    expect(localized.viewerId).toBe(view.viewerId);
    expect(localized.players.p1.life).toBe(20);
  });

  it('keeps the authored view untouched for zh-Hant, which is what the cards are written in', () => {
    const view = viewWith([fireball('zh-Hant'), fireball('zh-Hant'), fireball('zh-Hant')]);
    expect(applyViewLocale(view, 'zh-Hant')).toBe(view);
  });

  it('keeps an authored label that carries a printed suffix', () => {
    const suffixed = card({ definitionId: 'fireball', name: '火球術', label: '火球術 #2' });
    const localized = applyViewLocale(viewWith([fireball('en'), fireball('en'), suffixed]), 'en');
    expect(localized.battlefield[0].label).toBe('火球術 #2');
    expect(localized.battlefield[0].name).toBe('Fireball');
  });

  it('leaves an unknown definition exactly as projected', () => {
    /* abyss-giant used to be the "no translation" sample; every shipped card is translated
       now, so this covers the other real branch: a definition the catalog does not know. */
    const unknown = card({ definitionId: 'not-a-card', name: 'Unknown', label: 'Unknown', rulesText: 'n/a' });
    const alsoUnknown = card({ definitionId: 'also-not-a-card', name: 'Also unknown', label: 'Also unknown', rulesText: 'n/a' });
    const localized = applyViewLocale(viewWith([unknown, alsoUnknown, fireball('en')]), 'en');
    expect(localized.players.p1.hand[0].name).toBe('Unknown');
    expect(localized.stack[0].source?.name).toBe('Also unknown');
    expect(localized.battlefield[0].name).toBe('Fireball');
  });

  it('localizes observed cards and leaves an observation without cards alone', () => {
    const view = viewWith([fireball('en'), fireball('en'), fireball('en')]);
    view.observations = {
      active: [{ id: 'o1', turnNumber: 1, ordered: true, cards: [{ definitionId: 'fireball', name: '火球術', cardTypes: ['Spell'], subTypes: ['炎兵'], rulesText: '主 ; 灼熱2' }] }],
      history: [{ id: 'o2', turnNumber: 1, ordered: false }],
    };
    const localized = applyViewLocale(view, 'en');
    expect(localized.observations?.active[0].cards?.[0].name).toBe('Fireball');
    expect(localized.observations?.history[0]).toEqual({ id: 'o2', turnNumber: 1, ordered: false });
  });
});
