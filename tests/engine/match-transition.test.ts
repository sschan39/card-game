import { expect, it } from 'vitest';
import { executeMatchCommand, startMatchPosition, type MatchTransition } from '@engine/match-transition';
import { CardCharacteristicService } from '@engine/card-characteristic-service';
import { parseCardDefinition, parseCounterDefinitions } from '@card-game/engine/rules/parse';
import type { MatchPosition } from '@shared/game.room.types';
import type { PlayerState } from '@shared/game.player.types';

it('starts, finishes and replays caller-owned gameplay with synthetic content', () => {
  const token = parseCardDefinition({
    schemaVersion: 1, id: 'synthetic-token', name: 'Synthetic token',
    cardTypes: ['Creature'], power: 1, toughness: 1, abilities: [],
    onEnterEffects: [{
      family: 'counters', operation: 'add', params: { counterType: 'synthetic-mark', amount: 2 },
      targeting: { type: 'self', subject: 'source', required: false },
    }],
  });
  const card = parseCardDefinition({
    schemaVersion: 1, id: 'synthetic-source', name: 'Synthetic source',
    cardTypes: ['Spell'], castRequirements: { speed: 'instant' }, abilities: [],
    onCastEffects: [{
      family: 'cards', operation: 'create_token', params: { tokenId: token.id, amount: 1 },
    }],
  });
  const counters = parseCounterDefinitions({
    'synthetic-mark': { maxPerCard: 1, rules: [{
      id: 'boost', family: 'characteristics', scope: { self: true },
      operation: { type: 'STAT_DELTA', power: 2 },
    }] },
  });
  const seats = ['first-seat', 'second-seat'] as const;
  const player = (id: string): PlayerState => ({
    id, life: 12, mana: { white: 0, blue: 0, black: 0, red: 0, green: 0, yellow: 0 },
    hand: [], deck: [], graveyard: [],
  });
  const initial = {
    player1Id: seats[0], player2Id: seats[1], players: Object.fromEntries(seats.map(id => [id, player(id)])),
    status: 'waiting', phase: 'stateMainPhase', engineState: 'waiting_for_player',
    activeTurnPlayerId: seats[0], priorityPlayerId: null, lastPassedPlayerId: null,
    setup: { firstPlayerDrawsOnFirstTurn: false, landPlaysPerTurn: 0 }, debugMode: 'off',
    stack: [], battlefield: [], combat: [], continuousEffectPool: [],
    matchContent: { tokenBlueprints: { [token.id]: token }, counterDefinitions: counters },
  } satisfies MatchPosition;

  function run(serialize: boolean) {
    let generated = 0;
    const runtime = { uuid: () => `synthetic-${++generated}`, random: () => 0.5 };
    const correlationId = 'trace-only';
    let current: MatchTransition<unknown> = startMatchPosition(initial, seats[0], {
      openingHandSize: 1,
      bySeat: Object.fromEntries(seats.map(id => [id, { cards: [card, card], shuffle: false }])),
    }, { runtime, correlationId });
    const commands = (actionId: string, playerId: string, data?: unknown) => {
      const position: MatchPosition = serialize ? JSON.parse(JSON.stringify(current.position)) : current.position;
      const next = executeMatchCommand(position, { actionId, playerId, data }, {
        runtime, correlationId, lastBatchId: current.lastBatchId,
      });
      expect(next.result.success).toBe(true);
      current = next;
    };

    commands('cast_spell', seats[0], { cardUuid: current.position.players[seats[0]].hand[0].uuid });
    for (let step = 0; current.position.stack.length && step < 8; step++) {
      commands('pass_priority', current.position.priorityPlayerId!);
    }
    const created = current.position.battlefield.find(instance => instance.isToken)!;
    expect(created.blueprint.id).toBe(token.id);
    expect(created.state.counters['synthetic-mark']).toBe(1);
    expect(CardCharacteristicService.resolvePower({ ...current.position, roomId: correlationId }, created)).toBe(3);
    commands('concede', seats[1]);
    expect(current.position.outcome).toMatchObject({ type: 'win', winnerId: seats[0] });
    expect(current.position).not.toHaveProperty('roomId');
    return current;
  }

  const before = JSON.stringify(initial);
  expect(run(true)).toEqual(run(false));
  expect(JSON.stringify(initial)).toBe(before);
});
