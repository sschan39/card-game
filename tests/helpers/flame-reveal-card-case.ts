import { expect } from 'vitest';
import type { GameEngine } from '@engine/game-engine';
import { instantiateCard } from '@library/card-factory';
import type { CardInstance } from '@shared/card.types';
import type { GameRoom } from '@shared/game.room.types';
import { castWithPayment, choose, fixtureCard, passPriorityPair, resolveByPassing } from './card-test-cases';

export const flameRevealCard = 'red-wolf';

export function prepareFlameReveal(room: GameRoom) {
  const player = room.players.player1;
  const [source] = player.hand.splice(0, 1);
  source.state.zone = 'library';
  player.deck = [fixtureCard('draw', 'player1', 'library'), source];
  const wolf = instantiateCard(flameRevealCard);
  wolf.state = { ...wolf.state, zone: 'hand', ownerId: 'player1', controllerId: 'player1' };
  player.hand.push(wolf);
}

export function revealWithFlameBeast(engine: GameEngine, source: CardInstance, select = false) {
  castWithPayment(engine, engine.roomState.players.player1.hand[0], { red: 2 });
  resolveByPassing(engine);
  passPriorityPair(engine);
  choose(engine, ['yes']);
  choose(engine, select ? [source.uuid] : []);
  choose(engine, select ? ['draw'] : [source.uuid, 'draw']);
  expect(engine.roomState.stack.at(-1)?.source.uuid).toBe(source.uuid);
  passPriorityPair(engine);
  expect(engine.roomState.pendingChoice?.kind).toBe('optional');
}
