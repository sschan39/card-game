import { afterEach, describe, expect, it } from 'vitest';
import { instantiateCard } from '../../src/library/card-factory';
import { GameEngine } from '../../src/engine/game-engine';
import { registerAction } from '../../src/engine/action-registry';
import { playCardHandler } from '../../src/engine/handlers/play-card-handler';
import { tapForManaHandler } from '../../src/engine/handlers/tap-for-mana-handler';
import { declareAttackersHandler } from '../../src/engine/handlers/declare-attackers-handler';
import { createTestRoom, fillTestLibraries } from '../helpers/test-room-factory';

const engines: GameEngine[] = [];
afterEach(() => engines.splice(0).forEach(engine => engine.dispose()));
function game(id: string, red = 1) {
  const room = createTestRoom(); fillTestLibraries(room);
  for (const p of Object.values(room.players)) p.mana = { red: 0, blue: 0, green: 0, black: 0, white: 0, yellow: 0 };
  const source = instantiateCard(id);
  source.state = { ...source.state, ownerId: 'player1', controllerId: 'player1', zone: 'hand' };
  room.players.player1.hand = [source]; room.players.player1.mana.red = red;
  registerAction('cast_spell', playCardHandler); registerAction('tapForMana', tapForManaHandler);
  const engine = new GameEngine(room); engine.initRoom(); engines.push(engine);
  return { engine, source };
}

