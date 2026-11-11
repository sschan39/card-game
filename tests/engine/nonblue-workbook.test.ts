import { afterEach, describe, expect, it } from 'vitest';
import { GameEngine } from '@engine/game-engine';
import { planDamage } from '@engine/damage-service';
import { captureSourceInformation } from '@engine/source-information';
import { StateMachine } from '@engine/state-machine';
import { CardCharacteristicService } from '@engine/card-characteristic-service';
import { getBlueprint, instantiateCard } from '@library/card-factory';
import { buildCardView } from '@server/projection/card-view';
import { buildChoiceView } from '@server/projection/choice-view';
import type { CardInstance, CardZone } from '@shared/card.types';
import { createTestRoom, fillTestLibraries } from '../helpers/test-room-factory';

const engines: GameEngine[] = [];
afterEach(() => engines.splice(0).forEach(engine => engine.dispose()));

function card(id: string, zone: CardZone, playerId = 'player1') {
  const value = instantiateCard(id);
  value.state = { ...value.state, ownerId: playerId, controllerId: playerId, zone, summoningSickness: false };
  return value;
}
function game(...battlefield: CardInstance[]) {
  const room = createTestRoom({ battlefield });
  fillTestLibraries(room, 20);
  room.players.player1.hand = [];
  const engine = new GameEngine(room);
  engines.push(engine);
  engine.initRoom();
  return engine;
}
function cast(engine: GameEngine, value: CardInstance, modes?: string[]) {
  engine.roomState.players.player1.hand.push(value);
  return engine.executePlayerAction('player1', 'cast_spell', { cardUuid: value.uuid, modes });
}
function resolve(engine: GameEngine) {
  expect(engine.resolveTopOfStack().success).toBe(true);
}
function choose(engine: GameEngine, selections: string[]) {
  const choice = engine.roomState.pendingChoice;
  expect(choice).toBeDefined();
  expect(engine.executePlayerAction(choice!.playerId, 'choose', { choiceId: choice!.id, choices: selections }).success).toBe(true);
}
function live(engine: GameEngine, value: CardInstance) {
  return engine.roomState.battlefield.find(item => item.uuid === value.uuid)!;
}

function attackWith(engine: GameEngine, value: CardInstance) {
  live(engine, value).state.summoningSickness = false;
  engine.roomState.phase = 'declareAttackersStep';
  engine.roomState.priorityPlayerId = null;
  expect(engine.executePlayerAction('player1', 'declare_attackers', {
    attackers: [{ cardUuid: value.uuid }],
  }).success).toBe(true);
}

