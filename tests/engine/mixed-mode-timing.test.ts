import { afterEach, describe, expect, it } from 'vitest';
import { instantiateCard } from '@library/card-factory';
import { GameEngine } from '@engine/game-engine';
import { playCardHandler } from '@engine/handlers/play-card-handler';
import { createTestRoom, fillTestLibraries } from '../helpers/test-room-factory';
import { gameConfig } from '@config';

const engines: GameEngine[] = [];
afterEach(() => engines.splice(0).forEach(engine => engine.dispose()));
function fixture(opponentTurn = false) {
  const room = createTestRoom({ setup: { ...structuredClone(gameConfig.setup), scorch: true }, activeTurnPlayerId: opponentTurn ? 'player2' : 'player1' });
  fillTestLibraries(room);
  const source = instantiateCard('fireball');
  source.state = { ...source.state, zone: 'hand', ownerId: 'player1', controllerId: 'player1' };
  room.players.player1.hand = [source]; room.players.player1.mana.red = 2;
  const target = instantiateCard('empire-servant');
  target.state = { ...target.state, zone: 'battlefield', ownerId: 'player2', controllerId: 'player2' };
  room.battlefield = [target];
  const engine = new GameEngine(room); engine.initRoom(); engines.push(engine);
  return { engine, source, target };
}
function choose(engine: GameEngine, id: string) {
  const choice = engine.roomState.pendingChoice!;
  expect(choice).toBeTruthy();
  expect(engine.executePlayerAction('player1', 'choose', { choiceId: choice.id, choices: [id] }).success).toBe(true);
}

describe('real Fireball mixed timing modes', () => {
  it.each([false, true])('offers only modes legal at the current timing (opponent turn=%s)', opponentTurn => {
    const { engine, source } = fixture(opponentTurn);
    expect(engine.executePlayerAction('player1', 'cast_spell', { cardUuid: source.uuid }).success).toBe(true);
    const choice = engine.roomState.pendingChoice!;
    expect(choice.kind).toBe('modes'); if (choice.kind === 'number') throw new Error('Expected modes');
    expect(choice.options.map(option => option.id)).toEqual(opponentTurn ? ['instant-damage'] : ['main-scorch', 'instant-damage']);
    expect(engine.roomState.players.player1.mana.red).toBe(2);
  });

  it('rejects a forged main mode on the opponent turn through both execution and direct handler validation', () => {
    const { engine, source, target } = fixture(true);
    const data = { cardUuid: source.uuid, modes: ['main-scorch'], targets: [{ targetType: 'permanent', cardUuid: target.uuid }] };
    expect(engine.executePlayerAction('player1', 'cast_spell', data).success).toBe(false);
    expect(playCardHandler.validate(engine.roomState, 'player1', data).success).toBe(false);
    expect(playCardHandler.propose(engine.roomState, 'player1', data).success).toBe(false);
    expect(engine.roomState.players.player1.mana.red).toBe(2);
    expect(engine.roomState.players.player1.hand).toHaveLength(1);
    expect(engine.roomState.stack).toEqual([]);
  });

  it('announces main mode and its opposing permanent target, then resolves Scorch 2 and ordinary destruction', () => {
    const { engine, source, target } = fixture();
    expect(engine.executePlayerAction('player1', 'cast_spell', { cardUuid: source.uuid }).success).toBe(true);
    choose(engine, 'main-scorch');
    const choice = engine.roomState.pendingChoice!;
    expect(choice.kind).toBe('targets'); if (choice.kind === 'number') throw new Error('Expected targets');
    expect(choice.options).toHaveLength(1);
    expect(choice.options[0].value).toMatchObject({ targetType: 'permanent', cardUuid: target.uuid });
    choose(engine, choice.options[0].id);
    expect(engine.roomState.stack[0].effects[0]).toMatchObject({ action: 'ADD_COUNTER', params: { counterType: 'scorch', amount: 2 } });
    expect(engine.resolveTopOfStack().success).toBe(true);
    expect(engine.roomState.players.player1.mana.red).toBe(0);
    expect(engine.roomState.players.player2.graveyard.map(card => card.uuid)).toContain(target.uuid);
    expect(engine.roomState.players.player1.graveyard.map(card => card.uuid)).toContain(source.uuid);
    expect(engine.roomState.players.player2.life).toBe(20);
  });

  it('announces instant mode on the opponent turn and resolves five damage to the opposing player', () => {
    const { engine, source } = fixture(true);
    expect(engine.executePlayerAction('player1', 'cast_spell', { cardUuid: source.uuid }).success).toBe(true);
    choose(engine, 'instant-damage');
    const choice = engine.roomState.pendingChoice!;
    expect(choice.kind).toBe('targets'); if (choice.kind === 'number') throw new Error('Expected targets');
    expect(choice.options.map(option => option.value)).toEqual([{ targetType: 'player', playerId: 'player2' }]);
    choose(engine, choice.options[0].id);
    expect(engine.resolveTopOfStack().success).toBe(true);
    expect(engine.roomState.players.player2.life).toBe(15);
    expect(engine.roomState.players.player1.mana.red).toBe(0);
    expect(engine.roomState.players.player1.graveyard.map(card => card.uuid)).toContain(source.uuid);
  });

  it('places Scorch on opposing Artifacts while visibly deferring their destruction rule', () => {
    const { engine, source, target } = fixture();
    target.blueprint = { ...target.blueprint, cardTypes: ['Artifact'] };
    expect(source.blueprint.rulesText).toContain('暫緩：遺跡的灼熱破壞門檻');
    expect(engine.executePlayerAction('player1', 'cast_spell', { cardUuid: source.uuid, modes: ['main-scorch'], targets: [{ targetType: 'permanent', cardUuid: target.uuid }] }).success).toBe(true);
    expect(engine.resolveTopOfStack().success).toBe(true);
    expect(engine.roomState.battlefield.find(card => card.uuid === target.uuid)?.state.counters.scorch).toBe(2);
  });
});
