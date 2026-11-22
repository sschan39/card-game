import { expect } from 'vitest';
import { castWithPayment, choose, declareAttack, fixtureCard, passPriorityPair, permanent, resolveByPassing, type CardCase } from '../helpers/card-test-cases';

export default [{
  name: 'a friendly Flame Beast attack reveals three, counts only Flame Beast creatures and Flame Soldier spells, and orders all three',
  covers: ['play', 'ability:flame-beast-attack-reveal'],
  prepare(room) {
    room.battlefield = [
      fixtureCard('ally', 'player1', 'battlefield', { subTypes: ['炎獸'] }),
      fixtureCard('enemy', 'player2', 'battlefield', { toughness: 10 }),
    ];
    room.players.player1.deck = [
      fixtureCard('deep', 'player1', 'library', { subTypes: ['炎獸'] }),
      fixtureCard('soldier-spell', 'player1', 'library', { subTypes: ['炎兵'], cardTypes: ['Spell'] }),
      fixtureCard('beast', 'player1', 'library', { subTypes: ['炎獸'] }),
      fixtureCard('wrong-type', 'player1', 'library', { subTypes: ['炎兵'] }),
    ];
  },
  run(engine, source) {
    castWithPayment(engine, source, { red: 3, white: 1 });
    resolveByPassing(engine);
    declareAttack(engine, 'ally');
    passPriorityPair(engine);
    choose(engine, ['yes']);
    const choice = engine.roomState.pendingChoice;
    if (!choice || choice.kind === 'number') throw new Error('Expected a Scorch recipient');
    expect(choice.options.map(option => (option.value as { cardUuid: string }).cardUuid)).toEqual(['enemy']);
    choose(engine, [choice.options[0].id]);
    expect(permanent(engine, 'enemy').state.counters.scorch).toBe(2);
    choose(engine, ['beast', 'wrong-type', 'soldier-spell']);
    expect(engine.roomState.players.player1.deck.map(card => card.uuid)).toEqual(['soldier-spell', 'wrong-type', 'beast', 'deep']);
    expect(engine.drainEventBatches().flatMap(batch => batch.events).filter(event => event.eventId === 'CARD_REVEALED')).toHaveLength(3);
  },
}, {
  name: 'on its own attack, deals one hit of three times the live opposing Scorch total',
  covers: ['ability:scorch-attack-damage'],
  prepare(room) {
    const ally = fixtureCard('ally', 'player1', 'battlefield');
    const first = fixtureCard('first', 'player2', 'battlefield', { toughness: 20 });
    const second = fixtureCard('second', 'player2', 'battlefield', { toughness: 20 });
    ally.state.counters.scorch = 4;
    first.state.counters.scorch = 1;
    second.state.counters.scorch = 2;
    room.battlefield = [ally, first, second, fixtureCard('land', 'player2', 'battlefield', { cardTypes: ['Land'] })];
  },
  run(engine, source) {
    castWithPayment(engine, source, { red: 3, white: 1 });
    resolveByPassing(engine);
    declareAttack(engine, source.uuid);
    const order = engine.roomState.pendingChoice;
    if (order?.kind !== 'ordering') throw new Error('Expected independent attack trigger ordering');
    choose(engine, order.options.map(option => option.id));
    const targets = engine.roomState.pendingChoice;
    if (targets?.kind !== 'targets') throw new Error('Expected a damage target');
    const options = targets.options.map(option => ({ id: option.id, target: option.value as { cardUuid?: string; playerId?: string } }));
    expect(options.map(({ target }) => target.cardUuid ?? target.playerId).sort()).toEqual(['first', 'player2', 'second']);
    choose(engine, [options.find(({ target }) => target.playerId === 'player2')!.id]);
    engine.applyMutations([{ type: 'ADD_COUNTER', cardUuid: 'second', counterType: 'scorch', amount: 1 }]);
    if (engine.roomState.stack.at(-1)?.ability?.id === 'flame-beast-attack-reveal') {
      passPriorityPair(engine);
      choose(engine, ['no']);
    }
    resolveByPassing(engine);
    expect(engine.roomState.players.player2.life).toBe(8);
    const hits = engine.drainEventBatches().flatMap(batch => batch.events).filter(event => event.eventId === 'DAMAGE_DEALT');
    expect(hits.map(event => event.payload.amount)).toEqual([12]);
  },
}] satisfies CardCase[];
