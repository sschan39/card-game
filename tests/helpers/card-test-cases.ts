import { expect } from 'vitest';
import { GameEngine } from '@engine/game-engine';
import { instantiateCard, instantiateToken } from '@library/card-factory';
import { isTokenDefinition } from '@library/card-catalog';
import type { CardInstance } from '@shared/card.types';
import type { GameRoom, PlayerId } from '@shared/game.room.types';
import { createEmptyTestRoom } from './test-room-factory';

export interface CardCase {
  name: string;
  covers?: string[];
  requires?: string[];
  run: (engine: GameEngine, source: CardInstance) => void;
  prepare?: (room: GameRoom) => void;
}

export function runCardCase(id: string, scenario: CardCase): void {
  const room = createEmptyTestRoom();
  const token = isTokenDefinition(id);
  const source = token ? instantiateToken(id, 'player1') : instantiateCard(id);
  if (token) room.battlefield.push(source);
  else {
    source.state = { ...source.state, ownerId: 'player1', controllerId: 'player1', zone: 'hand' };
    room.players.player1.hand = [source];
  }
  scenario.prepare?.(room);
  const engine = new GameEngine(room);
  try {
    engine.initRoom();
    scenario.run(engine, source);
  } finally {
    engine.dispose();
  }
}

export function act(engine: GameEngine, action: string, data: unknown = {}, player: PlayerId = 'player1') {
  const result = engine.executePlayerAction(player, action, data);
  expect(result.success, result.reason).toBe(true);
}

export function passPriorityPair(engine: GameEngine) {
  for (let pass = 0; pass < 2; pass++) {
    const player = engine.roomState.priorityPlayerId;
    if (!player) throw new Error('Priority is blocked by a choice or declaration');
    act(engine, 'pass_priority', {}, player);
  }
}

export function resolveByPassing(engine: GameEngine) {
  const top = engine.roomState.stack.at(-1);
  expect(top).toBeDefined();
  passPriorityPair(engine);
  expect(engine.roomState.stack.some(item => item.uuid === top?.uuid)).toBe(false);
}
