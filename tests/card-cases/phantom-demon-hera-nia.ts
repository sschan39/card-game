import { expect } from 'vitest';
import { CardCharacteristicService as stats } from '@engine/card-characteristic-service';
import { instantiateCard } from '@library/card-factory';
import { act, castWithPayment, choose, fixtureCard, passPriorityPair, permanent, resolveByPassing, type CardCase } from '../helpers/card-test-cases';

export default [{
  name: 'returns to hand after being discarded by an effect',
  covers: ['ability:hera-nia-recover-hand'],
  requires: ['wind-spirit-regrowth'],
  prepare(room) {
    const spell = instantiateCard('wind-spirit-regrowth');
    spell.state = { ...spell.state, zone: 'hand', ownerId: 'player1', controllerId: 'player1' };
    room.players.player1.hand.push(spell);
  },
  run(engine, source) {
    act(engine, 'cast_spell', { cardUuid: engine.roomState.players.player1.hand[1].uuid, modes: ['replace-hand'] });
    resolveByPassing(engine);
    expect(engine.roomState.players.player1.graveyard.map(card => card.uuid)).toContain(source.uuid);
    expect(engine.roomState.stack.at(-1)?.ability?.id).toBe('hera-nia-recover-hand');
    passPriorityPair(engine);
    choose(engine, ['return']);
    expect(engine.roomState.players.player1.hand.map(card => card.uuid)).toEqual([source.uuid]);
  },
}, {
  name: 'may summon for two black after an effect mills it, then applies its own milled card’s settled graveyard mana value',
  covers: ['ability:hera-nia-recover-library', 'ability:phantom-plunder'],
  requires: ['phantom-ghostfire', 'phantom-puppet-sage'],
  prepare(room) {
    const [source] = room.players.player1.hand.splice(0, 1);
    source.state.zone = 'library';
    const ghostfire = instantiateCard('phantom-ghostfire');
    ghostfire.state = { ...ghostfire.state, zone: 'hand', ownerId: 'player1', controllerId: 'player1' };
    room.players.player1.hand.push(ghostfire);
    const sage = instantiateCard('phantom-puppet-sage');
    sage.state = { ...sage.state, zone: 'library', ownerId: 'player1', controllerId: 'player1' };
    room.players.player1.deck = [sage, source];
    room.battlefield = [fixtureCard('enemy', 'player2', 'battlefield', { toughness: 8 }), fixtureCard('other', 'player1', 'battlefield')];
  },
  run(engine, source) {
    castWithPayment(engine, engine.roomState.players.player1.hand[0], { black: 2, red: 1 });
    resolveByPassing(engine);
    passPriorityPair(engine);
    choose(engine, ['yes']);
    expect(engine.roomState.stack.at(-1)?.ability?.id).toBe('hera-nia-recover-library');
    passPriorityPair(engine);
    choose(engine, ['summon']);
    choose(engine, ['yes']);
    expect(engine.roomState.players.player1.mana.black).toBe(1);
    expect(permanent(engine, source.uuid).state.summonKind).toBe('effect');
    passPriorityPair(engine);
    const choice = engine.roomState.pendingChoice;
    if (choice?.kind !== 'selection') throw new Error('Expected the opposing creature selection');
    expect(choice.options.map(option => (option.value as { cardUuid: string }).cardUuid)).toEqual(['enemy']);
    choose(engine, [choice.options[0].id]);
    const toughness = () => stats.resolveToughness(engine.roomState, permanent(engine, 'enemy'));
    expect(engine.roomState.players.player1.graveyard.map(card => card.blueprint.id)).toEqual(['phantom-puppet-sage']);
    expect(toughness()).toBe(5);
    engine.applyMutations([{ type: 'CLEAR_END_OF_TURN_EFFECTS' }]);
    expect(toughness()).toBe(8);
  },
}, {
  name: 'can be cast normally and mills its top card on entry',
  covers: ['play', 'ability:phantom-plunder'],
  prepare(room) { room.players.player1.deck = [fixtureCard('top', 'player1', 'library')]; },
  run(engine, source) {
    castWithPayment(engine, source, { black: 2, red: 2 });
    resolveByPassing(engine);
    resolveByPassing(engine);
    expect(permanent(engine, source.uuid).state.summonKind).toBe('cast');
    expect(engine.roomState.players.player1.graveyard.map(card => card.uuid)).toEqual(['top']);
    expect(engine.roomState.pendingChoice).toBeFalsy();
  },
}] satisfies CardCase[];