describe('real ST01A card consumers using existing engine primitives', () => {
  it('retains 血炎山’s printed fire element and land race', () => {
    expect(instantiateCard('land-red').blueprint).toMatchObject({ name: '血炎山', cardTypes: ['Land'], subTypes: ['地界'], colors: ['red'], castRequirements: { cost: { mana: {} } } });
  });
  it('loads the printed 火槍團下等兵 as a one-red 4/5 炎獸 with no invented ability', () => {
    const { engine, source } = game('musketeer-infantry');
    expect(source.blueprint).toMatchObject({ name: '火槍團下等兵', subTypes: ['炎獸'], colors: ['red'], power: 4, toughness: 5, abilities: [], castRequirements: { cost: { mana: { red: 1 } } } });
    expect(engine.executePlayerAction('player1', 'cast_spell', { cardUuid: source.uuid }).success).toBe(true);
    engine.resolveTopOfStack();
    expect(engine.roomState.players.player1.mana.red).toBe(0);
    expect(engine.roomState.battlefield[0]).toMatchObject({ uuid: source.uuid, blueprint: { power: 4, toughness: 5 }, state: { summoningSickness: true, damageTaken: 0 } });
    expect(engine.roomState.stack).toEqual([]);
  });

  it('uses 帝國奴僕 as the actual 炎獸 tap-for-red mana consumer', () => {
    const { engine, source } = game('empire-servant', 0);
    expect(source.blueprint.subTypes).toEqual(['炎獸']);
    source.state.zone = 'battlefield'; source.state.summoningSickness = false;
    engine.roomState.players.player1.hand = []; engine.roomState.battlefield = [source];
    expect(engine.executePlayerAction('player1', 'tapForMana', { cardUuid: source.uuid }).success).toBe(true);
    expect(engine.roomState.players.player1.mana.red).toBe(1);
    expect(engine.roomState.battlefield[0].state.isTapped).toBe(true);
    expect(engine.roomState.stack).toEqual([]);
    expect(engine.executePlayerAction('player1', 'tapForMana', { cardUuid: source.uuid }).success).toBe(false);
  });

  it.each([['broken-fireball', 1, 3], ['fireball', 2, 5]] as const)('%s pays its printed red cost and deals the supported fast damage', (id, cost, amount) => {
    const { engine, source } = game(id, cost);
    expect(source.blueprint.subTypes).toEqual(['炎兵']);
    expect(source.blueprint.castRequirements).toMatchObject({ speed: 'instant', cost: { mana: { red: cost } } });
    expect(source.blueprint.rulesText).toContain('未支援');
    expect(engine.executePlayerAction('player1', 'cast_spell', { cardUuid: source.uuid, targets: [{ targetType: 'player', playerId: 'player1' }] }).success).toBe(false);
    expect(engine.executePlayerAction('player1', 'cast_spell', { cardUuid: source.uuid, targets: [{ targetType: 'player', playerId: 'player2' }] }).success).toBe(true);
    engine.resolveTopOfStack();
    expect(engine.roomState.players.player2.life).toBe(20 - amount);
    expect(engine.roomState.players.player1.graveyard.map(c => c.uuid)).toEqual([source.uuid]);
    const damage = engine.drainEventBatches().flatMap(b => b.events).find(e => e.eventId === 'DAMAGE_DEALT');
    expect(damage?.payload).toMatchObject({ amount, combat: false, card: { uuid: source.uuid }, recipient: { playerId: 'player2' } });
  });

  it('does not invent a scorch mode or silently pay a two-red cost with one red', () => {
    const { engine, source } = game('fireball', 1);
    expect(source.blueprint.onCastEffects.map(e => e.action)).toEqual(['MODIFY_LIFE']);
    expect(source.blueprint.modes).toBeUndefined();
    expect(engine.executePlayerAction('player1', 'cast_spell', { cardUuid: source.uuid, targets: [{ targetType: 'player', playerId: 'player2' }] }).success).toBe(false);
    expect(engine.roomState.players.player1.hand).toHaveLength(1);
    expect(engine.roomState.players.player2.life).toBe(20);
  });

  it('resolves 烈焰獠牙 as one ordered spell: destroy opposing land, then draw', () => {
    const { engine, source } = game('flame-fangs', 2);
    const land = instantiateCard('land-red');
    land.state = { ...land.state, zone: 'battlefield', ownerId: 'player2', controllerId: 'player2' };
    engine.roomState.battlefield.push(land);
    expect(source.blueprint.rulesText).not.toContain('未支援');
    expect(engine.executePlayerAction('player1', 'cast_spell', { cardUuid: source.uuid, targets: [{ targetType: 'permanent', cardUuid: land.uuid }] }).success).toBe(true);
    engine.resolveTopOfStack();
    expect(engine.roomState.players.player2.graveyard.map(c => c.uuid)).toEqual([land.uuid]);
    expect(engine.roomState.players.player1.hand).toHaveLength(1);
    const events = engine.drainEventBatches().flatMap(b => b.events);
    expect(events.findIndex(e => e.eventId === 'PERMANENT_LEFT')).toBeLessThan(events.findIndex(e => e.eventId === 'CARD_DRAWN'));
    expect(events.filter(e => e.eventId === 'STACK_ITEM_RESOLVED').map(e => e.payload.effectId)).toEqual(['DESTROY', 'DRAW']);
  });

  it.each(['land-red', 'awakened-blood-mountain'])('targets only an opponent’s eligible %s with 諸界帝國反抗軍’s attack', id => {
    const { engine, source } = game('worlds-rebel', 0);
    expect(source.blueprint.castRequirements.cost?.mana).toEqual({ generic: 3 });
    source.state.zone = 'battlefield'; source.state.summoningSickness = false;
    engine.roomState.players.player1.hand = [];
    engine.roomState.phase = 'declareAttackersStep'; engine.roomState.priorityPlayerId = null;
    const own = instantiateCard(id), opposing = instantiateCard(id), creature = instantiateCard('musketeer-infantry');
    for (const card of [own, opposing, creature]) card.state = { ...card.state, zone: 'battlefield', ownerId: card === own ? 'player1' : 'player2', controllerId: card === own ? 'player1' : 'player2' };
    engine.roomState.battlefield = [source, own, opposing, creature];
    registerAction('declare_attackers', declareAttackersHandler);
    expect(engine.executePlayerAction('player1', 'declare_attackers', { attackers: [{ cardUuid: source.uuid }] }).success).toBe(true);
    const choice = engine.roomState.pendingChoice!;
    expect(choice.kind).toBe('targets'); if (choice.kind === 'number') throw new Error('Expected target choice');
    expect(choice.options.map(o => (o.value as { cardUuid: string }).cardUuid)).toEqual([opposing.uuid]);
    expect(engine.executePlayerAction('player1', 'choose', { choiceId: choice.id, choices: [choice.options[0].id] }).success).toBe(true);
    expect(engine.roomState.stack[0]).toMatchObject({ source: { uuid: source.uuid }, ability: { id: 'attack-destroy' }, triggeringEvent: { eventId: 'ATTACK_DECLARED' } });
    engine.resolveTopOfStack();
    expect(engine.roomState.players.player2.graveyard.map(c => c.uuid)).toEqual([opposing.uuid]);
    expect(engine.roomState.battlefield.map(c => c.uuid)).toEqual([source.uuid, own.uuid, creature.uuid]);
    expect(source.blueprint.rulesText).toContain('未支援');
  });

  it.each([true, false])('offers the actual relic’s optional draw on opposing life loss (accept=%s)', accept => {
    const { engine } = game('awakened-blood-mountain', 0);
    const relic = engine.roomState.players.player1.hand[0]; relic.state.zone = 'battlefield';
    engine.roomState.players.player1.hand = []; engine.roomState.battlefield.push(relic);
    engine.applyMutations([{ type: 'SET_LIFE', playerId: 'player1', amount: 19 }]);
    expect(engine.roomState.stack).toEqual([]);
    engine.applyMutations([{ type: 'SET_LIFE', playerId: 'player2', amount: 19 }]);
    expect(engine.roomState.stack[0]).toMatchObject({ source: { uuid: relic.uuid }, ability: { id: 'opponent-life-loss-draw' } });
    engine.resolveTopOfStack();
    const c = engine.roomState.pendingChoice!;
    expect(c.kind).toBe('optional'); if (c.kind === 'number') throw new Error('Expected optional choice');
    const selected = c.options.find(o => o.value === accept)!;
    expect(engine.executePlayerAction('player1', 'choose', { choiceId: c.id, choices: [selected.id] }).success).toBe(true);
    expect(engine.roomState.players.player1.hand).toHaveLength(accept ? 1 : 0);
    expect(engine.roomState.stack).toEqual([]);
  });
});
