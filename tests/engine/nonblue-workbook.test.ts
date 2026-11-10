import { afterEach, describe, expect, it } from 'vitest';
import { GameEngine } from '@engine/game-engine';
import { planDamage } from '@engine/damage-service';
import { captureSourceInformation } from '@engine/source-information';
import { StateMachine } from '@engine/state-machine';
import { CardCharacteristicService } from '@engine/card-characteristic-service';
import { getBlueprint, instantiateCard } from '@library/card-factory';
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

describe('workbook expansion beyond blue', () => {
  it.each([
    'hera-ghostfire', 'phantom-ghostaxe', 'phantom-ghostfire', 'phantom-ghostfire-scythe', 'phantasm-altar',
    'phantom-dreamer', 'wind-spirit-hornblower-murad', 'wind-spirit-beast-wrath', 'beast-emperor-command',
    'wind-spirit-beast-son', 'wind-spirit-banner-namalan', 'wind-spirit-general-haer', 'wind-emperor-leon-galar',
    'far-north-crown', 'ice-ridge-lord', 'frostmoon-guardian', 'heavenly-divine-city', 'holy-energy-haste', 'heavenly-beast', 'heavenly-marquis-ivun', 'thunder-gate',
  ])('registers %s with a compiled ability or spell recipe', id => {
    const value = getBlueprint(id);
    expect(value.abilities.length + value.onCastEffects.length + (value.modes?.length ?? 0)).toBeGreaterThan(0);
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
