import { afterEach, describe, expect, it } from 'vitest';
import { GameEngine } from '../../src/engine/game-engine';
import { buildStackEffects } from '../../src/engine/effect-resolver';
import { normalizeCard } from '../../src/library/card-parser';
import { createTestRoom, fillTestLibraries } from '../helpers/test-room-factory';
import { creature } from '../helpers/combat-fixture';

const engines: GameEngine[] = [];
afterEach(() => engines.splice(0).forEach(engine => engine.dispose()));
function fixture(prevent: 'none' | 'indestructible' | 'exile' | 'choice') {
  const source = creature('source', 'player1', 4, 4), victim = creature('victim', 'player2', 3, 3, prevent === 'indestructible' ? ['Indestructible'] : []);
  const room = createTestRoom({ battlefield: [source, victim] }); fillTestLibraries(room); room.players.player1.hand = [];
  if (prevent === 'exile' || prevent === 'choice') room.replacementEffects = [{ id: 'redirect', label: 'Exile instead', match: { kinds: ['destroy'] }, operation: { type: 'move_destination', to: 'exile' }, optional: prevent === 'choice' }];
  const engine = new GameEngine(room); engine.initRoom(); engines.push(engine);
  const blueprint = normalizeCard({ id: 'outcome-fixture', onCastEffects: [
    { action: 'DESTROY', params: {}, targeting: { type: 'permanent', required: true }, recordOutcome: { name: 'destroyed', kind: 'destroyed' } },
    { action: 'DRAW', params: { amount: 1 }, targeting: { type: 'self', required: false }, requiresOutcome: 'destroyed' },
  ] });
  const effects = buildStackEffects(blueprint.onCastEffects, 'player1', source);
  effects[0].targets = [{ targetType: 'permanent', cardUuid: victim.uuid, zoneRevision: 0 }];
  engine.applyMutations([{ type: 'PUSH_STACK', stackObject: { type: 'triggered', uuid: 'ability', source, controllerId: 'player1', effects, countered: false } }]);
  return engine;
}
describe('resolution-local actual outcomes', () => {
  it.each(['none', 'indestructible', 'exile'] as const)('draws only when this effect really destroys into the graveyard (%s)', prevent => {
    const engine = fixture(prevent);
    expect(engine.resolveTopOfStack().success).toBe(true);
    expect(engine.roomState.players.player1.hand).toHaveLength(prevent === 'none' ? 1 : 0);
    expect(engine.roomState.players.player2.graveyard).toHaveLength(prevent === 'none' ? 1 : 0);
  });
  it.each([true, false])('retains the result across a serialized replacement decision (redirect=%s)', redirect => {
    const engine = fixture('choice'); expect(engine.resolveTopOfStack().success).toBe(true);
    const choice = engine.roomState.pendingChoice!; expect(choice).toBeTruthy();
    engine.roomState.pendingChoice = JSON.parse(JSON.stringify(choice));
    expect(engine.executePlayerAction(choice.playerId, 'choose', { choiceId: choice.id, choices: [redirect ? 'redirect' : 'skip:redirect'] }).success).toBe(true);
    expect(engine.roomState.players.player1.hand).toHaveLength(redirect ? 0 : 1);
  });
});
