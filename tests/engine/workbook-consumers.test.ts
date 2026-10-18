import { afterEach, describe, expect, it } from 'vitest';
import { instantiateCard } from '../../src/library/card-factory';
import { GameEngine } from '../../src/engine/game-engine';
import { registerAction } from '../../src/engine/action-registry';
import { playCardHandler } from '../../src/engine/handlers/play-card-handler';
import { activateAbilityHandler } from '../../src/engine/handlers/activate-ability-handler';
import { tapForManaHandler } from '../../src/engine/handlers/tap-for-mana-handler';
import { declareAttackersHandler } from '../../src/engine/handlers/declare-attackers-handler';
import { playLandHandler } from '../../src/engine/handlers/play-land-handler';
import { CardCharacteristicService as characteristics } from '../../src/engine/card-characteristic-service';
import { createTestRoom, fillTestLibraries } from '../helpers/test-room-factory';
import type { CardInstance, CardZone } from '../../src/types/card.types';

const engines: GameEngine[] = [];
afterEach(() => engines.splice(0).forEach(engine => engine.dispose()));
function card(id: string, zone: CardZone = 'battlefield', player = 'player1') {
  const c = instantiateCard(id);
  c.state = { ...c.state, ownerId: player, controllerId: player, zone, summoningSickness: false };
  return c;
}
function game(id: string) {
  const room = createTestRoom(); fillTestLibraries(room, 16);
  const source = card(id, 'hand'); room.players.player1.hand = [source]; room.players.player2.hand = [];
  registerAction('cast_spell', playCardHandler); registerAction('activate_ability', activateAbilityHandler);
  registerAction('tapForMana', tapForManaHandler); registerAction('declare_attackers', declareAttackersHandler);
  registerAction('play_land', playLandHandler);
  const engine = new GameEngine(room); engine.initRoom(); engines.push(engine);
  return { engine, source, room: engine.roomState };
}
function cast(engine: GameEngine, source: CardInstance, targets?: unknown[]) {
  expect(engine.executePlayerAction('player1', 'cast_spell', { cardUuid: source.uuid, ...(targets ? { targets } : {}) }).success).toBe(true);
  engine.resolveTopOfStack();
}
function select(engine: GameEngine, uuid?: string) {
  const choice = engine.roomState.pendingChoice!;
  expect(choice).toBeTruthy(); if (choice.kind === 'number') throw new Error('Expected card selection');
  const option = choice.options.find(o => (o.value as { cardUuid?: string })?.cardUuid === uuid);
  if (uuid) expect(option).toBeTruthy();
  expect(engine.executePlayerAction('player1', 'choose', { choiceId: choice.id, choices: uuid ? [option!.id] : [] }).success).toBe(true);
}
function attack(engine: GameEngine, source: CardInstance) {
  engine.roomState.phase = 'declareAttackersStep'; engine.roomState.priorityPlayerId = null;
  engine.roomState.battlefield.find(c => c.uuid === source.uuid)!.state.summoningSickness = false;
  expect(engine.executePlayerAction('player1', 'declare_attackers', { attackers: [{ cardUuid: source.uuid }] }).success).toBe(true);
}

