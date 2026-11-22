import { expect } from 'vitest';
import type { GameEngine } from '@engine/game-engine';
import { choose, fixtureCard, permanent, resolveByPassing } from './card-test-cases';

export const freezeOpponents = ['enemy-1', 'enemy-2', 'enemy-3', 'enemy-4'];

export function freezeBoard() {
  return [...freezeOpponents.map(id => fixtureCard(id, 'player2', 'battlefield')),
    fixtureCard('ordinary', 'player1', 'battlefield')];
}

export function freezeThree(engine: GameEngine) {
  const choice = engine.roomState.pendingChoice;
  if (choice?.kind !== 'targets') throw new Error('Expected the three opposing freeze targets');
  expect([choice.min, choice.max]).toEqual([3, 3]);
  expect(choice.options.map(option => (option.value as { cardUuid: string }).cardUuid).sort()).toEqual(freezeOpponents);
  const choices = choice.options.filter(option => (option.value as { cardUuid: string }).cardUuid !== 'enemy-4');
  choose(engine, choices.map(option => option.id));
  resolveByPassing(engine);
  expect(freezeOpponents.map(id => {
    const { isTapped, skipNextUntap } = permanent(engine, id).state;
    return [isTapped, Boolean(skipNextUntap)];
  })).toEqual([[true, true], [true, true], [true, true], [false, false]]);
}
