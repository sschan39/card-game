import { expect } from 'vitest';
import { act, castWithPayment, fixtureCard, resolveByPassing, type CardCase } from '../helpers/card-test-cases';

export default (['self-block', 'other-block', 'destroy', 'sacrifice'] as const).map(event => ({
  name: `only its own block or destruction recovers one life and draws (${event})`,
  covers: ['play', event.endsWith('block') ? 'ability:block-recovery' : 'ability:destroyed-recovery'],
  prepare(room) {
    room.battlefield = [fixtureCard('ally', 'player1', 'battlefield'), fixtureCard('enemy', 'player2', 'battlefield')];
    room.players.player1.deck = [fixtureCard('draw', 'player1', 'library')];
  },
  run(engine, source) {
    castWithPayment(engine, source, { yellow: 1, red: 1 });
    resolveByPassing(engine);
    const live = engine.roomState.battlefield.find(card => card.uuid === source.uuid)!;
    if (event === 'destroy') {
      engine.applyMutations([{ type: 'DESTROY_CARD', cardUuid: source.uuid, zoneRevision: live.state.zoneRevision ?? 0 }]);
    } else if (event === 'sacrifice') {
      engine.applyMutations([{ type: 'MOVE_CARD', cardUuid: source.uuid, playerId: 'player1', from: 'battlefield', to: 'graveyard', reason: 'sacrifice' }]);
    } else {
      const enemy = engine.roomState.battlefield.find(card => card.uuid === 'enemy')!;
      Object.assign(engine.roomState, {
        activeTurnPlayerId: 'player2', phase: 'declareBlockersStep', priorityPlayerId: null,
        combatDeclarations: { attackers: true, blockers: false },
        combat: [{ uuid: enemy.uuid, attacker: enemy, attackerPower: 2, blockers: [] }],
      });
      act(engine, 'declare_blockers', { assignments: [{ attackerUuid: enemy.uuid, blockerUuids: [
        event === 'self-block' ? source.uuid : 'ally',
      ] }] });
    }
    const triggers = event === 'self-block' || event === 'destroy';
    expect(engine.roomState.stack).toHaveLength(triggers ? 1 : 0);
    if (triggers) resolveByPassing(engine);
    expect(engine.roomState.players.player1.life).toBe(triggers ? 21 : 20);
    expect(engine.roomState.players.player1.hand.map(card => card.uuid)).toEqual(triggers ? ['draw'] : []);
  },
}) satisfies CardCase);
