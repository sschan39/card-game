import { afterEach, describe, expect, it } from 'vitest';
import { GameEngine } from '@engine/game-engine';
import { instantiateCard } from '@library/card-factory';
import { CardCharacteristicService as characteristics } from '@engine/card-characteristic-service';
import { createTestRoom, fillTestLibraries } from '../helpers/test-room-factory';
import { creature } from '../helpers/combat-fixture';

const engines: GameEngine[] = [];
afterEach(() => { engines.splice(0).forEach(engine => engine.dispose()); });
function fixture(outsider: boolean) {
  const source = instantiateCard('bloodrage-maadini'); source.state = { ...source.state, ownerId: 'player1', controllerId: 'player1', zone: 'hand' };
  const ally = instantiateCard(outsider ? 'empire-servant' : 'worlds-pyromancer'); ally.state = { ...ally.state, zone: 'battlefield', ownerId: 'player1', controllerId: 'player1' };
  const artifact = instantiateCard('awakened-blood-mountain'); artifact.state = { ...artifact.state, zone: 'battlefield', ownerId: 'player1', controllerId: 'player1' };
  const enemy = creature('enemy', 'player2', 2, 6);
  const room = createTestRoom({ battlefield: [ally, artifact, enemy] }); fillTestLibraries(room); room.players.player1.hand = [source];
  const engine = new GameEngine(room); engine.initRoom(); engines.push(engine);
  expect(engine.executePlayerAction('player1', 'cast_spell', { cardUuid: source.uuid }).success).toBe(true);
  expect(engine.resolveTopOfStack().success).toBe(true);
  return { engine, source, ally };
}
describe('血怒之馬甸尼', () => {
  it('checks friendly creatures only, damages all enemy creatures then permanently gains 3/3', () => {
    const { engine, source, ally } = fixture(false);
    expect(engine.roomState.stack).toHaveLength(1);
    expect(engine.resolveTopOfStack().success).toBe(true);
    const current = engine.roomState.battlefield.find(card => card.uuid === source.uuid)!;
    expect(characteristics.resolve(engine.roomState, current)).toMatchObject({ power: 12, toughness: 8 });
    expect(characteristics.resolvePower(engine.roomState, ally)).toBe(5);
    expect(engine.roomState.battlefield.find(card => card.uuid === 'enemy')?.state.damageTaken).toBe(4);
    engine.applyMutations([{ type: 'CLEAR_END_OF_TURN_EFFECTS' }, { type: 'CLEAR_DAMAGE' }]);
    expect(characteristics.resolve(engine.roomState, current)).toMatchObject({ power: 12, toughness: 8 });
    engine.applyMutations([{ type: 'MOVE_CARD', cardUuid: source.uuid, playerId: 'player1', from: 'battlefield', to: 'hand' }]);
    expect(characteristics.resolve(engine.roomState, engine.roomState.players.player1.hand.find(card => card.uuid === source.uuid)!)).toMatchObject({ power: 6, toughness: 5 });
  });
  it('does neither entry effect when a friendly creature is outside 幽爾', () => {
    const { engine, source, ally } = fixture(true);
    expect(engine.roomState.stack).toHaveLength(0);
    expect(characteristics.resolvePower(engine.roomState, ally)).toBe(1);
    expect(engine.roomState.battlefield.find(card => card.uuid === 'enemy')?.state.damageTaken).toBe(0);
    expect(characteristics.resolve(engine.roomState, engine.roomState.battlefield.find(card => card.uuid === source.uuid)!)).toMatchObject({ power: 9, toughness: 5 });
  });
  it('rechecks the whole condition at resolution', () => {
    const { engine, source } = fixture(false);
    const outsider = creature('outsider', 'player1'); engine.roomState.battlefield.push(outsider);
    expect(engine.resolveTopOfStack().success).toBe(true);
    expect(engine.roomState.battlefield.find(card => card.uuid === 'enemy')?.state.damageTaken).toBe(0);
    engine.applyMutations([{ type: 'MOVE_CARD', cardUuid: source.uuid, playerId: 'player1', from: 'battlefield', to: 'hand' }]);
    const returned = engine.roomState.players.player1.hand.find(card => card.uuid === source.uuid)!;
    expect(characteristics.resolve(engine.roomState, returned)).toMatchObject({ power: 6, toughness: 5 });
  });
});
