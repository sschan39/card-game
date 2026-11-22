import { expect } from 'vitest';
import { castWithPayment, chooseTarget, declareAttack, fixtureCard, resolveByPassing, type CardCase } from '../helpers/card-test-cases';

export default (['friendly-yoel', 'friendly-other', 'opposing-yoel'] as const).map(situation => ({
  name: `a friendly Yoel attack deals two damage before drawing one (${situation})`,
  covers: ['play', 'ability:friendly-attack-damage-draw'],
  prepare(room) {
    const attacker = fixtureCard('attacker', situation === 'opposing-yoel' ? 'player2' : 'player1', 'battlefield', {
      subTypes: situation === 'friendly-other' ? [] : ['幽爾'],
    });
    room.battlefield = [attacker, fixtureCard('enemy', 'player2', 'battlefield')];
    room.players.player1.deck = [fixtureCard('draw', 'player1', 'library')];
  },
  run(engine, source) {
    castWithPayment(engine, source, { red: 2 });
    resolveByPassing(engine);
    const side = situation === 'opposing-yoel' ? 'player2' : 'player1';
    engine.roomState.activeTurnPlayerId = side;
    declareAttack(engine, 'attacker', side);
    if (situation === 'friendly-yoel') {
      chooseTarget(engine, 'enemy', ['enemy']);
      resolveByPassing(engine);
      const effects = engine.drainEventBatches().flatMap(batch => batch.events)
        .filter(event => event.eventId === 'STACK_ITEM_RESOLVED').map(event => event.payload.effectId);
      expect(effects).toEqual(['MODIFY_STATS', 'DRAW']);
    }
    expect(engine.roomState.pendingChoice).toBeFalsy();
    expect(engine.roomState.players.player1.hand.map(card => card.uuid)).toEqual(situation === 'friendly-yoel' ? ['draw'] : []);
    expect(engine.roomState.battlefield.find(card => card.uuid === 'enemy')?.state.damageTaken).toBe(situation === 'friendly-yoel' ? 2 : 0);
  },
}) satisfies CardCase);
