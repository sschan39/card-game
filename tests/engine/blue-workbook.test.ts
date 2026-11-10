import { afterEach, describe, expect, it, vi } from 'vitest';
import { GameEngine } from '@engine/game-engine';
import { CardCharacteristicService } from '@engine/card-characteristic-service';
import { instantiateCard } from '@library/card-factory';
import { buildCatalog } from '@server/catalog/catalog';
import { buildPlayerView } from '@server/projection/view-builder';
import { deckEligibility, validateDeck } from '@card-game/protocol';
import blueDeck from '../../docs/decks/blue-giant-workbook.json';
import { actionPermission } from '../../packages/engine/src/shared/action-permissions';
import { describeStackObject } from '../../packages/engine/src/shared/action-description';
import type { CardInstance, CardZone } from '@shared/card.types';
import { createTestRoom, fillTestLibraries } from '../helpers/test-room-factory';

const engines: GameEngine[] = [];
afterEach(() => engines.splice(0).forEach(engine => engine.dispose()));

function card(id: string, zone: CardZone, player = 'player1') {
  const value = instantiateCard(id);
  value.state = { ...value.state, zone, ownerId: player, controllerId: player, summoningSickness: false };
  return value;
}

function game(...battlefield: CardInstance[]) {
  const room = createTestRoom({ battlefield });
  fillTestLibraries(room, 20);
  room.players.player1.hand = [];
  const engine = new GameEngine(room);
  engine.initRoom();
  engines.push(engine);
  return engine;
}

function resolve(engine: GameEngine) {
  expect(engine.resolveTopOfStack().success).toBe(true);
}

function cast(engine: GameEngine, id: string) {
  const source = card(id, 'hand');
  engine.roomState.players.player1.hand.push(source);
  expect(engine.executePlayerAction('player1', 'cast_spell', { cardUuid: source.uuid }).success).toBe(true);
  resolve(engine);
  return engine.roomState.battlefield.find(value => value.uuid === source.uuid)!;
}

function select(engine: GameEngine, ids: string[]) {
  const choice = engine.roomState.pendingChoice;
  expect(choice).toBeDefined();
  expect(engine.executePlayerAction(choice!.playerId, 'choose', { choiceId: choice!.id, choices: ids }).success).toBe(true);
}

function options(engine: GameEngine) {
  const choice = engine.roomState.pendingChoice;
  if (!choice || choice.kind === 'number') throw new Error('Expected a card or option choice');
  return choice.options;
}

function ids(cards: CardInstance[]) {
  return cards.map(value => value.uuid);
}

