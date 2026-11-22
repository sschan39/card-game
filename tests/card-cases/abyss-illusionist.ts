import { expect } from 'vitest';
import { castWithPayment, declareAttack, fixtureCard, resolveByPassing, type CardCase } from '../helpers/card-test-cases';

export default (['friendly-giant', 'friendly-other', 'opposing-giant'] as const).map(situation => ({
  name: `mills only from a friendly Giant attack (${situation})`,
  covers: ['play', 'ability:friendly-attack-library-discard'],
  prepare(room) {
    const side = situation === 'opposing-giant' ? 'player2' : 'player1';
    room.battlefield = [fixtureCard('attacker', side, 'battlefield', {
      subTypes: situation === 'friendly-other' ? [] : ['蒼巨人'],
    })];
    for (const player of ['player1', 'player2']) {
      room.players[player].deck = ['bottom', 'top'].map(id => fixtureCard(player + '-' + id, player, 'library'));
    }
  },
  run(engine, source) {
    castWithPayment(engine, source, { blue: 3 });
    resolveByPassing(engine);
    const side = situation === 'opposing-giant' ? 'player2' : 'player1';
    engine.roomState.activeTurnPlayerId = side;
    declareAttack(engine, 'attacker', side);
    if (situation === 'friendly-giant') resolveByPassing(engine);
    expect(engine.roomState.stack).toHaveLength(0);
    expect(engine.roomState.players.player1.graveyard).toHaveLength(0);
    expect(engine.roomState.players.player2.graveyard.map(card => card.uuid))
      .toEqual(situation === 'friendly-giant' ? ['player2-top'] : []);
  },
}) satisfies CardCase);
