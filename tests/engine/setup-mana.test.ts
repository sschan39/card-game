import { afterEach, describe, expect, it } from 'vitest';
import { gameConfig } from '../../src/config';
import { createRoom, joinRoom, buildStartingCardMutations } from '../../src/engine/room-factory';
import { GameEngine } from '../../src/engine/game-engine';
import { ManaPool } from '../../src/engine/mana-pool';
import { parseManaCost } from '../../src/library/card-parser';
import { instantiateCard } from '../../src/library/card-factory';
import { registerAction } from '../../src/engine/action-registry';
import { playCardHandler } from '../../src/engine/handlers/play-card-handler';
import { tapForManaHandler } from '../../src/engine/handlers/tap-for-mana-handler';
import { OptionService } from '../../src/engine/option-service';
import { createTestRoom } from '../helpers/test-room-factory';
import type { ActivatedAbility, ManaColor } from '../../src/types/card.types';

const pool = (red = 0, blue = 0, colorless = 0) => ({ white: 0, black: 0, green: 0, red, blue, colorless });
const setupDefaults = structuredClone(gameConfig);
afterEach(() => Object.assign(gameConfig, structuredClone(setupDefaults)));
function engine() {
  registerAction('cast_spell', playCardHandler); registerAction('tapForMana', tapForManaHandler);
  const engine = new GameEngine(createTestRoom()); engine.initRoom(); return engine;
}
function manaAbility(tap = false, colors: ManaColor[] = ['red']): ActivatedAbility {
  return { id: 'fixture-ability', type: 'activated', castSpeed: 'instant', cost: { tap }, effect: { action: 'ADD_MANA', params: { colors, amount: 1 }, tags: [], targeting: { type: 'self', required: false } } };
}
function source(e: GameEngine, abilities: ActivatedAbility[]) {
  const card = instantiateCard('empire-servant');
  card.state = { ...card.state, zone: 'battlefield', ownerId: 'player1', controllerId: 'player1', summoningSickness: true };
  card.blueprint = { ...card.blueprint, abilities }; e.roomState.battlefield = [card]; return card;
}
describe('setup and mana', () => {
  it('plans deterministically without changing the pool and validates specific symbols in allocations', () => {
    const available = pool(2, 2, 1), before = { ...available };
    expect(ManaPool.proposePayment(available, { red: 1, generic: 2 })).toEqual({ red: 1, colorless: 1, blue: 1 });
    expect(available).toEqual(before);
    for (const payment of [{ red: 0, blue: 3 }, { red: 1 }, { red: 4 }, { red: -1, blue: 4 }, { generic: 3 }, { red: 1.5, blue: 1.5 }, { red: 1, blue: 2, fake: 0 }]) {
      expect(ManaPool.proposePayment(available, { red: 1, generic: 2 }, payment)).toBeUndefined();
    }
    expect(ManaPool.proposePayment(available, { colorless: 1, generic: 2 }, { blue: 2, colorless: 1 })).toEqual({ blue: 2, colorless: 1 });
  });
  it('uses automatic generic allocation when no allocation is supplied', () => {
    const e = engine(), card = e.roomState.players.player1.hand[0];
    card.blueprint = { ...card.blueprint, castRequirements: { ...card.blueprint.castRequirements, cost: { mana: { generic: 2, red: 1 } } } };
    e.roomState.players.player1.mana = pool(1, 2);
    const result = e.executePlayerAction('player1', 'cast_spell', { cardUuid: card.uuid });
    expect(result.success).toBe(true); expect(e.roomState.players.player1.mana).toEqual(pool());
    expect(result.success && result.mutations?.find(m => m.type === 'SPEND_MANA')).toMatchObject({ cost: { red: 1, blue: 2 } });
  });
  it('rejects unsupported costs and loyalty abilities without changing state', () => {
    for (const cost of [{ discard: 99 }, { loyalty: 0 }, { life: -1 }]) {
      const e = engine(); const ability = manaAbility(); ability.cost = cost;
      const card = source(e, [ability]); const before = structuredClone(e.roomState);
      expect(e.executePlayerAction('player1', 'tapForMana', { cardUuid: card.uuid }).success).toBe(false);
      expect(e.roomState).toEqual(before);
    }
  });
  it('requires a valid color choice and paid costs before tapping', () => {
    const e = engine(), ability = manaAbility(true, ['blue', 'green']); ability.cost.mana = { red: 1 };
    const card = source(e, [ability]); card.state.summoningSickness = false;
    e.roomState.players.player1.mana = pool(); const before = structuredClone(e.roomState);
    for (const data of [{}, { manaColor: 'red' }, { manaColor: 'blue' }, { abilityIndex: 99, manaColor: 'blue' }]) {
      expect(e.executePlayerAction('player1', 'tapForMana', { cardUuid: card.uuid, ...data }).success).toBe(false);
      expect(e.roomState).toEqual(before);
    }
    e.roomState.players.player1.mana.red = 1;
    expect(e.executePlayerAction('player1', 'tapForMana', { cardUuid: card.uuid, manaColor: 'blue' }).success).toBe(true);
    expect(e.roomState.battlefield[0].state.isTapped).toBe(true);
    expect(e.roomState.players.player1.mana).toEqual(pool(0, 1));
    expect(e.roomState.priorityPlayerId).toBe('player1');
  });
  it('keeps first-turn drawing disabled only for the starting player, even after another turn', () => {
    const e = engine(); e.roomState.setup = { ...gameConfig.setup, firstPlayerDrawsOnFirstTurn: false };
    for (const playerId of ['player1', 'player2']) {
      const card = instantiateCard('land-red'); card.state = { ...card.state, ownerId: playerId, controllerId: playerId };
      e.roomState.players[playerId].deck = [card];
    }
    e.roomState.turnNumber = 1; e.roomState.phase = 'upkeepStep';
    e.advancePhase('complete'); expect(e.roomState.players.player1.deck).toHaveLength(1);
    e.advancePhase('skipToEnd'); expect(e.roomState.turnNumber).toBe(2); expect(e.roomState.players.player2.deck).toHaveLength(0);
    e.advancePhase('skipToEnd'); expect(e.roomState.turnNumber).toBe(3); expect(e.roomState.players.player1.deck).toHaveLength(0);
  });
  it('rejects invalid setup values and unknown fixture card IDs at room creation', () => {
    for (const openingHandSize of [-1, 1.5, 100]) {
      gameConfig.setup.openingHandSize = openingHandSize;
      expect(() => createRoom('bad', 'player1')).toThrow('Invalid setup configuration');
    }
    Object.assign(gameConfig, structuredClone(setupDefaults));
    gameConfig.setup.developmentDeck[0] = 'missing-card';
    expect(() => createRoom('bad', 'player1')).toThrow('No raw card data');
  });
  it('parses generic separately from explicit colorless and rejects unsupported symbols', () => {
    expect(parseManaCost('{2}{C}{R}')).toEqual({ generic: 2, colorless: 1, red: 1 });
    expect(parseManaCost('{X}{R}')).toEqual({ generic: { numeric: { kind: 'binding', name: 'X' } }, red: 1 });
    expect(() => parseManaCost('{Y}')).toThrow(); expect(() => parseManaCost('{W/U}')).toThrow();
  });
  it('pays generic from colored mana after reserving specific requirements', () => {
    expect(ManaPool.canPay(pool(2, 1), { generic: 2, red: 1 })).toBe(true);
    expect(ManaPool.canPay(pool(2, 1), { colorless: 1 })).toBe(false);
  });
  it('casts with a submitted allocation and rejects overpayment without changes', () => {
    const e = engine(), card = e.roomState.players.player1.hand[0];
    card.blueprint = { ...card.blueprint, castRequirements: { ...card.blueprint.castRequirements, cost: { mana: { generic: 1, red: 1 } } } };
    e.roomState.players.player1.mana = pool(2, 1);
    const before = structuredClone(e.roomState);
    expect(e.executePlayerAction('player1', 'cast_spell', { cardUuid: card.uuid, payment: { red: 2, blue: 1 } }).success).toBe(false);
    expect(e.roomState).toEqual(before);
    expect(e.executePlayerAction('player1', 'cast_spell', { cardUuid: card.uuid, payment: { red: 1, blue: 1 } }).success).toBe(true);
    expect(e.roomState.players.player1.mana).toEqual(pool(1));
  });
  it('uses a non-tap mana ability while tapped and summoning sick', () => {
    const e = engine(), card = source(e, [manaAbility()]); card.state.isTapped = true;
    e.roomState.players.player1.mana = pool();
    expect(e.executePlayerAction('player1', 'tapForMana', { cardUuid: card.uuid }).success).toBe(true);
    expect(e.roomState.players.player1.mana.red).toBe(1); expect(e.roomState.stack).toEqual([]);
  });
  it('selects the requested ability and color, with options carrying the same choice', () => {
    const e = engine(), card = source(e, [manaAbility(), manaAbility(false, ['blue', 'green'])]);
    e.roomState.players.player1.mana = pool();
    expect(e.executePlayerAction('player1', 'tapForMana', { cardUuid: card.uuid }).success).toBe(false);
    expect(e.executePlayerAction('player1', 'tapForMana', { cardUuid: card.uuid, abilityIndex: 1, manaColor: 'green' }).success).toBe(true);
    expect(e.roomState.players.player1.mana.green).toBe(1);
    const options = new OptionService().getOptions(e.roomState, 'player1', card.uuid, 'battlefield');
    expect(options.filter(option => option.actionId === 'tapForMana')).toHaveLength(3);
    expect(options.map(option => (option as unknown as { data: unknown }).data)).toContainEqual({ abilityId: 'fixture-ability', abilityIndex: 1, manaColor: 'blue' });
  });
  it('pays a mana ability mana/life cost before producing mana', () => {
    const ability = manaAbility(); ability.cost = { mana: { blue: 1 }, life: 2 };
    const e = engine(), card = source(e, [ability]); e.roomState.players.player1.mana = pool(0, 1);
    expect(e.executePlayerAction('player1', 'tapForMana', { cardUuid: card.uuid }).success).toBe(true);
    expect(e.roomState.players.player1.mana).toEqual(pool(1)); expect(e.roomState.players.player1.life).toBe(18);
  });
  it('rejects targeted mana effects and activation without priority', () => {
    const ability = manaAbility(); ability.effect.targeting = { type: 'player', required: true };
    const e = engine(), card = source(e, [ability]);
    expect(e.executePlayerAction('player1', 'tapForMana', { cardUuid: card.uuid }).success).toBe(false);
    card.blueprint = { ...card.blueprint, abilities: [manaAbility()] }; e.roomState.priorityPlayerId = 'player2';
    expect(e.executePlayerAction('player1', 'tapForMana', { cardUuid: card.uuid }).success).toBe(false);
  });
  it('snapshots configured life, opening hand and deck order for both players', () => {
    Object.assign(gameConfig, { setup: { startingLife: 30, openingHandSize: 1, firstPlayerDrawsOnFirstTurn: false, shuffleDevelopmentDeck: false, developmentDeck: ['land-red', 'empire-servant'] } });
    const room = createRoom('setup', 'player1'); joinRoom(room, 'player2'); const e = new GameEngine(room);
    e.applyMutations(buildStartingCardMutations(room));
    expect(e.roomState.players.player2.life).toBe(30);
    expect(e.roomState.players.player1.hand.map(card => card.blueprint.id)).toEqual(['empire-servant']);
    expect(e.roomState.players.player1.deck.map(card => card.blueprint.id)).toEqual(['land-red']);
    Object.assign(gameConfig, setupDefaults);
    e.roomState.phase = 'upkeepStep'; e.advancePhase('complete');
    expect(e.roomState.players.player1.hand).toHaveLength(1);
    e.advancePhase('skipToEnd');
    expect(e.roomState.players.player2.hand).toHaveLength(2);
  });
});