describe('blue workbook cards', () => {
  it.each([true, false])('Tassa keeps the reveal at six even with the Temple (accept=%s)', accept => {
    const engine = game(card('shifting-sea-temple', 'battlefield'));
    const player = engine.roomState.players.player1;
    const [outside, giant, otherTassa] = [card('sea-patrol', 'library'), card('sea-patrol', 'library'), card('phantom-sea-tassa', 'library')];
    const rest = Array.from({ length: 4 }, () => card('sea-domain', 'library'));
    player.deck = [outside, giant, otherTassa, ...rest];

    cast(engine, 'phantom-sea-tassa');
    const ability = engine.roomState.stack.at(-1)!;
    expect(describeStackObject(engine.roomState, ability, 'player1')).toContain('reveal 6');
    resolve(engine);
    select(engine, [accept ? 'yes' : 'no']);

    if (accept) {
      const offered = options(engine);
      expect(offered).toHaveLength(1);
      expect(JSON.stringify(offered[0].value)).toContain(giant.uuid);
      select(engine, [offered[0].id]);
    }
    const result = engine.roomState.players.player1;
    expect(ids(result.hand)).toEqual(accept ? [giant.uuid] : []);
    expect(ids(result.graveyard)).toEqual(accept ? ids([otherTassa, ...rest].reverse()) : []);
    expect(result.deck).toHaveLength(accept ? 1 : 7);
    expect(result.deck[0].uuid).toBe(outside.uuid);

    const events = engine.drainEventBatches().flatMap(batch => batch.events);
    expect(events.filter(event => event.eventId === 'CARD_REVEALED')).toHaveLength(accept ? 6 : 0);
    expect(events.filter(event => event.eventId === 'CARD_DISCARDED_FROM_LIBRARY')).toHaveLength(accept ? 5 : 0);
    const effectIds = events.flatMap(event => event.eventId === 'STACK_ITEM_RESOLVED' ? [event.payload.effectId] : []);
    if (accept) expect(effectIds).toContain('DISCARD_CAPTURED');
    expect(effectIds).not.toContain('DISCARD_FROM_LIBRARY');
  });

  it('Tassa discards its captured remainder without a legal take and still triggers the Sunken Ship', () => {
    const engine = game();
    const ship = card('sunken-ship', 'library');
    const land = card('sea-domain', 'library');
    engine.roomState.players.player1.deck = [ship, land];

    cast(engine, 'phantom-sea-tassa');
    resolve(engine);
    select(engine, ['yes']);
    expect(engine.roomState.pendingChoice).toBeFalsy();
    expect(ids(engine.roomState.players.player1.graveyard)).toEqual(ids([land, ship]));
    resolve(engine);
    expect(engine.roomState.players.player1.mana.blue).toBe(5);
  });

  it('Haya takes a giant and a relic, keeps equipment out of that choice and independently mills its opponent', () => {
    const engine = game(card('shifting-sea-temple', 'battlefield'));
    const outside = card('sea-domain', 'library');
    const giant = card('sea-patrol', 'library');
    const relic = card('demon-sea-spire', 'library');
    const equipment = card('heavenly-lance', 'library');
    const rest = Array.from({ length: 3 }, () => card('sea-domain', 'library'));
    engine.roomState.players.player1.deck = [outside, giant, relic, equipment, ...rest];

    cast(engine, 'sea-god-caller-haya');
    const order = options(engine);
    select(engine, order.map(option => option.id));
    resolve(engine);
    if (!engine.roomState.pendingChoice) resolve(engine);
    select(engine, ['reveal-six']);
    for (const expected of [giant, relic]) {
      const offered = options(engine);
      expect(offered).toHaveLength(1);
      expect(JSON.stringify(offered[0].value)).toContain(expected.uuid);
      select(engine, [offered[0].id]);
    }
    if (engine.roomState.stack.length) resolve(engine);
    const { player1, player2 } = engine.roomState.players;
    expect(ids(player1.hand)).toEqual(ids([giant, relic]));
    expect(ids(player1.graveyard)).toEqual(ids([equipment, ...rest].reverse()));
    expect(ids(player1.deck)).toEqual([outside.uuid]);
    expect(player2.graveyard).toHaveLength(3);
  });

  it.each(['hand', 'library'] as const)('the Sunken Ship makes blue mana when discarded from %s', zone => {
    const engine = game();
    const ship = card('sunken-ship', zone);
    engine.roomState.players.player1[zone === 'hand' ? 'hand' : 'deck'].push(ship);
    engine.applyMutations([{
      type: 'MOVE_CARD', cardUuid: ship.uuid, playerId: 'player1', from: zone, to: 'graveyard', reason: 'discard',
    }]);
    resolve(engine);
    expect(engine.roomState.players.player1.mana.blue).toBe(6);
  });

  it('the Sunken Ship mills three even with the Temple', () => {
    const engine = game(card('shifting-sea-temple', 'battlefield'));
    cast(engine, 'sunken-ship');
    resolve(engine);
    expect(engine.roomState.players.player2.graveyard).toHaveLength(3);
  });

  it('the Illusionist bonus stacks with the Temple, applies to later arrivals and survives the Illusionist leaving', () => {
    const temple = card('shifting-sea-temple', 'battlefield');
    const enemy = card('sea-patrol', 'battlefield', 'player2');
    const engine = game(temple, enemy);
    const illusionist = cast(engine, 'seaborn-illusionist');
    resolve(engine);
    engine.applyMutations([{
      type: 'MOVE_CARD', cardUuid: illusionist.uuid, playerId: 'player1', from: 'battlefield', to: 'graveyard',
    }]);
    const patrol = cast(engine, 'sea-patrol');
    resolve(engine);
    expect(engine.roomState.players.player2.graveyard).toHaveLength(4);
    const bonus = (source: CardInstance) => CardCharacteristicService.resolve(engine.roomState, source).millBonus;
    expect(bonus(patrol)).toBe(2);
    expect(bonus(enemy)).toBeUndefined();
    engine.applyMutations([{ type: 'CLEAR_END_OF_TURN_EFFECTS' }]);
    expect(bonus(patrol)).toBe(1);
    engine.applyMutations([{
      type: 'MOVE_CARD', cardUuid: temple.uuid, playerId: 'player1', from: 'battlefield', to: 'graveyard',
    }]);
    expect(bonus(patrol)).toBeUndefined();
  });

  it('the Temple grants an attack trigger that keeps its mill bonus if the attacker leaves before resolution', () => {
    const temple = card('shifting-sea-temple', 'battlefield');
    const giant = card('sea-patrol', 'battlefield');
    const engine = game(temple, giant);
    expect(engine.executePlayerAction('player1', 'activate_ability', {
      cardUuid: temple.uuid, abilityId: 'grant-attack-mill', targets: [{ targetType: 'permanent', cardUuid: giant.uuid }],
    }).success).toBe(true);
    resolve(engine);
    engine.roomState.phase = 'declareAttackersStep';
    engine.roomState.priorityPlayerId = null;
    expect(engine.executePlayerAction('player1', 'declare_attackers', { attackers: [{ cardUuid: giant.uuid }] }).success).toBe(true);
    engine.applyMutations([
      { type: 'MOVE_CARD', cardUuid: giant.uuid, playerId: 'player1', from: 'battlefield', to: 'graveyard' },
    ]);
    resolve(engine);
    expect(engine.roomState.players.player2.graveyard).toHaveLength(2);
    engine.applyMutations([
      { type: 'MOVE_CARD', cardUuid: giant.uuid, playerId: 'player1', from: 'graveyard', to: 'battlefield' },
    ]);
    const returned = engine.roomState.battlefield.find(value => value.uuid === giant.uuid)!;
    expect(CardCharacteristicService.resolveAbilities(engine.roomState, returned).map(ability => ability.id))
      .not.toContain(expect.stringContaining('temple-granted-attack-mill'));
  });

  it('the Spire bans small opposing spells on its controller’s attack phase and recovers one land per game', () => {
    const spire = card('demon-sea-spire', 'battlefield');
    const engine = game(spire);
    const room = engine.roomState;
    const small = card('sea-depths', 'hand', 'player2');
    const large = card('sea-depths', 'hand', 'player2');
    large.blueprint = {
      ...large.blueprint, castRequirements: { ...large.blueprint.castRequirements, cost: { mana: { blue: 4 } } },
    };
    const opposingGiant = card('sea-patrol', 'hand', 'player2');
    room.players.player2.hand.push(small, large, opposingGiant);
    const allowed = (source: CardInstance) => actionPermission(room, 'player2', source, 'cast').allowed;
    expect(allowed(small)).toBe(true);
    room.phase = 'declareAttackersStep';
    expect(allowed(small)).toBe(false);
    expect(allowed(large)).toBe(true);
    expect(allowed(opposingGiant)).toBe(true);
    room.activeTurnPlayerId = 'player2';
    expect(allowed(small)).toBe(true);

    room.phase = 'stateMainPhase';
    room.priorityPlayerId = 'player1';
    const land = card('sea-domain', 'graveyard');
    room.players.player1.graveyard.push(land, card('sea-domain', 'graveyard'));
    const activate = () => engine.executePlayerAction('player1', 'activate_ability', { cardUuid: spire.uuid, abilityId: 'recover-land' });
    expect(activate().success).toBe(true);
    resolve(engine);
    const selected = options(engine).find(option => JSON.stringify(option.value).includes(land.uuid));
    select(engine, [selected!.id]);
    expect(ids(engine.roomState.battlefield)).toContain(land.uuid);
    expect(engine.roomState.players.player1.graveyard).toHaveLength(1);
    expect(Object.values(engine.roomState.gameRuleUses ?? {})).toEqual([1]);
    engine.roomState.priorityPlayerId = 'player1';
    expect(activate().success).toBe(false);
  });
});


