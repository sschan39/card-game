import { expect } from 'vitest';
import { planDamage } from '@engine/damage-service';
import { captureSourceInformation } from '@engine/source-information';
import { castWithPayment, declareAttack, fixtureCard, permanent, resolveByPassing, type CardCase } from '../helpers/card-test-cases';

export default [true, false].map(friendly => ({
  name: `reduces damage only on friendly marked Ice Dragons and draws only on friendly Ice Dragon attacks (friendly attack: ${friendly})`,
  covers: ['play', 'ability:marked-dragon-reduction', 'ability:draw-on-friendly-dragon-attack'],
  prepare(room) {
    const dragon = { subTypes: ['冰龍'], toughness: 7 };
    const ally = fixtureCard('marked', 'player1', 'battlefield', dragon);
    const enemy = fixtureCard('enemy', 'player2', 'battlefield', dragon);
    ally.state.counters.aurora = 1;
    enemy.state.counters.aurora = 1;
    room.battlefield = [ally, enemy, fixtureCard('unmarked', 'player1', 'battlefield', dragon)];
    room.players.player1.deck = ['bottom', 'top'].map(id => fixtureCard(id, 'player1', 'library'));
  },
  run(engine, source) {
    castWithPayment(engine, source, { white: 2, red: 2 });
    resolveByPassing(engine);
    const battle = ['marked', 'enemy', 'unmarked'];
    engine.applyMutations(planDamage(engine.roomState, battle.map(cardUuid => ({
      recipient: { kind: 'permanent', cardUuid, zoneRevision: 0 },
      source: captureSourceInformation(engine.roomState, permanent(engine, 'enemy')),
      amount: 2, combat: false, preventable: false,
    }))));
    expect(battle.map(id => permanent(engine, id).state.damageTaken)).toEqual([1, 2, 2]);
    const side = friendly ? 'player1' : 'player2';
    engine.roomState.activeTurnPlayerId = side;
    declareAttack(engine, friendly ? 'marked' : 'enemy', side);
    if (friendly) resolveByPassing(engine);
    expect(engine.roomState.stack).toEqual([]);
    expect(engine.roomState.players.player1.hand.map(card => card.uuid)).toEqual(friendly ? ['top'] : []);
  },
}) satisfies CardCase);
