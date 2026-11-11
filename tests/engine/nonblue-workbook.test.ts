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
    'frost-messenger', 'phantom-puppet-factory', 'wind-spirit-blade-wolf', 'ice-dragon-staff',
    'archangel-ferrani', 'wind-spirit-regrowth', 'phantom-puppet-legionnaire', 'death-assembly', 'sealed-aurora-dragon-statue',
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