describe('workbook expansion beyond blue', () => {
  it.each([
    'hera-ghostfire', 'phantom-ghostaxe', 'phantom-ghostfire', 'phantom-ghostfire-scythe', 'phantasm-altar',
    'phantom-dreamer', 'wind-spirit-hornblower-murad', 'wind-spirit-beast-wrath', 'beast-emperor-command',
    'wind-spirit-beast-son', 'wind-spirit-banner-namalan', 'wind-spirit-general-haer', 'wind-emperor-leon-galar',
    'frost-messenger', 'phantom-puppet-factory', 'wind-spirit-blade-wolf', 'ice-dragon-staff', 'aralarias-end',
    'archangel-ferrani', 'angel-empress-butterfly', 'hera-camp', 'hera-phantom-spell', 'ice-dragon-call', 'phantom-puppet-sage', 'phantom-demon-hera-nia',
    'wind-spirit-regrowth', 'phantom-puppet-legionnaire', 'death-assembly', 'sealed-aurora-dragon-statue',
    'aurora-shield', 'coldnest-lord-aleya', 'aurora-seal', 'aralarias-interception', 'icewind-guardian', 'northern-guide-lysandria', 'far-north-dragon-emperor-arthur',
    'far-north-crown', 'ice-ridge-lord', 'frostmoon-guardian', 'heavenly-divine-city', 'holy-energy-haste', 'heavenly-beast', 'heavenly-marquis-ivun', 'thunder-gate',
  ])('registers %s with a compiled ability or spell recipe', id => {
    const value = getBlueprint(id);
    expect(value.abilities.length + value.onCastEffects.length + (value.modes?.length ?? 0)).toBeGreaterThan(0);
  });

  it.each([false, true])('Frost Messenger orders the exact remainder (eligible Dragon: %s)', eligible => {
    const engine = game();
    const messenger = card('frost-messenger', 'hand');
    const outside = card('sea-depths', 'library');
    const candidate = card(eligible ? 'ice-ridge-lord' : 'sea-depths', 'library');
    const other = card('sea-patrol', 'library');
    const top = card('land-red', 'library');
    engine.roomState.players.player1.deck = [outside, other, candidate, top];
    expect(cast(engine, messenger).success).toBe(true);
    resolve(engine);
    resolve(engine);
    choose(engine, ['reveal']);
    if (eligible) choose(engine, [candidate.uuid]);

    const choice = engine.roomState.pendingChoice;
    if (choice?.kind !== 'ordering') throw new Error('Expected exact remainder ordering');
    const remainder = eligible ? [top.uuid, other.uuid] : [top.uuid, candidate.uuid, other.uuid];
    expect(choice.options.map(option => option.id)).toEqual(remainder);
    expect(choice.options.some(option => option.id === outside.uuid)).toBe(false);
    choose(engine, remainder);
    const remaining = engine.roomState.players.player1.deck.map(item => item.uuid);
    expect(remaining).toEqual(eligible
      ? [other.uuid, top.uuid, outside.uuid, candidate.uuid]
      : [other.uuid, candidate.uuid, top.uuid, outside.uuid]);
    if (eligible) {
      expect(engine.roomState.players.player1.deck.at(-1)?.state.zoneRevision ?? 0).toBe(candidate.state.zoneRevision ?? 0);
    }
    engine.applyMutations([{ type: 'DESTROY_CARD', cardUuid: messenger.uuid, zoneRevision: live(engine, messenger).state.zoneRevision ?? 0 }]);
    resolve(engine);
    expect(engine.roomState.players.player1.hand.map(item => item.uuid))
      .toEqual([eligible ? candidate.uuid : outside.uuid]);
  });

  it('Puppet Factory keeps its ordinary draw after the physical card spends the reveal option', () => {
    const engine = game();
    const factory = card('phantom-puppet-factory', 'hand');
    const outside = card('phantom-puppet', 'library');
    const puppets = ['phantom-puppet', 'phantom-ghostfire'].map(id => card(id, 'library'));
    const keep = ['sea-depths', 'land-red', 'sea-patrol'].map(id => card(id, 'library'));
    engine.roomState.players.player1.deck = [outside, ...keep, ...puppets];
    expect(cast(engine, factory).success).toBe(true);
    resolve(engine);
    resolve(engine);
    choose(engine, ['reveal-and-draw']);
    expect(engine.roomState.players.player1.graveyard.map(item => item.uuid)).toEqual(puppets.toReversed().map(item => item.uuid));
    choose(engine, keep.map(item => item.uuid));
    expect(engine.roomState.players.player1.hand.map(item => item.uuid)).toEqual([keep[0].uuid]);
    expect(engine.roomState.players.player1.deck.map(item => item.uuid)).toEqual([outside.uuid, keep[2].uuid, keep[1].uuid]);

    engine.applyMutations([
      { type: 'MOVE_CARD', cardUuid: factory.uuid, playerId: 'player1', from: 'battlefield', to: 'graveyard' },
      { type: 'MOVE_CARD', cardUuid: factory.uuid, playerId: 'player1', from: 'graveyard', to: 'battlefield' },
    ]);
    resolve(engine);
    const choice = engine.roomState.pendingChoice;
    if (choice?.kind !== 'options') throw new Error('Expected the ordinary draw option');
    expect(choice.options.map(option => option.id)).toEqual(['draw-one']);
    choose(engine, ['draw-one']);
    expect(engine.roomState.players.player1.hand.map(item => item.uuid)).toEqual([keep[0].uuid, keep[1].uuid]);
    expect(Object.values(engine.roomState.gameRuleUses ?? {})).toEqual([1]);
  });

  it('Blade Wolf deploys a land, then allows only distinct printed names from its reveal', () => {
    const engine = game();
    const wolf = card('wind-spirit-blade-wolf', 'hand');
    const land = card('beast-holy-land', 'hand');
    const duplicates = Array.from({ length: 2 }, () => card('wind-spirit-prophet', 'library'));
    const distinct = card('wind-spirit-beast-son', 'library');
    const outsiders = Array.from({ length: 3 }, () => card('sea-depths', 'library'));
    engine.roomState.players.player1.hand = [land, ...Array.from({ length: 3 }, () => card('sea-depths', 'hand'))];
    engine.roomState.players.player1.deck = [outsiders[0], ...duplicates, distinct, ...outsiders.slice(1)];
    expect(cast(engine, wolf).success).toBe(true);
    resolve(engine);
    resolve(engine);
    choose(engine, [land.uuid]);
    expect(live(engine, land).state.summonKind).toBe('effect');
    expect(engine.roomState.turnHistory?.landPlays?.player1 ?? 0).toBe(0);
    choose(engine, ['reveal']);

    const choice = engine.roomState.pendingChoice;
    if (choice?.kind !== 'search') throw new Error('Expected the distinct-name search');
    expect(choice.max).toBe(2);
    const ownView = buildChoiceView(engine.roomState, 'player1');
    expect(ownView?.kind).toBe('search');
    if (ownView?.kind !== 'search') throw new Error('Expected visible choices');
    const groups = ownView.options.map(option => option.distinctGroup);
    expect(new Set(groups).size).toBe(2);
    expect(groups.every(group => typeof group === 'string' && !group.includes('風靈'))).toBe(true);
    expect(buildChoiceView(engine.roomState, 'player2')).toEqual({ kind: 'waiting', playerId: 'player1' });
    expect(engine.executePlayerAction('player1', 'choose', {
      choiceId: choice.id, choices: duplicates.map(item => item.uuid),
    }).success).toBe(false);
    choose(engine, [duplicates[1].uuid, distinct.uuid]);
    choose(engine, [outsiders[2].uuid, duplicates[0].uuid, outsiders[1].uuid]);
    expect(engine.roomState.players.player1.hand.slice(-2).map(item => item.uuid)).toEqual([duplicates[1].uuid, distinct.uuid]);
    expect(engine.roomState.players.player1.deck.at(-1)?.uuid).toBe(outsiders[0].uuid);
  });

  it('Blade Wolf can reveal without a land and limits only that option for the turn', () => {
    const engine = game();
    const wolf = card('wind-spirit-blade-wolf', 'hand');
    engine.roomState.players.player1.deck = Array.from({ length: 5 }, () => card('sea-depths', 'library'));
    expect(cast(engine, wolf).success).toBe(true);
    resolve(engine);
    resolve(engine);
    choose(engine, []);
    choose(engine, ['reveal']);
    const ordering = engine.roomState.pendingChoice;
    if (ordering?.kind !== 'ordering') throw new Error('Expected ordering of the five revealed cards');
    choose(engine, ordering.options.map(option => option.id));
    const land = card('beast-holy-land', 'hand');
    engine.roomState.players.player1.hand = [land];
    engine.applyMutations([
      { type: 'MOVE_CARD', cardUuid: wolf.uuid, playerId: 'player1', from: 'battlefield', to: 'graveyard' },
      { type: 'MOVE_CARD', cardUuid: wolf.uuid, playerId: 'player1', from: 'graveyard', to: 'battlefield' },
    ]);
    resolve(engine);
    choose(engine, [land.uuid]);
    const choice = engine.roomState.pendingChoice;
    if (choice?.kind !== 'options') throw new Error('Expected a reveal-or-skip choice');
    expect(choice.options.map(option => option.id)).toEqual(['skip']);
    choose(engine, ['skip']);
    expect(live(engine, land).state.zone).toBe('battlefield');
  });

  it('Ice Dragon Staff grants attack and pays from its current equipped Dragon only', () => {
    const staff = card('ice-dragon-staff', 'battlefield');
    const first = card('frost-messenger', 'battlefield');
    const second = card('frost-messenger', 'battlefield');
    const enemy = card('sea-patrol', 'battlefield', 'player2');
    const engine = game(staff, first, second, enemy);
    const activate = (abilityId: string, target: CardInstance) => engine.executePlayerAction('player1', 'activate_ability', {
      cardUuid: staff.uuid, abilityId, targets: [{ targetType: 'permanent', cardUuid: target.uuid }],
    });
    const addCrystals = (target: CardInstance, amount: number) => engine.applyMutations([
      { type: 'ADD_COUNTER', cardUuid: target.uuid, counterType: 'ice-crystal', amount },
    ]);
    addCrystals(first, 1);
    expect(activate('ice-crystal-bounce', enemy).success).toBe(false);
    expect(activate('attach', first).success).toBe(true);
    resolve(engine);
    expect(CardCharacteristicService.resolvePower(engine.roomState, live(engine, first))).toBe(2);
    attackWith(engine, first);
    resolve(engine);
    expect(live(engine, first).state.counters['ice-crystal']).toBe(2);
    expect(live(engine, staff).state.counters['ice-crystal']).toBeUndefined();

    engine.roomState.phase = 'stateMainPhase';
    engine.roomState.priorityPlayerId = 'player1';
    expect(activate('attach', second).success).toBe(true);
    resolve(engine);
    expect(activate('ice-crystal-bounce', enemy).success).toBe(false);
    addCrystals(second, 2);
    expect(activate('ice-crystal-bounce', enemy).success).toBe(true);
    expect(live(engine, second).state.counters['ice-crystal'] ?? 0).toBe(0);
    expect(live(engine, first).state.counters['ice-crystal']).toBe(2);
    resolve(engine);
    expect(engine.roomState.players.player2.hand.map(item => item.uuid)).toContain(enemy.uuid);
  });

  it('Aralaria’s End exiles a charged emperor as payment, then destroys opposing creatures and relics', () => {
    const spell = card('aralarias-end', 'hand');
    const emperor = card('angel-emperor-aralaria', 'battlefield');
    const low = card('angel-emperor-aralaria', 'battlefield');
    const opposing = card('angel-emperor-aralaria', 'battlefield', 'player2');
    const creature = card('sea-patrol', 'battlefield', 'player2');
    const relic = card('flame-ballista', 'battlefield', 'player2');
    const equipment = card('ice-dragon-staff', 'battlefield', 'player2');
    emperor.state.counters.charge = 5;
    low.state.counters.charge = 4;
    opposing.state.counters.charge = 8;
    const engine = game(emperor, low, opposing, creature, relic, equipment);
    expect(cast(engine, spell).success).toBe(true);
    const choice = engine.roomState.pendingChoice;
    if (choice?.kind !== 'selection') throw new Error('Expected exile materials');
    expect(choice.options.map(option => option.id)).toEqual([emperor.uuid]);
    expect(engine.roomState.players.player1.mana.yellow).toBe(5);
    choose(engine, [emperor.uuid]);
    expect(engine.roomState.players.player1.exile?.map(value => value.uuid)).toEqual([emperor.uuid]);
    expect(engine.roomState.players.player1.mana.yellow).toBe(1);
    expect(Object.values(engine.roomState.gameRuleUses ?? {})).toEqual([1]);
    resolve(engine);
    expect(engine.roomState.players.player2.graveyard.map(value => value.uuid).sort())
      .toEqual([creature.uuid, relic.uuid].sort());
    expect(live(engine, equipment)).toBeDefined();
    expect(live(engine, opposing)).toBeDefined();
    expect(live(engine, low)).toBeDefined();

    live(engine, low).state.counters.charge = 5;
    engine.roomState.players.player1.mana.yellow = 5;
    engine.applyMutations([{ type: 'MOVE_CARD', cardUuid: spell.uuid, playerId: 'player1', from: 'graveyard', to: 'hand' }]);
    expect(engine.executePlayerAction('player1', 'cast_spell', { cardUuid: spell.uuid }).success).toBe(false);
    expect(live(engine, low)).toBeDefined();
    expect(engine.roomState.players.player1.mana.yellow).toBe(5);
  });

  it.each(['cancel_event', 'move_destination'] as const)('Aralaria’s End pays nothing when the emperor’s exile is replaced by %s', replacement => {
    const spell = card('aralarias-end', 'hand');
    const emperor = card('angel-emperor-aralaria', 'battlefield');
    emperor.state.counters.charge = 5;
    const engine = game(emperor);
    engine.roomState.replacementEffects = [{
      id: 'exile-replacement', label: 'Replace exile', uses: 1,
      match: { kinds: ['zone_transfer'], to: 'exile' },
      operation: replacement === 'cancel_event' ? { type: replacement } : { type: replacement, to: 'hand' },
    }];
    engine.roomState.players.player1.hand = [spell];
    const castWith = (zoneRevision: number) => engine.executePlayerAction('player1', 'cast_spell', {
      cardUuid: spell.uuid, materialPayments: [{ cardUuid: emperor.uuid, zoneRevision }],
    });
    expect(castWith(1).success).toBe(false);
    expect(castWith(0).success).toBe(false);
    expect(engine.roomState.players.player1.mana.yellow).toBe(5);
    expect(engine.roomState.players.player1.hand.map(value => value.uuid)).toEqual([spell.uuid]);
    expect(engine.roomState.stack).toHaveLength(0);
    expect(Object.values(engine.roomState.gameRuleUses ?? {})).toEqual([]);
    expect(live(engine, emperor).state.counters.charge).toBe(5);
    expect(engine.roomState.replacementEffects[0].uses).toBe(1);
  });

  it.each([false, true])('Butterfly heals after its actual hand discard (discard replaced: %s)', replaced => {
    const butterfly = card('angel-empress-butterfly', 'hand');
    const engine = game();
    engine.roomState.players.player1.hand = [butterfly];
    if (replaced) engine.roomState.replacementEffects = [{
      id: 'prevent-discard', label: 'Prevent discard', match: { kinds: ['discard'], from: 'hand' },
      operation: { type: 'cancel_event' },
    }];
    engine.applyMutations([{ type: 'SET_LIFE', playerId: 'player1', amount: 17 }]);
    resolve(engine);
    expect(engine.roomState.players.player1.life).toBe(replaced ? 17 : 22);
    expect(engine.roomState.players.player1.graveyard.map(value => value.uuid))
      .toEqual(replaced ? [] : [butterfly.uuid]);
  });

  it('Butterfly boosts allied healing without modifying a direct life setting', () => {
    const butterfly = card('angel-empress-butterfly', 'battlefield');
    const engine = game(butterfly);
    expect(cast(engine, card('holy-energy-haste', 'hand'), ['heal']).success).toBe(true);
    resolve(engine);
    expect(engine.roomState.players.player1.life).toBe(23);
    expect(cast(engine, card('archangel-ferrani', 'hand')).success).toBe(true);
    resolve(engine);
    resolve(engine);
    expect(engine.roomState.players.player1.life).toBe(30);
  });

  it.each(['player', 'damage', 'max-life'] as const)('Hera’s Camp shares one draw budget starting from %s', first => {
    const camp = card('hera-camp', 'battlefield');
    const target = card('abyss-giant', 'battlefield', 'player2');
    const engine = game(camp, target);
    const changes = {
      player: () => engine.applyMutations([{ type: 'SET_LIFE', playerId: 'player2', amount: 19 }]),
      damage: () => engine.applyMutations(planDamage(engine.roomState, [{
        source: captureSourceInformation(engine.roomState, camp),
        recipient: { kind: 'permanent', cardUuid: target.uuid, zoneRevision: 0 },
        amount: 1, combat: false,
      }])),
      'max-life': () => engine.applyMutations([{ type: 'ADD_CONTINUOUS_EFFECT', entry: {
        source: 'fixture', layer: 7, scope: { cardUuid: target.uuid }, requiredZone: null, duration: 'PERMANENT',
        effect: { type: 'STAT_DELTA', toughness: -1 },
      } }]),
    };
    changes[first]();
    expect(engine.roomState.stack).toHaveLength(1);
    for (const [type, apply] of Object.entries(changes)) if (type !== first) apply();
    expect(engine.roomState.stack).toHaveLength(1);
    resolve(engine);
    expect(engine.roomState.players.player1.hand).toHaveLength(1);
    expect(engine.executePlayerAction('player1', 'activate_ability', {
      cardUuid: camp.uuid, abilityId: 'tap-to-draw',
    }).success).toBe(true);
    resolve(engine);
    expect(engine.roomState.players.player1.hand).toHaveLength(2);
  });

  it.each([false, true])('Hera’s Phantom Spell uses printed cost and the own-main ceiling (%s)', main => {
    const engine = game();
    const low = card('phantom-puppet', 'graveyard');
    const medium = card('phantom-puppet-legionnaire', 'graveyard');
    const high = card('phantom-puppet-legionnaire', 'graveyard');
    high.blueprint = {
      ...high.blueprint,
      castRequirements: { ...high.blueprint.castRequirements, cost: { mana: { black: 6 } } },
    };
    engine.roomState.players.player1.graveyard = [low, medium, high];
    engine.applyMutations([{ type: 'ADD_CONTINUOUS_EFFECT', entry: {
      source: 'fixture', layer: 8, scope: { cardUuid: high.uuid, zones: ['graveyard'] },
      requiredZone: null, duration: 'PERMANENT', effect: { type: 'MANA_COST', mana: {} },
    } }]);
    expect(CardCharacteristicService.resolveManaValue(engine.roomState, high)).toBe(0);
    if (!main) engine.roomState.phase = 'beginCombatStep';
    expect(cast(engine, card('hera-phantom-spell', 'hand')).success).toBe(true);
    resolve(engine);
    const choice = engine.roomState.pendingChoice;
    if (choice?.kind !== 'search') throw new Error('Expected the Puppet search');
    expect(choice.options.map(option => option.id)).toEqual(main ? [low.uuid, medium.uuid] : [low.uuid]);
    const chosen = main ? medium : low;
    choose(engine, [chosen.uuid]);
    expect(live(engine, chosen).state.summonKind).toBe('effect');
  });

  it.each([false, true])('Ice Dragon Call reads a fresh window for at most one repeat (%s)', repeat => {
    const onBoard = card('ice-ridge-lord', 'battlefield', 'player2');
    const engine = repeat ? game(onBoard) : game();
    const [first, second] = ['ice-ridge-lord', 'frost-messenger'].map(id => card(id, 'library'));
    const [deep, spare, firstTop, firstBottom] = Array.from({ length: 4 }, () => card('sea-depths', 'library'));
    engine.roomState.players.player1.deck = [deep, second, spare, firstBottom, first, firstTop];
    expect(cast(engine, card('ice-dragon-call', 'hand')).success).toBe(true);
    resolve(engine);
    choose(engine, [first.uuid]);
    choose(engine, [firstTop.uuid, firstBottom.uuid]);
    if (repeat) {
      choose(engine, [second.uuid]);
      choose(engine, [spare.uuid, deep.uuid]);
    }
    expect(engine.roomState.pendingChoice).toBeFalsy();
    expect(engine.roomState.players.player1.hand.map(value => value.uuid))
      .toEqual(repeat ? [first.uuid, second.uuid] : [first.uuid]);
    const reveals = engine.drainEventBatches().flatMap(batch => batch.events).filter(event => event.eventId === 'CARD_REVEALED');
    expect(reveals).toHaveLength(repeat ? 6 : 3);
  });

  it('Puppet Sage counts three allies and applies its attack bonus only once across copies', () => {
    const first = card('phantom-puppet-sage', 'battlefield');
    const second = card('phantom-puppet-sage', 'battlefield');
    const puppet = card('phantom-puppet', 'battlefield');
    const ally = card('phantom-puppet', 'battlefield');
    const enemy = card('phantom-puppet', 'battlefield', 'player2');
    const engine = game(first, second, puppet, ally, enemy);
    const power = (value: CardInstance) => CardCharacteristicService.resolvePower(engine.roomState, live(engine, value));
    const remove = (value: CardInstance) => engine.applyMutations([
      { type: 'MOVE_CARD', cardUuid: value.uuid, playerId: 'player1', from: 'battlefield', to: 'graveyard' },
    ]);
    expect(power(puppet)).toBe(2);
    engine.applyMutations([{ type: 'SET_PHASE', phase: 'beginCombatStep' }]);
    expect(power(puppet)).toBe(3);
    expect(power(first)).toBe(6);
    expect(power(enemy)).toBe(2);
    remove(first);
    expect(power(puppet)).toBe(3);
    const graveSage = engine.roomState.players.player1.graveyard.find(value => value.uuid === first.uuid)!;
    expect(CardCharacteristicService.resolveManaValue(engine.roomState, graveSage)).toBe(3);
    remove(ally);
    expect(power(puppet)).toBe(2);
    expect(CardCharacteristicService.resolveManaValue(engine.roomState, live(engine, second))).toBe(6);
  });

  it.each([4, 9])('Aurora Shield caps combined life loss from simultaneous damage (starting life %s)', startingLife => {
    const attacker = card('abyss-giant', 'battlefield', 'player2');
    const engine = game(attacker);
    engine.applyMutations([{ type: 'SET_LIFE', playerId: 'player1', amount: startingLife }]);
    expect(cast(engine, card('aurora-shield', 'hand')).success).toBe(true);
    resolve(engine);
    const source = captureSourceInformation(engine.roomState, attacker);
    engine.applyMutations(planDamage(engine.roomState, [1, 2, 3].map(() => ({
      source, recipient: { kind: 'player', playerId: 'player1' }, amount: 3, combat: true,
    }))));
    const protectedLife = Math.min(startingLife, 5);
    expect(engine.roomState.players.player1.life).toBe(protectedLife);
    engine.applyMutations([{ type: 'SET_LIFE', playerId: 'player1', amount: 1 }]);
    expect(engine.roomState.players.player1.life).toBe(protectedLife);
    engine.applyMutations([{ type: 'CLEAR_END_OF_TURN_EFFECTS' }, { type: 'CHANGE_LIFE', playerId: 'player1', amount: -1 }]);
    expect(engine.roomState.players.player1.life).toBe(protectedLife - 1);
  });

  it('Aleya protects both players through end-of-combat responses and charges on friendly Dragon entries', () => {
    const aleya = card('coldnest-lord-aleya', 'battlefield');
    aleya.state.counters.charge = 3;
    const engine = game(aleya);
    const friendly = card('ice-ridge-lord', 'hand');
    const opposing = card('ice-ridge-lord', 'hand', 'player2');
    engine.roomState.players.player1.hand = [friendly];
    engine.roomState.players.player2.hand = [opposing];
    engine.applyMutations([friendly, opposing].map(value => ({
      type: 'MOVE_CARD', cardUuid: value.uuid, playerId: value.state.ownerId, from: 'hand', to: 'battlefield',
    })));
    expect(engine.roomState.stack).toHaveLength(1);
    resolve(engine);
    expect(live(engine, aleya).state.counters.charge).toBe(4);
    const activate = () => engine.executePlayerAction('player1', 'activate_ability', {
      cardUuid: aleya.uuid, abilityId: 'guard-both-players',
    });
    expect(activate().success).toBe(false);
    expect(live(engine, aleya).state.counters.charge).toBe(4);

    engine.applyMutations([{ type: 'SET_PHASE', phase: 'beginCombatStep' }]);
    expect(activate().success).toBe(true);
    resolve(engine);
    expect(live(engine, aleya).state.counters.charge ?? 0).toBe(0);
    const loss = ['player1', 'player2'].map(playerId => ({ type: 'CHANGE_LIFE' as const, playerId, amount: -2 }));
    engine.applyMutations([{ type: 'SET_PHASE', phase: 'endCombatStep' }, ...loss]);
    expect(Object.values(engine.roomState.players).map(player => player.life)).toEqual([20, 20]);
    const state = new StateMachine(engine.roomState);
    engine.applyMutations(state.transition(engine.roomState, 'postcombatMainPhase'));
    engine.applyMutations(loss);
    expect(Object.values(engine.roomState.players).map(player => player.life)).toEqual([18, 18]);
  });

  it.each([false, true])('Aurora Seal follows the exact source incarnation (left and returned: %s)', returned => {
    const creature = card('card_09876_core_set', 'battlefield', 'player2');
    const engine = game(creature);
    engine.roomState.priorityPlayerId = 'player2';
    expect(engine.executePlayerAction('player2', 'activate_ability', {
      cardUuid: creature.uuid, abilityId: 'firebreathing',
    }).success).toBe(true);
    const pending = engine.roomState.stack[0].uuid;
    if (returned) engine.applyMutations([
      { type: 'MOVE_CARD', cardUuid: creature.uuid, playerId: 'player2', from: 'battlefield', to: 'exile' },
      { type: 'MOVE_CARD', cardUuid: creature.uuid, playerId: 'player2', from: 'exile', to: 'battlefield' },
    ]);
    engine.passPriority('player2');
    const seal = card('aurora-seal', 'hand');
    engine.roomState.players.player1.hand = [seal];
    expect(engine.executePlayerAction('player1', 'cast_spell', {
      cardUuid: seal.uuid, targets: [{ targetType: 'stack', stackUuid: pending }],
    }).success).toBe(true);
    resolve(engine);
    expect(engine.roomState.stack).toHaveLength(0);
    expect(!!live(engine, creature)).toBe(returned);
    expect(engine.roomState.players.player2.deck[0]?.uuid === creature.uuid).toBe(!returned);
  });

  it.each(['hand', 'battlefield'] as const)('Interception removes an opposing ability and its live %s source', zone => {
    const source = card('card_09876_core_set', zone, 'player2');
    const original = source.blueprint.abilities.find(ability => ability.id === 'firebreathing');
    if (original?.type !== 'activated') throw new Error('Expected activated ability');
    source.blueprint = { ...source.blueprint, abilities: [{ ...original, allowedZones: [zone] }] };
    const engine = zone === 'battlefield' ? game(source) : game();
    if (zone === 'hand') engine.roomState.players.player2.hand = [source];
    engine.roomState.priorityPlayerId = 'player2';
    expect(engine.executePlayerAction('player2', 'activate_ability', {
      cardUuid: source.uuid, abilityId: 'firebreathing',
    }).success).toBe(true);
    const pending = engine.roomState.stack[0].uuid;
    engine.passPriority('player2');
    const interception = card('aralarias-interception', 'hand');
    engine.roomState.players.player1.hand = [interception];
    expect(engine.executePlayerAction('player1', 'cast_spell', {
      cardUuid: interception.uuid, targets: [{ targetType: 'stack', stackUuid: pending }],
    }).success).toBe(true);
    engine.drainEventBatches();
    resolve(engine);
    expect(engine.roomState.stack).toHaveLength(0);
    expect(engine.roomState.players.player2.graveyard.map(value => value.uuid)).toContain(source.uuid);
    const events = engine.drainEventBatches().flatMap(batch => batch.events);
    expect(events.some(event => event.eventId === (zone === 'hand' ? 'CARD_DISCARDED_FROM_HAND' : 'PERMANENT_DESTROYED'))).toBe(true);
  });

  it('Interception counters a pending effect without a live source card', () => {
    const engine = game();
    const source = card('card_09876_core_set', 'battlefield', 'player2');
    engine.applyMutations([{ type: 'PUSH_STACK', stackObject: {
      uuid: 'source-less-effect', type: 'triggered', source, controllerId: 'player2', effects: [], countered: false,
    } }]);
    const interception = card('aralarias-interception', 'hand');
    engine.roomState.players.player1.hand = [interception];
    expect(engine.executePlayerAction('player1', 'cast_spell', {
      cardUuid: interception.uuid, targets: [{ targetType: 'stack', stackUuid: 'source-less-effect' }],
    }).success).toBe(true);
    resolve(engine);
    expect(engine.roomState.stack).toHaveLength(0);
    expect(engine.roomState.players.player2.graveyard).toHaveLength(0);
  });

  it.each([false, true])('Icewind Guardian redirects the original target if still on the battlefield (%s leaves)', leaves => {
    const dragon = card('ice-ridge-lord', 'battlefield');
    const guardian = card('icewind-guardian', 'hand');
    const engine = game(dragon);
    expect(cast(engine, guardian).success).toBe(true);
    resolve(engine);
    resolve(engine);
    expect(live(engine, guardian).state.counters.aurora).toBe(1);

    const spell = card('fireball', 'hand', 'player2');
    engine.roomState.activeTurnPlayerId = 'player2';
    engine.roomState.priorityPlayerId = 'player2';
    engine.roomState.players.player2.hand = [spell];
    expect(engine.executePlayerAction('player2', 'cast_spell', {
      cardUuid: spell.uuid, modes: ['main-scorch'], targets: [{ targetType: 'permanent', cardUuid: dragon.uuid }],
    }).success).toBe(true);
    expect(engine.roomState.stack.map(object => object.type)).toEqual(['spell', 'triggered']);
    if (leaves) engine.applyMutations([
      { type: 'MOVE_CARD', cardUuid: guardian.uuid, playerId: 'player1', from: 'battlefield', to: 'exile' },
    ]);
    resolve(engine);
    if (!leaves) choose(engine, ['yes']);
    expect(engine.roomState.pendingChoice).toBeFalsy();
    const target = engine.roomState.stack[0].targetGroups?.[0].targets[0];
    expect(target?.cardUuid).toBe(leaves ? dragon.uuid : guardian.uuid);
    resolve(engine);
    expect(live(engine, dragon).state.counters.scorch ?? 0).toBe(leaves ? 2 : 0);
    if (!leaves) expect(live(engine, guardian).state.counters.scorch).toBe(2);
  });

  it('Lysandria can enter from hand after an Aurora-marked creature leaves and take both revealed categories', () => {
    const marked = card('ice-ridge-lord', 'battlefield');
    const unmarked = card('frost-messenger', 'battlefield');
    const guide = card('northern-guide-lysandria', 'hand');
    marked.state.counters.aurora = 1;
    const engine = game(marked, unmarked);
    engine.roomState.players.player1.hand = [guide];
    const dragon = card('icewind-guardian', 'library');
    const relic = card('flame-ballista', 'library');
    relic.blueprint = { ...relic.blueprint, colors: ['white'] };
    const equipment = card('ice-dragon-staff', 'library');
    const outside = card('frost-messenger', 'library');
    engine.roomState.players.player1.deck = [outside, relic, equipment, dragon];
    const exile = (value: CardInstance) => engine.applyMutations([
      { type: 'MOVE_CARD', cardUuid: value.uuid, playerId: 'player1', from: 'battlefield', to: 'exile' },
    ]);
    exile(unmarked);
    expect(engine.roomState.stack).toHaveLength(0);
    exile(marked);
    resolve(engine);
    choose(engine, ['yes']);
    expect(live(engine, guide).state.summonKind).toBe('effect');
    resolve(engine);
    choose(engine, ['reveal']);
    choose(engine, [dragon.uuid]);
    const relicChoice = engine.roomState.pendingChoice;
    if (relicChoice?.kind !== 'search') throw new Error('Expected relic choice');
    expect(relicChoice.options.map(option => option.id)).toEqual([relic.uuid]);
    choose(engine, [relic.uuid]);
    choose(engine, [equipment.uuid]);
    expect(engine.roomState.players.player1.hand.map(value => value.uuid)).toEqual([dragon.uuid, relic.uuid]);
    expect(engine.roomState.players.player1.deck.map(value => value.uuid)).toEqual([equipment.uuid, outside.uuid]);
  });

  it('Arthur gives each friendly Ice Dragon its own target and follows actual creature damage with half rounded down', () => {
    const ally = card('frost-messenger', 'battlefield');
    const opposingDragon = card('icewind-guardian', 'battlefield', 'player2');
    const first = card('abyss-giant', 'battlefield', 'player2');
    const second = card('abyss-giant', 'battlefield', 'player2');
    const arthur = card('far-north-dragon-emperor-arthur', 'hand');
    const engine = game(ally, opposingDragon, first, second);
    engine.applyMutations([{ type: 'ADD_REPLACEMENT_EFFECT', effect: {
      label: 'Reduce one hit', match: { kinds: ['damage'], card: { cardUuid: second.uuid, zoneRevision: 0 } },
      operation: { type: 'reduce_damage', amount: 2 },
    } }]);
    expect(cast(engine, arthur).success).toBe(true);
    resolve(engine);
    const target = (value: CardInstance) => {
      const choice = engine.roomState.pendingChoice;
      if (choice?.kind !== 'targets') throw new Error('Expected a separate summon target');
      expect(choice.options).toHaveLength(3);
      const option = choice.options.find(option => (option.value as { cardUuid: string }).cardUuid === value.uuid);
      expect(option).toBeDefined();
      choose(engine, [option!.id]);
    };
    target(first);
    target(second);
    expect(engine.roomState.pendingChoice).toBeFalsy();
    expect(engine.roomState.stack.map(object => object.targetGroups?.[0].targets[0].cardUuid))
      .toEqual([first.uuid, second.uuid]);
    resolve(engine);
    expect(live(engine, second).state.damageTaken).toBe(3);
    resolve(engine);
    expect(engine.roomState.players.player2.life).toBe(19);
    expect(engine.roomState.stack).toHaveLength(1);
    resolve(engine);
    expect(live(engine, first).state.damageTaken).toBe(5);
    resolve(engine);
    expect(engine.roomState.players.player2.life).toBe(17);
    expect(engine.roomState.stack).toHaveLength(0);

    engine.applyMutations(planDamage(engine.roomState, [{
      source: captureSourceInformation(engine.roomState, live(engine, arthur)),
      recipient: { kind: 'player', playerId: 'player2' }, amount: 4, combat: false,
    }]));
    expect(engine.roomState.players.player2.life).toBe(13);
    expect(engine.roomState.stack).toHaveLength(0);
  });

  it('Hera Nia can pay to summon after an effect mills it and uses the settled mana value of its own mill', () => {
    const opponent = card('abyss-giant', 'battlefield', 'player2');
    const engine = game(opponent);
    const hera = card('phantom-demon-hera-nia', 'library');
    const sage = card('phantom-puppet-sage', 'library');
    engine.roomState.players.player1.deck.push(sage, hera);
    const before = CardCharacteristicService.resolveToughness(engine.roomState, opponent);
    expect(cast(engine, card('phantom-ghostfire', 'hand')).success).toBe(true);
    resolve(engine);
    resolve(engine);
    choose(engine, ['yes']);
    resolve(engine);
    choose(engine, ['summon']);
    choose(engine, ['yes']);
    expect(engine.roomState.players.player1.mana.black).toBe(1);
    expect(live(engine, hera).state.summonKind).toBe('effect');
    resolve(engine);
    const choice = engine.roomState.pendingChoice;
    if (choice?.kind !== 'selection') throw new Error('Expected one opposing creature');
    const option = choice.options.find(option => (option.value as { cardUuid: string }).cardUuid === opponent.uuid);
    choose(engine, [option!.id]);
    expect(engine.roomState.players.player1.graveyard.map(value => value.uuid)).toContain(sage.uuid);
    expect(CardCharacteristicService.resolveToughness(engine.roomState, live(engine, opponent))).toBe(before - 3);
    engine.applyMutations([{ type: 'CLEAR_END_OF_TURN_EFFECTS' }]);
    expect(CardCharacteristicService.resolveToughness(engine.roomState, live(engine, opponent))).toBe(before);
  });

  it('Hera Nia returns after an effect discards it from hand', () => {
    const engine = game();
    const hera = card('phantom-demon-hera-nia', 'hand');
    engine.roomState.players.player1.hand = [hera];
    expect(cast(engine, card('wind-spirit-regrowth', 'hand'), ['replace-hand']).success).toBe(true);
    resolve(engine);
    resolve(engine);
    choose(engine, ['return']);
    expect(engine.roomState.players.player1.hand.map(value => value.uuid)).toContain(hera.uuid);
  });

  it('Hera Nia stays discarded when it pays a cost during an effect', () => {
    const engine = game();
    const hera = card('phantom-demon-hera-nia', 'hand');
    const spell = card('aurora-shield', 'hand');
    spell.blueprint = { ...spell.blueprint, onCastEffects: [{
      action: 'PAY_COST', params: { cost: { discard: 1 }, then: [] },
      targeting: { type: 'self', required: false },
    }] };
    engine.roomState.players.player1.hand = [hera];
    expect(cast(engine, spell).success).toBe(true);
    resolve(engine);
    choose(engine, ['yes']);
    const choice = engine.roomState.pendingChoice;
    if (choice?.kind !== 'discard') throw new Error('Expected a discard payment');
    choose(engine, choice.options.map(option => option.id));
    expect(engine.roomState.players.player1.graveyard.map(value => value.uuid)).toContain(hera.uuid);
    expect(engine.roomState.stack).toHaveLength(0);
  });

  it('Ferrani sets life once for the physical card and rounds down his combat bonus', () => {
    const ferrani = card('archangel-ferrani', 'hand');
    const engine = game();
    expect(cast(engine, ferrani).success).toBe(true);
    resolve(engine);
    resolve(engine);
    expect(engine.roomState.players.player1.life).toBe(30);
    engine.applyMutations([{ type: 'SET_LIFE', playerId: 'player1', amount: 23 }]);
    engine.applyMutations([
      { type: 'MOVE_CARD', cardUuid: ferrani.uuid, playerId: 'player1', from: 'battlefield', to: 'graveyard' },
      { type: 'MOVE_CARD', cardUuid: ferrani.uuid, playerId: 'player1', from: 'graveyard', to: 'battlefield' },
    ]);
    expect(engine.roomState.stack).toHaveLength(0);
    expect(engine.roomState.players.player1.life).toBe(23);
    attackWith(engine, ferrani);
    resolve(engine);
    expect(CardCharacteristicService.resolvePower(engine.roomState, live(engine, ferrani))).toBe(10);
    engine.applyMutations([{ type: 'SET_LIFE', playerId: 'player1', amount: 20 }]);
    engine.applyMutations([{ type: 'SET_PHASE', phase: 'endCombatStep' }]);
    expect(CardCharacteristicService.resolvePower(engine.roomState, live(engine, ferrani))).toBe(10);
    engine.applyMutations([{ type: 'CLEAR_COMBAT' }]);
    expect(CardCharacteristicService.resolvePower(engine.roomState, live(engine, ferrani))).toBe(2);
  });

  it('Wind Spirit Regrowth replaces the hand using the opposing hand size at resolution', () => {
    const engine = game();
    const old = card('sea-depths', 'hand');
    engine.roomState.players.player1.hand = [old];
    engine.roomState.players.player2.hand = [card('sea-depths', 'hand', 'player2')];
    expect(cast(engine, card('wind-spirit-regrowth', 'hand'), ['replace-hand']).success).toBe(true);
    engine.roomState.players.player2.hand.push(card('sea-depths', 'hand', 'player2'));
    resolve(engine);
    expect(engine.roomState.players.player1.graveyard.map(item => item.uuid)).toContain(old.uuid);
    expect(engine.roomState.players.player1.hand).toHaveLength(2);
  });

  it('Wind Spirit Regrowth boosts a friendly creature only during the current combat', () => {
    const ally = card('phantom-puppet-legionnaire', 'battlefield');
    const engine = game(ally);
    engine.roomState.phase = 'beginCombatStep';
    const regrowth = card('wind-spirit-regrowth', 'hand');
    engine.roomState.players.player1.hand = [regrowth];
    expect(engine.executePlayerAction('player1', 'cast_spell', {
      cardUuid: regrowth.uuid, modes: ['combat-boost'], targets: [{ targetType: 'permanent', cardUuid: ally.uuid }],
    }).success).toBe(true);
    resolve(engine);
    expect(CardCharacteristicService.resolvePower(engine.roomState, live(engine, ally))).toBe(4);
    engine.applyMutations([{ type: 'CLEAR_COMBAT' }]);
    expect(CardCharacteristicService.resolvePower(engine.roomState, live(engine, ally))).toBe(3);
  });

  it.each([false, true])('Legionnaire gains four attack only after deploying its selected Puppet (%s)', deploy => {
    const legionnaire = card('phantom-puppet-legionnaire', 'battlefield');
    const puppet = card('phantom-puppet', 'graveyard');
    const engine = game(legionnaire);
    engine.roomState.players.player1.graveyard = [puppet, card('sea-patrol', 'graveyard')];
    attackWith(engine, legionnaire);
    resolve(engine);
    choose(engine, deploy ? [puppet.uuid] : []);
    expect(live(engine, puppet)?.state.summonKind).toBe(deploy ? 'effect' : undefined);
    expect(CardCharacteristicService.resolvePower(engine.roomState, live(engine, legionnaire))).toBe(deploy ? 7 : 3);
    engine.applyMutations([{ type: 'CLEAR_COMBAT' }]);
    expect(CardCharacteristicService.resolvePower(engine.roomState, live(engine, legionnaire))).toBe(3);
  });

  it.each([false, true])('Death Assembly requires three successful destructions (%s protected)', protect => {
    const puppets = Array.from({ length: 3 }, () => card('phantom-puppet', 'battlefield'));
    const engine = game(...puppets);
    const assembly = card('death-assembly', 'hand');
    engine.roomState.players.player1.hand = [assembly];
    expect(engine.executePlayerAction('player1', 'cast_spell', {
      cardUuid: assembly.uuid, targets: puppets.map(value => ({ targetType: 'permanent', cardUuid: value.uuid })),
    }).success).toBe(true);
    if (protect) engine.applyMutations([{ type: 'ADD_CONTINUOUS_EFFECT', entry: {
      source: 'test', requiredZone: null, scope: { cardUuid: puppets[0].uuid }, layer: 6,
      duration: 'END_OF_TURN', effect: { type: 'ABILITY', addKeywords: ['Indestructible'] },
    } }]);
    resolve(engine);
    const tokens = engine.roomState.battlefield.filter(item => item.isToken);
    expect(tokens).toHaveLength(protect ? 0 : 1);
    expect(engine.roomState.players.player1.graveyard.filter(item => item.blueprint.id === 'phantom-puppet'))
      .toHaveLength(protect ? 2 : 3);
    if (protect) return;
    const [token] = tokens;
    expect(token.blueprint).toMatchObject({ id: 'token-phantom-stitch-monster', power: 7, toughness: 6 });
    attackWith(engine, token);
    resolve(engine);
    choose(engine, [puppets[0].uuid]);
    expect(live(engine, puppets[0]).state.summonKind).toBe('effect');
  });

  it('a sealed Statue opens at three friendly Aurora placements and closes again below three', () => {
    const statue = card('sealed-aurora-dragon-statue', 'battlefield');
    const enemy = card('sea-patrol', 'battlefield', 'player2');
    const engine = game(statue, enemy);
    const flags = () => buildCardView(engine.roomState, 'player1', live(engine, statue));
    const placeAurora = (playerId: string, amount: number) => engine.applyMutations([{
      type: 'ADD_COUNTER', cardUuid: enemy.uuid, counterType: 'aurora', amount, sourceControllerId: playerId,
    }]);
    expect(flags()).toMatchObject({ canAttack: false, canBlock: false });
    placeAurora('player2', 1);
    expect(engine.roomState.stack).toHaveLength(0);
    for (const amount of [2, 1, 1]) {
      placeAurora('player1', amount);
      resolve(engine);
    }
    expect(live(engine, statue).state.counters['ice-crystal']).toBe(3);
    expect(flags()).toMatchObject({ canAttack: true, canBlock: true });
    engine.applyMutations([{ type: 'REMOVE_COUNTER', cardUuid: statue.uuid, counterType: 'ice-crystal', amount: 1 }]);
    expect(flags()).toMatchObject({ canAttack: false, canBlock: false });

    engine.roomState.phase = 'declareAttackersStep';
    engine.roomState.priorityPlayerId = null;
    expect(engine.executePlayerAction('player1', 'declare_attackers', { attackers: [{ cardUuid: statue.uuid }] }).success).toBe(false);
    engine.roomState.activeTurnPlayerId = 'player2';
    expect(engine.executePlayerAction('player2', 'declare_attackers', { attackers: [{ cardUuid: enemy.uuid }] }).success).toBe(true);
    engine.roomState.phase = 'declareBlockersStep';
    engine.roomState.priorityPlayerId = null;
    const block = () => engine.executePlayerAction('player1', 'declare_blockers', {
      assignments: [{ attackerUuid: enemy.uuid, blockerUuids: [statue.uuid] }],
    });
    expect(block().success).toBe(false);
    engine.applyMutations([{ type: 'ADD_COUNTER', cardUuid: statue.uuid, counterType: 'ice-crystal', amount: 1 }]);
    expect(block().success).toBe(true);
  });

  it('uses real source-scoped exile for Hera Ghostfire and keeps the reduction on survivors', () => {
    const victim = card('sea-patrol', 'battlefield', 'player2');
    const survivor = card('abyss-giant', 'battlefield', 'player2');
    const engine = game(victim, survivor);
    expect(cast(engine, card('hera-ghostfire', 'hand')).success).toBe(true);
    resolve(engine);
    expect(engine.roomState.players.player2.exile?.map(item => item.uuid)).toEqual([victim.uuid]);
    engine.applyMutations([{ type: 'CLEAR_END_OF_TURN_EFFECTS' }]);
    expect(CardCharacteristicService.resolveToughness(engine.roomState, live(engine, survivor))).toBe(6);
  });

  it('the production Ghostfire recovers only the card it just milled', () => {
    const engine = game();
    const recent = card('hera-ghostfire', 'library');
    const older = card('hera-ghostfire', 'graveyard');
    engine.roomState.players.player1.deck.push(recent);
    engine.roomState.players.player1.graveyard.push(older);
    expect(cast(engine, card('phantom-ghostfire', 'hand')).success).toBe(true);
    resolve(engine);
    resolve(engine);
    choose(engine, ['yes']);
    const choice = engine.roomState.pendingChoice;
    if (!choice || choice.kind === 'number') throw new Error('Expected a search choice');
    expect(choice.options.map(option => option.id)).toEqual([recent.uuid]);
    choose(engine, [recent.uuid]);
    expect(engine.roomState.players.player1.hand.map(item => item.uuid)).toEqual([recent.uuid]);
  });

  it('Phantasm Altar enters tapped before any entry trigger can resolve', () => {
    const engine = game();
    const altar = card('phantasm-altar', 'hand');
    const regular = card('land-red', 'hand');
    engine.roomState.players.player1.hand.push(altar, regular);
    expect(engine.executePlayerAction('player1', 'play_land', { cardUuid: regular.uuid, zoneRevision: 0 }).success).toBe(true);
    engine.roomState.players.player1.mana.black = 1;
    expect(engine.executePlayerAction('player1', 'play_land', { cardUuid: altar.uuid, zoneRevision: 0 }).success).toBe(false);
    engine.roomState.players.player1.mana.black = 2;
    engine.drainEventBatches();
    expect(engine.executePlayerAction('player1', 'play_land', { cardUuid: altar.uuid, zoneRevision: 0 }).success).toBe(true);
    expect(engine.roomState.players.player1.mana.black).toBe(0);
    expect(engine.roomState.turnHistory?.landPlays?.player1).toBe(1);
    expect(live(engine, altar).state.isTapped).toBe(true);
    const events = engine.drainEventBatches().flatMap(batch => batch.events);
    expect(events.find(event => event.eventId === 'PERMANENT_ENTERED')?.payload.card.state.isTapped).toBe(true);
    expect(events.some(event => event.eventId === 'PERMANENT_TAPPED')).toBe(false);
    expect(engine.roomState.stack).toHaveLength(1);
  });

  it('offers Phantom Dreamer after the turn draw, and pays life for a separate draw', () => {
    const dreamer = card('phantom-dreamer', 'battlefield');
    const engine = game(dreamer);
    engine.roomState.phase = 'upkeepStep';
    engine.roomState.turnNumber = 2;
    const step = new StateMachine(engine.roomState).transition(engine.roomState, 'stateDrawPhase');
    engine.applyMutations(step);
    expect(engine.roomState.players.player1.hand).toHaveLength(1);
    expect(engine.roomState.stack[0]?.source.uuid).toBe(dreamer.uuid);
    resolve(engine);
    choose(engine, ['yes']);
    expect(engine.roomState.players.player1.life).toBe(18);
    expect(engine.roomState.players.player1.hand).toHaveLength(2);
  });

  it('draws from the bottom through the sorcery mode and keeps the top card in place', () => {
    const engine = game();
    const bottom = engine.roomState.players.player1.deck[0].uuid;
    const top = engine.roomState.players.player1.deck.at(-1)!.uuid;
    expect(cast(engine, card('holy-energy-haste', 'hand'), ['bottom-draw']).success).toBe(true);
    resolve(engine);
    expect(engine.roomState.players.player1.hand.map(item => item.uuid)).toEqual([bottom]);
    expect(engine.roomState.players.player1.deck.at(-1)?.uuid).toBe(top);
  });

  it('supports taking all revealed spells and exiling only the remaining revealed cards', () => {
    const engine = game();
    const outside = card('sea-depths', 'library');
    const spells = Array.from({ length: 3 }, () => card('sea-depths', 'library'));
    const lands = Array.from({ length: 5 }, () => card('sea-domain', 'library'));
    engine.roomState.players.player1.deck = [outside, ...spells, ...lands];
    expect(cast(engine, card('heavenly-marquis-ivun', 'hand')).success).toBe(true);
    resolve(engine);
    resolve(engine);
    expect(new Set(engine.roomState.players.player1.hand.map(item => item.uuid))).toEqual(new Set(spells.map(item => item.uuid)));
    expect(new Set(engine.roomState.players.player1.exile?.map(item => item.uuid))).toEqual(new Set(lands.map(item => item.uuid)));
    expect(engine.roomState.players.player1.deck.map(item => item.uuid)).toEqual([outside.uuid]);
  });

  it('healing triggers Thunder Gate once and creates a vanilla 上使', () => {
    const gate = card('thunder-gate', 'battlefield');
    const engine = game(gate);
    engine.applyMutations([{ type: 'SET_LIFE', playerId: 'player1', amount: 21 }]);
    resolve(engine);
    const tokens = () => engine.roomState.battlefield.filter(value => value.isToken);
    expect(tokens()).toHaveLength(1);
    expect(tokens()[0].blueprint).toMatchObject({ power: 1, toughness: 1, subTypes: ['上使'], abilities: [] });
    engine.applyMutations([{ type: 'SET_LIFE', playerId: 'player1', amount: 22 }]);
    expect(engine.roomState.stack).toHaveLength(0);
    expect(tokens()).toHaveLength(1);
  });

  it('a named reveal watcher can recover its exact card from the bottom', () => {
    const engine = game();
    const wrath = card('wind-spirit-beast-wrath', 'library');
    const lands = Array.from({ length: 4 }, () => card('sea-domain', 'library'));
    engine.roomState.players.player1.deck = [wrath, ...lands];
    expect(cast(engine, card('wind-spirit-hornblower-murad', 'hand')).success).toBe(true);
    resolve(engine);
    resolve(engine);
    choose(engine, []);
    choose(engine, [wrath.uuid, ...lands.map(item => item.uuid)]);
    resolve(engine);
    choose(engine, ['yes']);
    expect(engine.roomState.players.player1.hand.map(item => item.uuid)).toEqual([wrath.uuid]);
  });

  it('skips only one natural untap and allows other untap effects', () => {
    const target = card('sea-patrol', 'battlefield', 'player2');
    const engine = game(target);
    engine.applyMutations([{ type: 'TAP_CARD', cardUuid: target.uuid, skipNextUntap: true }]);
    engine.applyMutations([{ type: 'UNTAP_CARD', cardUuid: target.uuid }]);
    expect(live(engine, target).state).toMatchObject({ isTapped: false, skipNextUntap: true });
    engine.applyMutations([{ type: 'TAP_CARD', cardUuid: target.uuid }]);
    engine.roomState.phase = 'cleanupStep';
    engine.roomState.activeTurnPlayerId = 'player2';
    engine.applyMutations(new StateMachine(engine.roomState).transition(engine.roomState, 'stateTurnStart'));
    expect(live(engine, target).state).toMatchObject({ isTapped: true, skipNextUntap: false });
    engine.roomState.phase = 'cleanupStep';
    engine.applyMutations(new StateMachine(engine.roomState).transition(engine.roomState, 'stateTurnStart'));
    expect(live(engine, target).state.isTapped).toBe(false);
  });

  it('Namalan untaps the chosen beast only after a new opposing tap in your combat', () => {
    const namalan = card('wind-spirit-banner-namalan', 'battlefield');
    const friendly = card('wind-spirit-hornblower-murad', 'battlefield');
    friendly.state.isTapped = true;
    const enemy = card('sea-patrol', 'battlefield', 'player2');
    const engine = game(namalan, friendly, enemy);
    engine.roomState.phase = 'beginCombatStep';
    engine.applyMutations([{ type: 'TAP_CARD', cardUuid: enemy.uuid }]);
    const choice = engine.roomState.pendingChoice;
    if (!choice || choice.kind === 'number') throw new Error('Expected targeting choice');
    expect(choice.options).toHaveLength(1);
    choose(engine, [choice.options[0].id]);
    resolve(engine);
    choose(engine, ['yes']);
    expect(live(engine, friendly).state.isTapped).toBe(false);
    expect(CardCharacteristicService.resolveAbilities(engine.roomState, live(engine, enemy))).toEqual([]);
  });

  it('Galar marks the entering Wind Beast rather than the listener', () => {
    const source = card('wind-emperor-leon-galar', 'battlefield');
    const entrant = card('wind-spirit-banner-namalan', 'hand');
    const engine = game(source);
    expect(cast(engine, entrant).success).toBe(true);
    resolve(engine);
    resolve(engine);
    choose(engine, ['yes']);
    expect(live(engine, entrant).state.counters['+1/+1']).toBe(1);
    expect(live(engine, source).state.counters['+1/+1']).toBeUndefined();
  });

  it('Ice Ridge Lord reduces damage on friendly marked dragons even when it cannot be prevented', () => {
    const lord = card('ice-ridge-lord', 'battlefield');
    const ally = card('aurora-ice-dragon', 'battlefield');
    const enemy = card('aurora-ice-dragon', 'battlefield', 'player2');
    const dealer = card('sea-patrol', 'battlefield', 'player2');
    ally.state.counters.aurora = 1;
    enemy.state.counters.aurora = 1;
    const engine = game(lord, ally, enemy, dealer);
    engine.applyMutations(planDamage(engine.roomState, [ally, enemy].map(target => ({
      recipient: { kind: 'permanent', cardUuid: target.uuid, zoneRevision: 0 },
      source: captureSourceInformation(engine.roomState, dealer), amount: 2, combat: false, preventable: false,
    }))));
    expect(live(engine, ally).state.damageTaken).toBe(1);
    expect(live(engine, enemy).state.damageTaken).toBe(2);
  });

  it('Frostmoon Guardian offers payment per attacker and cancels only the chosen attack', () => {
    const guardian = card('frostmoon-guardian', 'battlefield');
    const enemies = Array.from({ length: 2 }, () => card('sea-patrol', 'battlefield', 'player2'));
    const engine = game(guardian, ...enemies);
    engine.roomState.activeTurnPlayerId = 'player2';
    engine.roomState.phase = 'declareAttackersStep';
    engine.roomState.priorityPlayerId = null;
    expect(engine.executePlayerAction('player2', 'declare_attackers', {
      attackers: enemies.map(value => ({ cardUuid: value.uuid })),
    }).success).toBe(true);
    const order = engine.roomState.pendingChoice;
    if (order?.kind === 'ordering') choose(engine, order.options.map(option => option.id));
    const first = engine.roomState.stack.at(-1);
    if (first?.type !== 'triggered') throw new Error('Expected a response to an attacker');
    const cancelled = (first.triggeringEvent?.payload.card as CardInstance).uuid;
    resolve(engine);
    choose(engine, ['yes']);
    expect(engine.roomState.combat.map(item => item.attacker.uuid)).toEqual(enemies.filter(item => item.uuid !== cancelled).map(item => item.uuid));
    expect(engine.roomState.players.player1.mana.white).toBe(3);
    expect(enemies.every(enemy => live(engine, enemy).state.attackedThisTurn && live(engine, enemy).state.isTapped)).toBe(true);
    resolve(engine);
    choose(engine, ['no']);
    expect(engine.roomState.combat).toHaveLength(1);
  });
});