describe('workbook cards consuming existing mechanics', () => {
  it.each([
    ['fatiao-warrior', '法蒂奧戰士', 'red', 2, 3],
    ['phantom-land-soldier', '幻影地界兵', 'black', 1, 1],
    ['phantom-captain', '幻影營長', 'black', 1, 2],
    ['wind-beast-bean', '風靈獸 魔豆', 'green', 1, 1],
    ['wind-beast-rabbit', '風靈獸 巧兔', 'green', 1, 1],
    ['wind-beast-fox', '風靈獸 舞狐', 'green', 3, 3],
    ['worlds-traveler', '諸界游歷者', 'green', 2, 2],
    ['winter-drake', '寒冬幼龍', 'white', 1, 1],
    ['sky-hound', '天犬', 'yellow', 2, 2],
    ['winged-envoy', '小翼使者', 'yellow', 1, 1],
    ['worlds-sin-emperor', '諸界六皇 魔邪之基拉奧特', 'black', 3, 3],
    ['swift-spirit-envoy', '迅靈使者', 'green', 1, 3],
    ['frozen-snowball', '凍土雪球', 'white', 2, 2],
  ])('loads %s with printed name, color and stats', (id, name, color, power, toughness) => {
    expect(instantiateCard(id as string).blueprint).toMatchObject({ name, colors: [color], power, toughness });
  });

  it('damages an opposing creature on entry and on attack, with separate target selections', () => {
    const { engine, source } = game('fatiao-warrior');
    const enemy = card('musketeer-infantry', 'battlefield', 'player2'); engine.roomState.battlefield.push(enemy);
    cast(engine, source); select(engine, enemy.uuid); engine.resolveTopOfStack();
    expect(engine.roomState.battlefield.find(c => c.uuid === enemy.uuid)?.state.damageTaken).toBe(3);
    attack(engine, source); select(engine, enemy.uuid); engine.resolveTopOfStack();
    expect(engine.roomState.players.player2.graveyard.map(c => c.uuid)).toContain(enemy.uuid);
    expect(engine.drainEventBatches().flatMap(b => b.events).filter(e => e.eventId === 'DAMAGE_DEALT').map(e => e.payload.amount)).toEqual([3, 3]);
  });

  it.each([true, false])('optionally places a land from hand without consuming the land play (accept=%s)', accept => {
    const { engine, source } = game('wind-beast-rabbit'); const land = card('land-red', 'hand');
    engine.roomState.players.player1.hand.push(land);
    cast(engine, source); engine.resolveTopOfStack();
    expect(engine.roomState.pendingChoice?.kind).toBe('search'); select(engine, accept ? land.uuid : undefined);
    expect(engine.roomState.battlefield.some(c => c.uuid === land.uuid)).toBe(accept);
    const normal = card('land-red', 'hand'); engine.roomState.players.player1.hand.push(normal);
    expect(engine.executePlayerAction('player1', 'play_land', { cardUuid: normal.uuid, zoneRevision: normal.state.zoneRevision ?? 0 }).success).toBe(true);
  });

  it('recovers only a land from its controller’s graveyard', () => {
    const { engine, source } = game('phantom-land-soldier');
    const land = card('land-red', 'graveyard'), creature = card('empire-servant', 'graveyard');
    engine.roomState.players.player1.graveyard = [land, creature];
    cast(engine, source); engine.resolveTopOfStack();
    const choice = engine.roomState.pendingChoice!; if (choice.kind === 'number') throw new Error('Expected search');
    expect(choice.options).toHaveLength(1); select(engine, land.uuid);
    expect(engine.roomState.battlefield.find(c => c.uuid === land.uuid)?.state.zoneRevision).toBe(1);
    expect(engine.roomState.players.player1.graveyard.map(c => c.uuid)).toEqual([creature.uuid]);
  });

  it('searches the whole library for a 迅靈 creature and then shuffles', () => {
    const { engine, source } = game('wind-call'); const match = card('swift-spirit-envoy', 'library');
    engine.roomState.players.player1.deck.unshift(match); // Bottom, outside any top-three window.
    cast(engine, source); select(engine, match.uuid);
    expect(engine.roomState.players.player1.hand.map(c => c.uuid)).toEqual([match.uuid]);
    const events = engine.drainEventBatches().flatMap(b => b.events);
    expect(events.some(e => e.eventId === 'LIBRARY_SHUFFLED')).toBe(true);
    expect(events.filter(e => e.eventId === 'STACK_ITEM_RESOLVED').map(e => e.payload.effectId)).toEqual(['MOVE_ZONE', 'SHUFFLE']);
  });

  it.each(['alone', 'present', 'leaves'] as const)('checks another 迅靈 at entry and resolution (%s)', condition => {
    const { engine, source } = game('swift-spirit-envoy'); const other = card('swift-spirit-envoy');
    if (condition !== 'alone') engine.roomState.battlefield.push(other);
    expect(source.blueprint.castRequirements.speed).toBe('instant'); cast(engine, source);
    if (condition === 'alone') expect(engine.roomState.stack).toHaveLength(0);
    if (condition === 'leaves') engine.applyMutations([{ type: 'MOVE_CARD', cardUuid: other.uuid, playerId: 'player1', from: 'battlefield', to: 'graveyard' }]);
    engine.resolveTopOfStack();
    expect(engine.roomState.players.player1.hand).toHaveLength(condition === 'present' ? 1 : 0);
  });

  it('grants real tap-to-draw abilities only to friendly 幻影木偶 and removes the grant with its source', () => {
    const { engine, source } = game('phantom-castle'); const puppet = card('phantom-captain'), other = card('empire-servant');
    engine.roomState.battlefield = [puppet, other]; cast(engine, source);
    const granted = characteristics.resolveAbilities(engine.roomState, puppet).find(a => a.type === 'activated' && a.effect.action === 'DRAW')!;
    expect(granted).toBeTruthy();
    expect(characteristics.resolveAbilities(engine.roomState, other).some(a => a.type === 'activated' && a.effect.action === 'DRAW')).toBe(false);
    expect(engine.executePlayerAction('player1', 'activate_ability', { cardUuid: puppet.uuid, abilityId: granted.id }).success).toBe(true);
    engine.resolveTopOfStack(); expect(engine.roomState.players.player1.hand).toHaveLength(1);
    expect(engine.roomState.battlefield.find(c => c.uuid === puppet.uuid)?.state.isTapped).toBe(true);
    engine.applyMutations([{ type: 'MOVE_CARD', cardUuid: source.uuid, playerId: 'player1', from: 'battlefield', to: 'graveyard' }]);
    expect(characteristics.resolveAbilities(engine.roomState, puppet).some(a => a.type === 'activated' && a.effect.action === 'DRAW')).toBe(false);
  });

  it.each([['wind-beast-bean', 'green'], ['winter-drake', 'white'], ['winged-envoy', 'yellow']])('%s produces its own resource immediately', (id, color) => {
    const { engine, source } = game(id); source.state.zone = 'battlefield';
    engine.roomState.players.player1.hand = []; engine.roomState.battlefield.push(source);
    const before = engine.roomState.players.player1.mana[color as keyof typeof engine.roomState.players.player1.mana];
    expect(engine.executePlayerAction('player1', 'tapForMana', { cardUuid: source.uuid }).success).toBe(true);
    expect(engine.roomState.players.player1.mana[color as keyof typeof engine.roomState.players.player1.mana]).toBe(before + 1);
    expect(engine.roomState.stack).toEqual([]);
  });

  it.each([
    ['blazing-dragon-habitat', 'red'], ['phantom-underworld', 'black'], ['beast-holy-land', 'green'],
    ['aurora-northland', 'white'], ['angel-holy-land', 'yellow'], ['nether-ancient-land', 'black'],
    ['divine-wind-torii', 'green'], ['ancient-weapon-battlefield', 'white'], ['thunder-main-camp', 'yellow'],
  ])('%s is a playable land with an explicit resource ability', (id, color) => {
    const { engine, source } = game(id);
    expect(engine.executePlayerAction('player1', 'play_land', { cardUuid: source.uuid, zoneRevision: source.state.zoneRevision ?? 0 }).success).toBe(true);
    expect(engine.executePlayerAction('player1', 'tapForMana', { cardUuid: source.uuid }).success).toBe(true);
    expect(engine.roomState.players.player1.mana[color as keyof typeof engine.roomState.players.player1.mana]).toBe(6);
  });

  it.each(['undying-dusk-forest', 'blazing-wind-river', 'far-north-graveyard', 'thunder-tundra'])('%s taps on entry, then offers its printed color choices', id => {
    const { engine, source } = game(id);
    expect(engine.executePlayerAction('player1', 'play_land', { cardUuid: source.uuid, zoneRevision: source.state.zoneRevision ?? 0 }).success).toBe(true);
    expect(engine.roomState.stack).toHaveLength(1); engine.resolveTopOfStack();
    expect(engine.roomState.battlefield[0].state.isTapped).toBe(true);
    expect(engine.executePlayerAction('player1', 'tapForMana', { cardUuid: source.uuid }).success).toBe(false);
    engine.roomState.battlefield[0].state.isTapped = false;
    const mana = source.blueprint.abilities.find(a => a.type === 'activated')!;
    expect(mana.type).toBe('activated'); if (mana.type !== 'activated') return;
    const colors = mana.effect.params.colors as string[];
    expect(colors).toHaveLength(2);
    expect(engine.executePlayerAction('player1', 'tapForMana', { cardUuid: source.uuid, abilityId: mana.id, manaColor: colors[1] }).success).toBe(true);
    expect(engine.roomState.players.player1.mana[colors[1] as keyof typeof engine.roomState.players.player1.mana]).toBe(6);
  });

  it('counts friendly 幽爾 for the emperor’s entry draw, then weakens an enemy on a friendly 幽爾 attack', () => {
    const { engine, source } = game('worlds-sin-emperor'); const ally = card('worlds-traveler'), enemy = card('musketeer-infantry', 'battlefield', 'player2');
    engine.roomState.battlefield = [ally, enemy]; cast(engine, source); engine.resolveTopOfStack();
    expect(engine.roomState.players.player1.hand).toHaveLength(2); attack(engine, ally); select(engine, enemy.uuid); engine.resolveTopOfStack();
    const live = engine.roomState.battlefield.find(c => c.uuid === enemy.uuid)!;
    expect(characteristics.resolveToughness(engine.roomState, live)).toBe(3);
    expect(live.state.damageTaken).toBe(0);
  });

  it.each([['hera-empowerment', 'phantom-captain', 1], ['nature-gift', 'wind-beast-fox', 2]] as const)('%s buffs the printed tribe until cleanup', (id, recipient, amount) => {
    const { engine, source } = game(id); const ally = card(recipient), enemy = card(recipient, 'battlefield', 'player2');
    engine.roomState.battlefield = [ally, enemy];
    cast(engine, source, id === 'nature-gift' ? [{ targetType: 'permanent', cardUuid: ally.uuid }] : undefined);
    expect(characteristics.resolvePower(engine.roomState, engine.roomState.battlefield[0])).toBe(ally.blueprint.power! + amount);
    expect(characteristics.resolvePower(engine.roomState, enemy)).toBe(enemy.blueprint.power);
    expect(engine.roomState.continuousEffectPool[0].duration).toBe('END_OF_TURN');
    engine.advancePhase('skipToEnd');
    expect(characteristics.resolvePower(engine.roomState, engine.roomState.battlefield.find(c => c.uuid === ally.uuid)!)).toBe(ally.blueprint.power);
  });

  it.each(['wind-beast-fox', 'phantom-captain'])('%s resolves its single attack instruction', id => {
    const { engine, source } = game(id); source.state.zone = 'battlefield';
    engine.roomState.players.player1.hand = [];
    const recipient = card(id === 'wind-beast-fox' ? 'sky-hound' : 'phantom-captain', 'battlefield', id === 'wind-beast-fox' ? 'player2' : 'player1');
    engine.roomState.battlefield = [source, recipient]; attack(engine, source); select(engine, recipient.uuid); engine.resolveTopOfStack();
    const live = engine.roomState.battlefield.find(c => c.uuid === recipient.uuid)!;
    if (id === 'wind-beast-fox') expect(live.state.isTapped).toBe(true);
    else expect(characteristics.resolvePower(engine.roomState, live)).toBe(recipient.blueprint.power! + 1);
  });

  it('casts 初級風疲術 for generic energy and taps the selected opposing creature', () => {
    const { engine, source } = game('lesser-wind-fatigue'); const enemy = card('sky-hound', 'battlefield', 'player2');
    engine.roomState.battlefield = [enemy];
    engine.roomState.players.player1.mana = { red: 1, black: 0, green: 0, yellow: 0, white: 0, blue: 0 };
    cast(engine, source, [{ targetType: 'permanent', cardUuid: enemy.uuid }]);
    expect(engine.roomState.battlefield[0].state.isTapped).toBe(true);
    expect(engine.roomState.players.player1.mana.red).toBe(0);
  });

  it('uses 歐凱爾山脈’s separate mana ability and paid once-per-turn tap', () => {
    const { engine, source } = game('okair-mountains'); source.state.zone = 'battlefield';
    const enemy = card('sky-hound', 'battlefield', 'player2');
    engine.roomState.players.player1.hand = []; engine.roomState.battlefield = [source, enemy];
    expect(engine.executePlayerAction('player1', 'tapForMana', { cardUuid: source.uuid, abilityId: 'produce-green' }).success).toBe(true);
    const data = { cardUuid: source.uuid, abilityId: 'exhaust-enemy', targets: [{ targetType: 'permanent', cardUuid: enemy.uuid }] };
    expect(engine.executePlayerAction('player1', 'activate_ability', data).success).toBe(true);
    engine.resolveTopOfStack(); expect(engine.roomState.battlefield[1].state.isTapped).toBe(true);
    expect(engine.executePlayerAction('player1', 'activate_ability', data).success).toBe(false);
  });

  it('keeps 歐凱爾之墓’s printed activation free and repeatable', () => {
    const { engine, source } = game('okair-tomb'); source.state.zone = 'battlefield';
    const beast = card('wind-beast-fox'); engine.roomState.players.player1.hand = []; engine.roomState.battlefield = [source, beast];
    for (let i = 0; i < 2; i++) {
      expect(engine.executePlayerAction('player1', 'activate_ability', { cardUuid: source.uuid, abilityId: 'empower-beasts' }).success).toBe(true);
      engine.resolveTopOfStack();
    }
    expect(characteristics.resolvePower(engine.roomState, engine.roomState.battlefield[1])).toBe(7);
    expect(engine.roomState.battlefield[0].state.isTapped).toBe(false);
  });

  it('uses 諸界游歷者’s ordinary tap-to-draw activation on the stack', () => {
    const { engine, source } = game('worlds-traveler'); source.state.zone = 'battlefield';
    engine.roomState.players.player1.hand = []; engine.roomState.battlefield = [source];
    expect(engine.executePlayerAction('player1', 'activate_ability', { cardUuid: source.uuid, abilityId: 'tap-draw' }).success).toBe(true);
    expect(engine.roomState.players.player1.hand).toHaveLength(0); engine.resolveTopOfStack();
    expect(engine.roomState.players.player1.hand).toHaveLength(1);
  });

  it.each(['worlds-merchant', 'worlds-sea'].flatMap(id => ['red', 'black', 'green', 'yellow', 'white', 'blue'].map(color => ({ id, color }))))('$id can produce one chosen $color energy, including 海 blue', ({ id, color }) => {
    const { engine, source } = game(id); source.state.zone = 'battlefield';
    engine.roomState.players.player1.hand = []; engine.roomState.battlefield = [source];
    engine.roomState.players.player1.mana = { red: 0, black: 0, green: 0, yellow: 0, white: 0, blue: 0 };
    expect(engine.executePlayerAction('player1', 'tapForMana', { cardUuid: source.uuid, manaColor: color }).success).toBe(true);
    expect(engine.roomState.players.player1.mana).toEqual({ red: 0, black: 0, green: 0, yellow: 0, white: 0, blue: 0, [color]: 1 });
    expect(engine.roomState.battlefield[0].state.isTapped).toBe(true); expect(engine.roomState.stack).toEqual([]);
  });

  it('pays 蒼海城貴族 with blue and later produces blue as its printed mana ability', () => {
    const { engine, source } = game('sea-city-noble');
    expect(source.blueprint).toMatchObject({ colors: ['blue'], power: 1, toughness: 1, castRequirements: { cost: { mana: { blue: 1 } } } });
    engine.roomState.players.player1.mana = { red: 0, black: 0, green: 0, yellow: 0, white: 1, blue: 0 };
    expect(engine.executePlayerAction('player1', 'cast_spell', { cardUuid: source.uuid }).success).toBe(false);
    engine.roomState.players.player1.mana.blue = 1; cast(engine, source);
    expect(engine.roomState.players.player1.mana.blue).toBe(0);
    expect(engine.executePlayerAction('player1', 'tapForMana', { cardUuid: source.uuid }).success).toBe(false);
    engine.roomState.battlefield[0].state.summoningSickness = false;
    expect(engine.executePlayerAction('player1', 'tapForMana', { cardUuid: source.uuid }).success).toBe(true);
    expect(engine.roomState.players.player1.mana.blue).toBe(1);
  });

  it('plays 蒼海領地 and produces blue', () => {
    const { engine, source } = game('sea-domain');
    expect(engine.executePlayerAction('player1', 'play_land', { cardUuid: source.uuid, zoneRevision: 0 }).success).toBe(true);
    expect(engine.executePlayerAction('player1', 'tapForMana', { cardUuid: source.uuid }).success).toBe(true);
    expect(engine.roomState.players.player1.mana.blue).toBe(6);
  });

  it.each([
    ['demon-flame-abyss', 'red'], ['demon-flame-abyss', 'blue'],
    ['great-wave-thunder-array', 'blue'], ['great-wave-thunder-array', 'yellow'],
  ])('%s offers its printed %s output after resolving the entry tap', (id, color) => {
    const { engine, source } = game(id);
    expect(engine.executePlayerAction('player1', 'play_land', { cardUuid: source.uuid, zoneRevision: 0 }).success).toBe(true);
    engine.resolveTopOfStack(); expect(engine.roomState.battlefield[0].state.isTapped).toBe(true);
    expect(engine.executePlayerAction('player1', 'tapForMana', { cardUuid: source.uuid, manaColor: color }).success).toBe(false);
    engine.roomState.battlefield[0].state.isTapped = false;
    expect(engine.executePlayerAction('player1', 'tapForMana', { cardUuid: source.uuid, manaColor: color }).success).toBe(true);
    expect(engine.roomState.players.player1.mana[color as keyof typeof engine.roomState.players.player1.mana]).toBe(6);
  });

  it('resolves 海底深淵 by recovering a graveyard land without spending the normal land play', () => {
    const { engine, source } = game('sea-depths'); const land = card('sea-domain', 'graveyard');
    engine.roomState.players.player1.graveyard = [land];
    cast(engine, source); select(engine, land.uuid);
    expect(engine.roomState.battlefield.find(c => c.uuid === land.uuid)?.state.zoneRevision).toBe(1);
    expect(engine.roomState.players.player1.graveyard.map(c => c.uuid)).toEqual([source.uuid]);
    const normal = card('sea-domain', 'hand'); engine.roomState.players.player1.hand.push(normal);
    expect(engine.executePlayerAction('player1', 'play_land', { cardUuid: normal.uuid, zoneRevision: 0 }).success).toBe(true);
  });

  it.each([true, false])('runs 幻海人下士’s land recovery then draw in the same entry trigger (land exists=%s)', exists => {
    const { engine, source } = game('phantom-sea-corporal'); const land = card('sea-domain', 'graveyard');
    engine.roomState.players.player1.graveyard = exists ? [land] : [];
    expect(source.blueprint.castRequirements.cost?.mana).toEqual({ blue: 2, generic: 1 });
    cast(engine, source); engine.resolveTopOfStack();
    if (exists) {
      expect(engine.roomState.players.player1.hand).toHaveLength(0); select(engine, land.uuid);
      expect(engine.roomState.battlefield.some(c => c.uuid === land.uuid)).toBe(true);
    }
    expect(engine.roomState.players.player1.hand).toHaveLength(1);
    expect(engine.roomState.stack).toEqual([]); expect(engine.roomState.pendingChoice).toBeNull();
    const resolved = engine.drainEventBatches().flatMap(b => b.events).filter(e => e.eventId === 'STACK_ITEM_RESOLVED');
    expect(resolved.filter(e => e.payload.effectId === 'DRAW')).toHaveLength(1);
    if (exists) expect(resolved.map(e => e.payload.effectId)).toEqual(['MOVE_ZONE', 'DRAW']);
  });
});