it('builds a 60-card blue deck under the workbook copy limits', () => {
  const standard = buildCatalog();
  const workbook = new Map([...standard].map(([id, entry]) => [id, {
    ...entry,
    copyLimit: entry.copyLimit === null ? null : deckEligibility.copyLimits[id] ?? 3,
  }]));
  expect(validateDeck(blueDeck, standard).valid).toBe(true);
  expect(validateDeck(blueDeck, workbook).valid).toBe(true);
  expect(blueDeck.cards.reduce((total, row) => total + row.quantity, 0)).toBe(60);
  const landCount = blueDeck.cards
    .filter(row => standard.get(row.cardId)?.cardTypes.includes('Land'))
    .reduce((total, row) => total + row.quantity, 0);
  expect(landCount).toBe(24);
  for (const { cardId } of blueDeck.cards) {
    const cost = instantiateCard(cardId).blueprint.castRequirements.cost?.mana ?? {};
    expect(Object.keys(cost).every(color => ['blue', 'generic'].includes(color))).toBe(true);
  }
});

describe('blue mill finisher and random discard', () => {
  it('the Wisdom Emperor counts this entry mill’s creature arrivals and keeps the attack bonus through cleanup', () => {
    const engine = game();
    const opponent = engine.roomState.players.player2;
    const redirected = card('sea-patrol', 'library', 'player2');
    const creatures = Array.from({ length: 5 }, () => card('sea-patrol', 'library', 'player2'));
    const lands = Array.from({ length: 4 }, () => card('sea-domain', 'library', 'player2'));
    opponent.deck.splice(-10, 10, ...creatures, ...lands, redirected);
    opponent.graveyard.push(card('sea-patrol', 'graveyard', 'player2'));
    engine.roomState.replacementEffects = [{
      id: 'send-to-exile', label: 'Exile the creature', match: {
        kinds: ['discard'], card: { cardUuid: redirected.uuid, zoneRevision: 0 },
      }, operation: { type: 'move_destination', to: 'exile' },
    }];
    engine.roomState.players.player1.mana.blue = 6;
    const source = cast(engine, 'worlds-wisdom-emperor');
    resolve(engine);
    expect(engine.roomState.players.player2.deck).toHaveLength(10);
    expect(ids(engine.roomState.players.player2.exile ?? [])).toEqual([redirected.uuid]);
    expect(CardCharacteristicService.resolvePower(engine.roomState, source)).toBe(5);
    engine.applyMutations([{ type: 'CLEAR_END_OF_TURN_EFFECTS' }]);
    expect(CardCharacteristicService.resolvePower(engine.roomState, source)).toBe(5);

    const live = engine.roomState.battlefield.find(candidate => candidate.uuid === source.uuid)!;
    live.state.summoningSickness = false;
    engine.roomState.phase = 'declareAttackersStep';
    engine.roomState.priorityPlayerId = null;
    expect(engine.executePlayerAction('player1', 'declare_attackers', { attackers: [{ cardUuid: source.uuid }] }).success).toBe(true);
    resolve(engine);
    expect(engine.roomState.players.player2.deck).toHaveLength(6);

    engine.applyMutations([
      { type: 'MOVE_CARD', cardUuid: source.uuid, playerId: 'player1', from: 'battlefield', to: 'graveyard' },
      { type: 'MOVE_CARD', cardUuid: source.uuid, playerId: 'player1', from: 'graveyard', to: 'battlefield' },
    ]);
    expect(engine.roomState.stack).toHaveLength(0);
    const returned = engine.roomState.battlefield.find(candidate => candidate.uuid === source.uuid)!;
    expect(CardCharacteristicService.resolvePower(engine.roomState, returned)).toBe(0);
  });

  it.each([[-1, 0], [1, 0], [6, 6]])('the attack trigger reads %s attack at resolution and mills %s', (power, amount) => {
    const source = card('worlds-wisdom-emperor', 'battlefield');
    const engine = game(source);
    engine.roomState.phase = 'declareAttackersStep';
    engine.roomState.priorityPlayerId = null;
    expect(engine.executePlayerAction('player1', 'declare_attackers', { attackers: [{ cardUuid: source.uuid }] }).success).toBe(true);
    engine.applyMutations([{
      type: 'ADD_CONTINUOUS_EFFECT', entry: {
        source: source.uuid, requiredZone: null, duration: 'END_OF_TURN', layer: 7,
        scope: { cardUuid: source.uuid }, effect: { type: 'STAT_DELTA', power },
      },
    }]);
    resolve(engine);
    expect(engine.roomState.players.player2.graveyard).toHaveLength(amount);
  });

  it('Jormungandr’s cost uses a controlled Loki name on the battlefield', () => {
    const source = card('sea-god-wrath-jormungandr', 'hand');
    const enemy = card('sea-patrol', 'battlefield', 'player2');
    enemy.blueprint = { ...enemy.blueprint, name: '蒼海帝 洛基' };
    const engine = game(enemy);
    engine.roomState.players.player1.hand.push(source);
    expect(CardCharacteristicService.resolveManaCost(engine.roomState, source)).toEqual({ blue: 6 });
    const friendly = card('sea-patrol', 'battlefield');
    friendly.blueprint = { ...friendly.blueprint, name: '幻變之海 洛基尼亞' };
    engine.roomState.battlefield.push(friendly);
    expect(CardCharacteristicService.resolveManaCost(engine.roomState, source)).toEqual({ blue: 3, generic: 1 });
  });

  it('does not consume a random draw for an empty hand and keeps Jormungandr’s separate attack mill', () => {
    const source = card('sea-god-wrath-jormungandr', 'battlefield');
    const room = createTestRoom({ battlefield: [source] });
    fillTestLibraries(room, 12);
    const random = vi.fn();
    const engine = new GameEngine(room, { random });
    engines.push(engine);
    engine.initRoom();
    expect(engine.executePlayerAction('player1', 'activate_ability', {
      cardUuid: source.uuid, abilityId: 'random-hand-discard',
    }).success).toBe(true);
    resolve(engine);
    expect(random).not.toHaveBeenCalled();
    expect(engine.roomState.players.player2.graveyard).toHaveLength(0);

    engine.roomState.phase = 'declareAttackersStep';
    engine.roomState.priorityPlayerId = null;
    expect(engine.executePlayerAction('player1', 'declare_attackers', { attackers: [{ cardUuid: source.uuid }] }).success).toBe(true);
    resolve(engine);
    expect(engine.roomState.players.player2.graveyard).toHaveLength(5);
  });

  it.each([true, false])('random discard keeps its private pick through replacement and reconstruction (redirect=%s)', redirect => {
    const source = card('sea-god-wrath-jormungandr', 'battlefield');
    const selected = card('sea-depths', 'hand', 'player2');
    const hidden = card('sunken-ship', 'hand', 'player2');
    const room = createTestRoom({ battlefield: [source] });
    fillTestLibraries(room, 12);
    room.players.player2.hand = [hidden, selected];
    room.replacementEffects = [{
      id: 'redirect', label: 'Redirect the discard', optional: true, match: { kinds: ['discard'], card: { cardUuid: selected.uuid, zoneRevision: 0 } },
      operation: { type: 'move_destination', to: 'exile' },
    }];
    const random = vi.fn(() => 0.75);
    const engine = new GameEngine(room, { random });
    engines.push(engine);
    engine.initRoom();
    const activate = (gameEngine: GameEngine) => gameEngine.executePlayerAction('player1', 'activate_ability', {
      cardUuid: source.uuid, abilityId: 'random-hand-discard',
    });
    expect(activate(engine).success).toBe(true);
    expect(random).not.toHaveBeenCalled();
    resolve(engine);
    expect(random).toHaveBeenCalledTimes(1);
    expect(engine.roomState.pendingChoice?.continuation.type).toBe('replacement');
    expect(buildPlayerView(engine.roomState, 'player1').pendingChoice).toEqual({ kind: 'waiting', playerId: 'player2' });
    expect(JSON.stringify(buildPlayerView(engine.roomState, 'player1'))).not.toContain(selected.blueprint.id);

    const noReroll = vi.fn(() => { throw new Error('Random discard rerolled'); });
    const restored = new GameEngine(JSON.parse(JSON.stringify(engine.roomState)), { random: noReroll });
    engines.push(restored);
    restored.initRoom();
    select(restored, [redirect ? 'redirect' : 'skip:redirect']);
    expect(noReroll).not.toHaveBeenCalled();
    const opponent = restored.roomState.players.player2;
    expect(ids(opponent.hand)).toEqual([hidden.uuid]);
    expect(ids(redirect ? opponent.exile ?? [] : opponent.graveyard)).toEqual([selected.uuid]);
    restored.roomState.priorityPlayerId = 'player1';
    expect(activate(restored).success).toBe(false);
  });
});
