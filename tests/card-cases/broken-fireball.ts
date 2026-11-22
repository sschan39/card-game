import { expect } from 'vitest';
import { instantiateCard } from '@library/card-factory';
import { act, passPriorityPair, resolveByPassing, type CardCase } from '../helpers/card-test-cases';
import type { GameEngine } from '@engine/game-engine';

function choose(engine: GameEngine, ids: string[]) {
  const choice = engine.roomState.pendingChoice;
  if (!choice) throw new Error('Expected a reveal choice');
  act(engine, 'choose', { choiceId: choice.id, choices: ids }, choice.playerId);
}

const cast: CardCase = {
  name: 'rejects self-targeting, then pays one red to deal three damage on the opposing turn',
  covers: ['play', 'cast effects'],
  prepare(room) { room.activeTurnPlayerId = 'player2'; },
  run(engine, source) {
    const castAt = (playerId: string) => ({ cardUuid: source.uuid, targets: [{ targetType: 'player', playerId }] });
    expect(engine.executePlayerAction('player1', 'cast_spell', castAt('player1')).success).toBe(false);
    expect(engine.roomState.players.player1.mana.red).toBe(5);
    expect(engine.roomState.stack).toHaveLength(0);
    act(engine, 'cast_spell', castAt('player2'));
    expect(engine.roomState.players.player1.mana.red).toBe(4);
    resolveByPassing(engine);
    expect(engine.roomState.players.player2.life).toBe(17);
    expect(engine.roomState.players.player1.graveyard.map(card => card.uuid)).toEqual([source.uuid]);
    const damage = engine.drainEventBatches().flatMap(batch => batch.events).find(event => event.eventId === 'DAMAGE_DEALT');
    expect(damage?.payload).toMatchObject({ amount: 3, combat: false, card: { uuid: source.uuid }, recipient: { playerId: 'player2' } });
  },
};

const reveal: CardCase[] = [true, false].map(accept => ({
  name: accept ? 'claims itself when revealed by Red Wolf' : 'stays in the library when the revealed claim is declined',
  covers: ['ability:revealed-self-claim'],
  requires: ['red-wolf'],
  prepare(room) {
    const player = room.players.player1;
    const fireball = player.hand.pop();
    if (!fireball) throw new Error('The test card must start in hand');
    fireball.state.zone = 'library';
    player.deck.push(fireball);
    const wolf = instantiateCard('red-wolf');
    wolf.state = { ...wolf.state, zone: 'hand', ownerId: 'player1', controllerId: 'player1' };
    player.hand.push(wolf);
  },
  run(engine, source) {
    const wolf = engine.roomState.players.player1.hand[0];
    act(engine, 'cast_spell', { cardUuid: wolf.uuid });
    resolveByPassing(engine);
    passPriorityPair(engine);
    choose(engine, ['yes']);
    choose(engine, []);
    choose(engine, [source.uuid]);
    expect(engine.roomState.stack.at(-1)?.source.uuid).toBe(source.uuid);
    passPriorityPair(engine);
    choose(engine, [accept ? 'yes' : 'no']);
    expect(engine.roomState.players.player1.hand.some(card => card.uuid === source.uuid)).toBe(accept);
    expect(engine.roomState.players.player1.deck.some(card => card.uuid === source.uuid)).toBe(!accept);
  },
}));

export default [cast, ...reveal];
