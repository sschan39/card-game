import { expect } from 'vitest';
import { CardCharacteristicService as stats } from '@engine/card-characteristic-service';
import { castWithPayment, fixtureCard, resolveByPassing, type CardCase } from '../helpers/card-test-cases';

export default (['all-yoel', 'outsider', 'joins-late'] as const).map(situation => ({
  name: `checks the whole friendly creature condition and applies its separate Yoel anthem (${situation})`,
  covers: ['play', 'ability:yoer-entry', 'ability:yoer-attack-bonus'],
  prepare(room) {
    room.battlefield = [
      fixtureCard('ally', 'player1', 'battlefield', { subTypes: situation === 'outsider' ? [] : ['幽爾'] }),
      fixtureCard('relic', 'player1', 'battlefield', { cardTypes: ['Artifact'] }),
      fixtureCard('enemy', 'player2', 'battlefield', { subTypes: ['幽爾'], toughness: 6 }),
    ];
  },
  run(engine, source) {
    castWithPayment(engine, source, { red: 4 });
    resolveByPassing(engine);
    if (situation === 'joins-late') {
      engine.roomState.battlefield.push(fixtureCard('new-outsider', 'player1', 'battlefield'));
    }
    if (situation !== 'outsider') resolveByPassing(engine);
    const card = (id: string) => engine.roomState.battlefield.find(item => item.uuid === id)!;
    const qualified = situation === 'all-yoel';
    expect(card('enemy').state.damageTaken).toBe(qualified ? 4 : 0);
    expect(stats.resolvePower(engine.roomState, card('enemy'))).toBe(2);
    expect(stats.resolvePower(engine.roomState, card('ally'))).toBe(situation === 'outsider' ? 2 : 5);
    engine.applyMutations([{ type: 'CLEAR_END_OF_TURN_EFFECTS' }]);
    expect(stats.resolve(engine.roomState, card(source.uuid))).toMatchObject({ power: qualified ? 12 : 9, toughness: qualified ? 8 : 5 });
  },
}) satisfies CardCase);
