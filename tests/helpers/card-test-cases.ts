import { expect } from 'vitest';
import { GameEngine } from '@engine/game-engine';
import { instantiateCard, instantiateToken } from '@library/card-factory';
import { isTokenDefinition } from '@library/card-catalog';
import type { CardBlueprint, CardInstance, CardZone, ManaPayment } from '@shared/card.types';
import type { GameRoom, PlayerId } from '@shared/game.room.types';
import { createEmptyTestRoom } from './test-room-factory';
import { creature } from './combat-fixture';

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

export function choose(engine: GameEngine, ids: string[]) {
  const choice = engine.roomState.pendingChoice;
  if (!choice) throw new Error('Expected a rules choice');
  act(engine, 'choose', { choiceId: choice.id, choices: ids }, choice.playerId);
}

export function chooseTarget(engine: GameEngine, cardUuid: string, eligible: string[]) {
  const choice = engine.roomState.pendingChoice;
  if (choice?.kind !== 'targets') throw new Error('Expected a target choice');
  const options = choice.options.map(option => ({ id: option.id, cardUuid: (option.value as { cardUuid?: string }).cardUuid }));
  expect(options.map(option => option.cardUuid).sort()).toEqual([...eligible].sort());
  const target = options.find(option => option.cardUuid === cardUuid);
  if (!target) throw new Error('The intended target is missing');
  choose(engine, [target.id]);
}

export function declareAttack(engine: GameEngine, cardUuid: string, player: PlayerId = 'player1') {
  engine.applyMutations([{ type: 'SET_SUMMONING_SICKNESS', cardUuid, value: false }]);
  engine.roomState.phase = 'declareAttackersStep';
  engine.roomState.priorityPlayerId = null;
  act(engine, 'declare_attackers', { attackers: [{ cardUuid }] }, player);
}

export function fixtureCard(uuid: string, owner: PlayerId, zone: CardZone, traits: Partial<CardBlueprint> = {}): CardInstance {
  const card = creature(uuid, owner);
  card.state.zone = zone;
  card.blueprint = { ...card.blueprint, ...traits };
  return card;
}

export function castWithPayment(engine: GameEngine, source: CardInstance, payment: ManaPayment, announcement: object = {}) {
  const before = engine.roomState.players.player1.mana;
  const remaining = Object.fromEntries(Object.entries(before).map(([color, amount]) =>
    [color, amount - (payment[color as keyof ManaPayment] ?? 0)]));
  act(engine, 'cast_spell', { ...announcement, cardUuid: source.uuid, payment });
  expect(engine.roomState.players.player1.mana).toEqual(remaining);
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
