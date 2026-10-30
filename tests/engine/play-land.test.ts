import { describe, expect, it } from 'vitest';
import { GameEngine } from '@engine/game-engine';
import { playCardHandler } from '@engine/handlers/play-card-handler';
import { instantiateCard } from '@library/card-factory';
import { createTestRoom, fillTestLibraries } from '../helpers/test-room-factory';
import { OptionService } from '@engine/option-service';
import { gameConfig, snapshotSetupConfig } from '@config';

function game() {
  const room = createTestRoom(); fillTestLibraries(room);
  room.players.player1.hand = ['land-red', 'land-red', 'empire-servant'].map(id => {
    const card = instantiateCard(id);
    card.state = { ...card.state, zone: 'hand', ownerId: 'player1', controllerId: 'player1' };
    return card;
  });
  const engine = new GameEngine(room); engine.initRoom(); engine.drainEventBatches();
  return engine;
}
function play(engine: GameEngine, index = 0) {
  const card = engine.roomState.players.player1.hand[index];
  return engine.executePlayerAction('player1', 'play_land', { cardUuid: card.uuid, zoneRevision: card.state.zoneRevision ?? 0 });
}
function passBoth(engine: GameEngine) {
  const first = engine.priorityPlayerId!;
  expect(engine.executePlayerAction(first, 'pass_priority').success).toBe(true);
  expect(engine.executePlayerAction(first === 'player1' ? 'player2' : 'player1', 'pass_priority').success).toBe(true);
}
function finishTurn(engine: GameEngine) {
  passBoth(engine); passBoth(engine);
  expect(engine.executePlayerAction(engine.roomState.activeTurnPlayerId!, 'declare_attackers', { attackers: [] }).success).toBe(true);
  for (let i = 0; i < 6; i++) passBoth(engine);
  expect(engine.phase).toBe('stateMainPhase');
}
describe('ordinary hand land play', () => {
  it('moves directly, retains identity and priority, records one play, and emits no spell cast', () => {
    const engine = game(), card = engine.roomState.players.player1.hand[0];
    expect(play(engine).success).toBe(true);
    expect(engine.roomState.battlefield[0]).toMatchObject({ uuid: card.uuid, state: { zone: 'battlefield', zoneRevision: (card.state.zoneRevision ?? 0) + 1 } });
    expect(engine.roomState.stack).toEqual([]); expect(engine.priorityPlayerId).toBe('player1');
    expect(engine.roomState.turnHistory?.landPlays?.player1).toBe(1);
    const events = engine.drainEventBatches().flatMap(batch => batch.events);
    expect(events.some(event => event.eventId === 'PERMANENT_ENTERED')).toBe(true);
    expect(events.some(event => event.eventId === 'SPELL_CAST')).toBe(false);
    engine.dispose();
  });
  it('rejects a second play without changing state, then resets on ordinary turn handoff', () => {
    const engine = game(); expect(play(engine).success).toBe(true);
    const before = structuredClone(engine.roomState);
    expect(play(engine)).toMatchObject({ success: false, reason: expect.stringContaining('land play') });
    expect(engine.roomState).toEqual(before);
    finishTurn(engine); finishTurn(engine);
    expect(engine.roomState.activeTurnPlayerId).toBe('player1');
    expect(play(engine).success).toBe(true);
    engine.dispose();
  });
  it.each(['upkeepStep', 'stateEndPhase'] as const)('rejects timing outside main: %s', phase => {
    const engine = game(); engine.roomState.phase = phase;
    expect(play(engine)).toMatchObject({ success: false, reason: expect.stringContaining('main phase') }); engine.dispose();
  });
  it('accepts postcombat main, rejects nonland and stale source revision', () => {
    const engine = game(); engine.roomState.phase = 'postcombatMainPhase';
    const card = engine.roomState.players.player1.hand[0];
    expect(engine.executePlayerAction('player1', 'play_land', { cardUuid: card.uuid, zoneRevision: 99 })).toMatchObject({ success: false, reason: expect.stringContaining('changed zones') });
    expect(play(engine, 2)).toMatchObject({ success: false, reason: expect.stringContaining('Land') });
    expect(play(engine).success).toBe(true); engine.dispose();
  });
  it('rejects cast-route land before opening any announcement', () => {
    const engine = game(), card = engine.roomState.players.player1.hand[0];
    card.blueprint = { ...card.blueprint, numericDeclarations: [{ name: 'X', min: 0, max: 3 }] };
    expect(engine.executePlayerAction('player1', 'cast_spell', { cardUuid: card.uuid })).toMatchObject({ success: false, reason: expect.stringContaining('Lands') });
    expect(engine.roomState.pendingChoice).toBeFalsy();
    expect(playCardHandler.validate(engine.roomState, 'player1', { cardUuid: card.uuid }).success).toBe(false);
    expect(playCardHandler.propose(engine.roomState, 'player1', { cardUuid: card.uuid }).success).toBe(false); engine.dispose();
  });
  it.each([['cancel-entry', 0], ['skip:cancel-entry', 1]])('settles one accepted play after persisted replacement answer %s', (answer, entries) => {
    const engine = game();
    engine.roomState.replacementEffects = [{ id: 'cancel-entry', label: 'Cancel entry', optional: true,
      match: { kinds: ['zone_transfer'], from: 'hand', to: 'battlefield' }, operation: { type: 'cancel_event' } }];
    expect(play(engine).success).toBe(true);
    expect(engine.roomState.battlefield).toEqual([]); expect(engine.roomState.turnHistory?.landPlays?.player1 ?? 0).toBe(0);
    engine.roomState.pendingChoice = JSON.parse(JSON.stringify(engine.roomState.pendingChoice));
    const choice = engine.roomState.pendingChoice!;
    expect(choice).toBeTruthy();
    expect(engine.executePlayerAction('player1', 'choose', { choiceId: choice.id, choices: [answer] }).success).toBe(true);
    expect(engine.roomState.battlefield).toHaveLength(entries); expect(engine.roomState.turnHistory?.landPlays?.player1).toBe(1);
    expect(engine.priorityPlayerId).toBe('player1'); expect(play(engine).success).toBe(false); engine.dispose();
  });
  it('does not count generic land entry and exposes the same option reason/allowance', () => {
    const engine = game(), card = engine.roomState.players.player1.hand[0];
    engine.applyMutations([{ type: 'MOVE_CARD', cardUuid: card.uuid, playerId: 'player1', from: 'hand', to: 'battlefield' }]);
    expect(engine.roomState.turnHistory?.landPlays?.player1 ?? 0).toBe(0);
    const next = engine.roomState.players.player1.hand[0];
    const options = new OptionService();
    expect(options.getOptions(engine.roomState, 'player1', next.uuid, 'hand')[0]).toMatchObject({ actionId: 'play_land', label: 'Play land', disabled: false });
    expect(play(engine).success).toBe(true);
    // Return the same stable instance to hand through the normal reducer.
    const land = engine.roomState.battlefield[1];
    engine.applyMutations([{ type: 'MOVE_CARD', cardUuid: land.uuid, playerId: 'player1', from: 'battlefield', to: 'hand' }]);
    expect(options.getOptions(engine.roomState, 'player1', land.uuid, 'hand')[0]).toMatchObject({ disabled: true, disabledReason: expect.stringContaining('land play') }); engine.dispose();
  });
  it('uses the room allowance rather than the current global default', () => {
    const engine = game(); engine.roomState.setup = { ...gameConfig.setup, landPlaysPerTurn: 2 };
    expect(play(engine).success).toBe(true); expect(play(engine).success).toBe(true); engine.dispose();
  });
  it('counts redirected entry as a play', () => {
    const engine = game(), card = engine.roomState.players.player1.hand[0];
    engine.roomState.replacementEffects = [{ id: 'redirect', label: 'Redirect entry',
      match: { kinds: ['zone_transfer'], from: 'hand', to: 'battlefield' }, operation: { type: 'move_destination', to: 'graveyard' } }];
    expect(play(engine).success).toBe(true); expect(engine.roomState.battlefield).toEqual([]);
    expect(engine.roomState.players.player1.graveyard.some(candidate => candidate.uuid === card.uuid)).toBe(true);
    expect(engine.roomState.turnHistory?.landPlays?.player1).toBe(1); engine.dispose();
  });
  it('uses effective hand types, and does not apply cast-only prohibitions to land play', () => {
    const engine = game(), card = engine.roomState.players.player1.hand[2];
    engine.applyMutations([{ type: 'ADD_CONTINUOUS_EFFECT', entry: { source: 'global', requiredZone: null, duration: 'PERMANENT', layer: 4,
      effect: { type: 'TYPE', set: ['Land'] }, scope: { cardUuid: card.uuid, zones: ['hand'] } } },
      { type: 'ADD_CONTINUOUS_EFFECT', entry: { source: 'global', requiredZone: null, duration: 'PERMANENT', layer: 6,
        effect: { type: 'PERMISSION', rules: [{ action: 'cast', mode: 'prohibit', players: 'any' }] }, scope: { zones: ['hand'] } } }]);
    expect(new OptionService().getOptions(engine.roomState, 'player1', card.uuid, 'hand')[0].actionId).toBe('play_land');
    expect(engine.executePlayerAction('player1', 'cast_spell', { cardUuid: card.uuid }).success).toBe(false);
    expect(engine.executePlayerAction('player1', 'play_land', { cardUuid: card.uuid, zoneRevision: card.state.zoneRevision ?? 0 }).success).toBe(true); engine.dispose();
  });
  it('requires own turn, priority and an empty stack', () => {
    const engine = game(), card = engine.roomState.players.player1.hand[0];
    engine.roomState.activeTurnPlayerId = 'player2'; expect(play(engine)).toMatchObject({ success: false, reason: expect.stringContaining('own turn') });
    engine.roomState.activeTurnPlayerId = 'player1'; engine.roomState.priorityPlayerId = 'player2';
    expect(play(engine)).toMatchObject({ success: false, reason: expect.stringContaining('priority') });
    engine.roomState.priorityPlayerId = 'player1'; engine.roomState.stack = [{ uuid: 'response', type: 'spell', source: card, controllerId: 'player1', effects: [], countered: false }];
    expect(play(engine)).toMatchObject({ success: false, reason: expect.stringContaining('stack is empty') }); engine.dispose();
  });
  it('requires the current hand revision after the same UUID leaves and returns', () => {
    const engine = game(), card = engine.roomState.players.player1.hand[0]; const revision = card.state.zoneRevision ?? 0;
    engine.applyMutations([{ type: 'MOVE_CARD', playerId: 'player1', cardUuid: card.uuid, from: 'hand', to: 'graveyard' },
      { type: 'MOVE_CARD', playerId: 'player1', cardUuid: card.uuid, from: 'graveyard', to: 'hand' }]);
    for (const data of [{ cardUuid: card.uuid }, { cardUuid: card.uuid, zoneRevision: revision }]) expect(engine.executePlayerAction('player1', 'play_land', data)).toMatchObject({ success: false, reason: expect.stringContaining('changed zones') });
    const current = engine.roomState.players.player1.hand.find(candidate => candidate.uuid === card.uuid)!;
    expect(engine.executePlayerAction('player1', 'play_land', { cardUuid: card.uuid, zoneRevision: current.state.zoneRevision }).success).toBe(true); engine.dispose();
  });
  it('snapshots zero/custom allowance and rejects an invalid centralized setting', () => {
    const original = gameConfig.setup;
    try {
      gameConfig.setup = { ...original, landPlaysPerTurn: 0 }; expect(snapshotSetupConfig().landPlaysPerTurn).toBe(0);
      const engine = game(); engine.roomState.setup = snapshotSetupConfig(); expect(play(engine).success).toBe(false); engine.dispose();
      gameConfig.setup = { ...original, landPlaysPerTurn: -1 }; expect(() => snapshotSetupConfig()).toThrow('Invalid gameplay setup configuration');
      gameConfig.setup = { ...original, landPlaysPerTurn: undefined }; expect(snapshotSetupConfig().landPlaysPerTurn).toBe(1);
    } finally { gameConfig.setup = original; }
  });
});
