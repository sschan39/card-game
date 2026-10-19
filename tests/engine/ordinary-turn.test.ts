import { answerSingleRecipientCombat } from '../helpers/combat-fixture';
import { describe, expect, it } from 'vitest';
import { GameEngine } from '../../src/engine/game-engine';
import { createTestRoom, fillTestLibraries } from '../helpers/test-room-factory';
import { instantiateCard } from '../../src/library/card-factory';
import { ActionValidator } from '../../src/engine/action-validator';

function game() {
  const room = createTestRoom(); fillTestLibraries(room);
  const engine = new GameEngine(room); engine.initRoom(); return engine;
}
function passBoth(engine: GameEngine) {
  const first = engine.priorityPlayerId!;
  const second = first === 'player1' ? 'player2' : 'player1';
  expect(engine.executePlayerAction(first, 'pass_priority').success).toBe(true);
  expect(engine.executePlayerAction(second, 'pass_priority').success).toBe(true);
}
describe('ordinary turn structure', () => {
  it('discovers upkeep and end-step triggers at their own step entries', () => {
    for (const [from, phase, trigger, event] of [
      ['cleanupStep', 'upkeepStep', 'BEGIN_UPKEEP', 'UPKEEP_STARTED'],
      ['postcombatMainPhase', 'stateEndPhase', 'END_OF_TURN', 'END_STEP_STARTED'],
    ] as const) {
      const engine = game(); engine.roomState.phase = from;
      const card = instantiateCard('empire-servant');
      card.state = { ...card.state, zone: 'battlefield', ownerId: 'player1', controllerId: from === 'cleanupStep' ? 'player2' : 'player1' };
      card.blueprint = { ...card.blueprint, abilities: [{ type: 'triggered', castSpeed: 'instant', triggerCondition: trigger,
        effect: { action: 'DRAW', params: { amount: 0 }, tags: [], targeting: { type: 'self', required: false } } }] };
      engine.roomState.battlefield = [card];
      engine.advancePhase('complete');
      expect(engine.phase).toBe(phase); expect(engine.roomState.stack).toHaveLength(1);
      expect(engine.roomState.stack[0].triggeringEvent?.eventId).toBe(event);
      expect(engine.drainEventBatches().flatMap(batch => batch.events).filter(entry => entry.eventId === event)).toHaveLength(1);
      engine.resolveTopOfStack(); expect(engine.phase).toBe(phase);
      expect(engine.priorityPlayerId).toBe(engine.roomState.activeTurnPlayerId);
    }
  });
  it('plays a complete turn with explicit declaration decisions and response windows', () => {
    const engine = game();
    const attacker = instantiateCard('empire-servant');
    attacker.state = { ...attacker.state, zone: 'battlefield', ownerId: 'player1', controllerId: 'player1', summoningSickness: false };
    engine.roomState.battlefield = [attacker];
    passBoth(engine); expect(engine.phase).toBe('beginCombatStep');
    passBoth(engine); expect(engine.phase).toBe('declareAttackersStep');
    expect(engine.priorityPlayerId).toBeNull();
    expect(engine.executePlayerAction('player1', 'pass_priority').success).toBe(false);
    expect(engine.executePlayerAction('player1', 'declare_attackers', { attackers: [{ cardUuid: attacker.uuid }] }).success).toBe(true);
    expect(engine.phase).toBe('declareAttackersStep'); expect(engine.priorityPlayerId).toBe('player1');
    passBoth(engine); expect(engine.phase).toBe('declareBlockersStep'); expect(engine.priorityPlayerId).toBeNull();
    expect(engine.executePlayerAction('player1', 'declare_blockers', { assignments: [] }).success).toBe(false);
    expect(engine.executePlayerAction('player2', 'declare_blockers', { assignments: [] }).success).toBe(true);
    expect(engine.phase).toBe('declareBlockersStep'); expect(engine.priorityPlayerId).toBe('player1');
    passBoth(engine); expect(engine.phase).toBe('combatDamageStep');
    expect(engine.roomState.players.player2.life).toBe(20);
    answerSingleRecipientCombat(engine);
    expect(engine.roomState.players.player2.life).toBe(19);
    for (const phase of ['endCombatStep', 'postcombatMainPhase', 'stateEndPhase', 'upkeepStep', 'stateDrawPhase', 'stateMainPhase']) {
      passBoth(engine); expect(engine.phase).toBe(phase);
    }
    expect(engine.roomState.activeTurnPlayerId).toBe('player2');
  });
  it('accepts zero attackers, offers responses and skips blockers and damage', () => {
    const engine = game(); engine.roomState.phase = 'declareAttackersStep';
    expect(engine.executePlayerAction('player1', 'declare_attackers', { attackers: [] }).success).toBe(true);
    expect(engine.phase).toBe('declareAttackersStep');
    passBoth(engine); expect(engine.phase).toBe('endCombatStep');
    expect(engine.roomState.players.player2.life).toBe(20);
  });
  it('permits sorcery-speed actions in postcombat main', () => {
    const engine = game(); engine.roomState.phase = 'postcombatMainPhase';
    const card = engine.roomState.players.player1.hand[0];
    expect(ActionValidator.canActivate(engine.roomState, 'player1', card, card.blueprint.castRequirements).valid).toBe(true);
  });
  it('Enter Battle gives the opponent a main-phase response before combat begins', () => {
    const engine = game();
    expect(engine.executePlayerAction('player1', 'enter_battle').success).toBe(true);
    expect(engine.phase).toBe('stateMainPhase'); expect(engine.priorityPlayerId).toBe('player2');
    engine.passPriority('player2'); expect(engine.phase).toBe('beginCombatStep');
  });
  it('allows instant responses throughout ordinary windows without advancing during resolution', () => {
    for (const phase of ['upkeepStep', 'stateDrawPhase', 'declareAttackersStep', 'declareBlockersStep', 'combatDamageStep', 'stateEndPhase'] as const) {
      const engine = game(); engine.roomState.phase = phase;
      engine.roomState.combatDeclarations = { attackers: true, blockers: true };
      const base = instantiateCard('broken-fireball');
      const spell = { ...base, state: { ...base.state, zone: 'hand' as const, ownerId: 'player1', controllerId: 'player1' },
        blueprint: { ...base.blueprint, castRequirements: { ...base.blueprint.castRequirements, speed: 'instant' as const, cost: {} } } };
      engine.roomState.players.player1.hand = [spell];
      expect(engine.executePlayerAction('player1', 'cast_spell', { cardUuid: spell.uuid, targets: [{ targetType: 'player', playerId: 'player2' }] }).success).toBe(true);
      passBoth(engine); expect(engine.phase).toBe(phase); expect(engine.roomState.stack).toHaveLength(0);
    }
  });
});
