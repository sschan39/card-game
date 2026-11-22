import { expect } from 'vitest';
import { CardCharacteristicService as stats } from '@engine/card-characteristic-service';
import { planDamage } from '@engine/damage-service';
import { captureSourceInformation } from '@engine/source-information';
import { castWithPayment, choose, fixtureCard, passPriorityPair, permanent, resolveByPassing, type CardCase } from '../helpers/card-test-cases';

export default [true, false].map(rescue => ({
  name: `marks exactly two friendly Ice Dragons and can trade itself to save one at three life after overkill (${rescue})`,
  covers: ['play', 'ability:mark-two-dragons', 'ability:tomb-recovery'],
  prepare(room) {
    const traits = { subTypes: ['冰龍'], toughness: 5 };
    room.battlefield = [
      ...['first', 'second', 'unmarked'].map(id => fixtureCard(id, 'player1', 'battlefield', traits)),
      fixtureCard('ordinary', 'player1', 'battlefield'),
      fixtureCard('enemy', 'player2', 'battlefield', traits),
    ];
  },
  run(engine, source) {
    castWithPayment(engine, source, { white: 2 });
    resolveByPassing(engine);
    passPriorityPair(engine);
    const selection = engine.roomState.pendingChoice;
    if (selection?.kind !== 'selection') throw new Error('Expected Aurora recipients');
    expect([selection.min, selection.max]).toEqual([2, 2]);
    expect(selection.options.map(option => option.value).map(value => (value as { cardUuid: string }).cardUuid))
      .toEqual(['first', 'second', 'unmarked']);
    choose(engine, selection.options.slice(0, 2).map(option => option.id));
    expect(['first', 'second', 'unmarked', 'ordinary', 'enemy'].map(id => permanent(engine, id).state.counters.aurora ?? 0))
      .toEqual([1, 1, 0, 0, 0]);
    engine.applyMutations(planDamage(engine.roomState, [{
      source: captureSourceInformation(engine.roomState, permanent(engine, 'enemy')),
      recipient: { kind: 'permanent', cardUuid: 'first', zoneRevision: 0 },
      amount: 9, combat: false, preventable: false,
    }]));
    const recovery = engine.roomState.pendingChoice;
    if (recovery?.kind !== 'options') throw new Error('Expected the Dragon Tomb rescue choice');
    const decision = recovery.options.find(option => option.id.endsWith(':rescue') && option.id.startsWith('skip:') === !rescue);
    if (!decision) throw new Error('Expected the matching rescue decision');
    choose(engine, [decision.id]);
    expect(engine.roomState.players.player1.graveyard.map(card => card.uuid)).toEqual(rescue ? [source.uuid] : ['first']);
    if (rescue) {
      const survivor = permanent(engine, 'first');
      expect(stats.resolveToughness(engine.roomState, survivor) - survivor.state.damageTaken).toBe(3);
      expect(survivor.state.counters.aurora).toBe(1);
    } else {
      expect(permanent(engine, source.uuid).state.zone).toBe('battlefield');
    }
  },
}) satisfies CardCase);
