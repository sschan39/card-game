import { afterEach, describe, expect, it, vi } from 'vitest';
import { instantiateCard } from '../../src/library/card-factory';
import { GameEngine } from '../../src/engine/game-engine';
import { EventBus } from '../../src/engine/event-bus';
import { GameLogger } from '../../src/shared/game-logger';
import { gameConfig } from '../../src/config';
import { createTestRoom, fillTestLibraries } from '../helpers/test-room-factory';

const engines: GameEngine[] = [];
afterEach(() => { engines.splice(0).forEach(engine => engine.dispose()); vi.restoreAllMocks(); });

function fixture() {
  const room = createTestRoom(); fillTestLibraries(room, 30);
  const probe = instantiateCard('trigger-probe');
  probe.state = { ...probe.state, zone: 'battlefield', ownerId: 'player1', controllerId: 'player1' };
  room.battlefield = [probe];
  const engine = new GameEngine(room); engine.initRoom(); engines.push(engine);
  return { engine, probe };
}
function ordering(engine: GameEngine) {
  while (engine.roomState.pendingChoice?.kind === 'ordering') {
    const c = engine.roomState.pendingChoice;
    expect(engine.executePlayerAction(c.playerId, 'choose', { choiceId: c.id, choices: c.options.map(o => o.id) }).success).toBe(true);
  }
}
const ids = (engine: GameEngine) => engine.roomState.stack.filter(s => s.type === 'triggered').map(s => s.ability?.id);

describe('authored single-card trigger probe', () => {
  it('loads compound spell instructions and distinct self, watcher and targeted abilities', () => {
    const card = instantiateCard('trigger-probe');
    expect(card.blueprint.onCastEffects.map(e => e.action)).toEqual(['DRAW', 'MODIFY_LIFE']);
    expect(card.blueprint.abilities.map(a => a.id)).toEqual([
      'probe-entry', 'probe-attack', 'probe-block', 'probe-death', 'probe-other-cast', 'probe-other-entry', 'probe-other-death', 'probe-draw', 'probe-destroy',
    ]);
  });

  it('proves committed death emission, trigger receipt, queueing, resolution and a secondary draw trigger', () => {
    const { engine, probe } = fixture();
    const emit = vi.spyOn(EventBus.prototype, 'emit');
    const debug = vi.spyOn(GameLogger.prototype, 'debug');
    const previous = gameConfig.logging.appliedEvents; gameConfig.logging.appliedEvents = true;
    try {
      const other = instantiateCard('trigger-probe');
      other.state = { ...other.state, zone: 'battlefield', ownerId: 'player1', controllerId: 'player1' };
      engine.roomState.battlefield.push(other);
      engine.applyMutations([{ type: 'MOVE_CARD', cardUuid: other.uuid, playerId: 'player1', from: 'battlefield', to: 'graveyard' }]);
      ordering(engine);
      expect(ids(engine)).toEqual(['probe-other-death', 'probe-death']);
      const death = emit.mock.calls.map(([event]) => event).find(e => e.eventId === 'PERMANENT_DIED')!;
      expect(death.eventUuid).toBeTruthy();
      for (const item of engine.roomState.stack) expect(item.triggeringEvent?.eventUuid).toBe(death.eventUuid);
      expect(debug.mock.calls).toContainEqual(['trigger:received', 'PERMANENT_DIED', expect.objectContaining({ eventUuid: death.eventUuid, discovered: 2 })]);
      expect(debug.mock.calls.filter(([name]) => name === 'trigger:queued').map(([, , data]) => data?.abilityId)).toEqual(['probe-other-death', 'probe-death']);
      const hand = engine.roomState.players.player1.hand.length;
      engine.resolveTopOfStack();
      expect(engine.roomState.players.player1.hand).toHaveLength(hand + 1);
      expect(ids(engine)).toEqual(['probe-other-death', 'probe-draw']);
      expect(engine.roomState.stack.at(-1)?.source.uuid).toBe(probe.uuid);
      const life = engine.roomState.players.player1.life;
      engine.resolveTopOfStack(); expect(engine.roomState.players.player1.life).toBe(life + 1);
      engine.resolveTopOfStack(); engine.resolveTopOfStack();
      expect(engine.roomState.stack).toHaveLength(0);
      expect(engine.roomState.players.player1.hand).toHaveLength(hand + 2);
      expect(engine.roomState.players.player1.life).toBe(life + 2);
      expect(engine.roomState.players.player1.graveyard.find(c => c.uuid === other.uuid)?.state).toMatchObject({ zone: 'graveyard', zoneRevision: 1 });
    } finally { gameConfig.logging.appliedEvents = previous; }
  });

  it('distinguishes casting, sequential spell effects and entry without self-cast discovery', () => {
    const { engine } = fixture();
    const next = instantiateCard('trigger-probe');
    next.state = { ...next.state, zone: 'hand', ownerId: 'player1', controllerId: 'player1' };
    engine.roomState.players.player1.hand.push(next);
    expect(engine.executePlayerAction('player1', 'cast_spell', { cardUuid: next.uuid }).success).toBe(true);
    expect(ids(engine)).toEqual(['probe-other-cast']);
    engine.resolveTopOfStack(); const hand = engine.roomState.players.player1.hand.length, life = engine.roomState.players.player1.life;
    engine.resolveTopOfStack(); ordering(engine);
    expect(engine.roomState.players.player1.hand).toHaveLength(hand + 1);
    expect(engine.roomState.players.player1.life).toBe(life + 1);
    expect(ids(engine).sort()).toEqual(['probe-draw', 'probe-entry', 'probe-other-entry']);
    expect(engine.roomState.battlefield.some(c => c.uuid === next.uuid)).toBe(true);
    const events = engine.drainEventBatches().flatMap(b => b.events);
    expect(events.filter(e => e.eventId === 'SPELL_CAST')).toHaveLength(1);
    expect(events.filter(e => e.eventId === 'PERMANENT_ENTERED')).toHaveLength(1);
  });

  it('ignores another controller and noncreature entries instead of producing false watcher triggers', () => {
    const { engine } = fixture();
    for (const [id, owner] of [['land-red', 'player1'], ['trigger-probe', 'player2']] as const) {
      const next = instantiateCard(id);
      next.state = { ...next.state, zone: 'hand', ownerId: owner, controllerId: owner };
      engine.roomState.players[owner].hand.push(next);
      engine.applyMutations([{ type: 'MOVE_CARD', cardUuid: next.uuid, playerId: owner, from: 'hand', to: 'battlefield' }]);
    }
    expect(ids(engine)).toEqual(['probe-entry']);
    expect(engine.roomState.stack[0].controllerId).toBe('player2');
  });
});
