import { afterEach, describe, expect, it } from 'vitest';
import { GameEngine } from '@engine/game-engine';
import { instantiateCard } from '@library/card-factory';
import { CardCharacteristicService as service } from '@engine/card-characteristic-service';
import { createTestRoom, fillTestLibraries } from '../helpers/test-room-factory';
import { creature } from '../helpers/combat-fixture';

const engines: GameEngine[] = [];
afterEach(() => {
  engines.splice(0).forEach(engine => engine.dispose());
});
function game() {
  const room = createTestRoom(); fillTestLibraries(room);
  room.players.player1.hand = [];
  const blade = instantiateCard('worlds-flameblade');
  blade.state = { ...blade.state, ownerId: 'player1', controllerId: 'player1', zone: 'battlefield' };
  const first = creature('first', 'player1', 2, 5), second = creature('second', 'player1', 3, 5), enemy = creature('enemy', 'player2', 2, 5);
  room.battlefield = [blade, first, second, enemy];
  const engine = new GameEngine(room); engine.initRoom(); engines.push(engine);
  return { engine, blade, first, second, enemy };
}
function equip(engine: GameEngine, blade: { uuid: string }, host: { uuid: string }) {
  expect(engine.executePlayerAction('player1', 'activate_ability', { cardUuid: blade.uuid, abilityId: 'attach', targets: [{ targetType: 'permanent', cardUuid: host.uuid }] }).success).toBe(true);
  engine.resolveTopOfStack();
}
describe('starter equipment', () => {
  it('casts with two mana of any colors and enters unattached', () => {
    const { engine, blade, first } = game();
    engine.roomState.battlefield = engine.roomState.battlefield.filter(card => card.uuid !== blade.uuid);
    blade.state.zone = 'hand'; engine.roomState.players.player1.hand = [blade];
    engine.roomState.players.player1.mana = { red: 0, white: 0, black: 0, yellow: 0, blue: 1, green: 1 };
    expect(engine.executePlayerAction('player1', 'cast_spell', { cardUuid: blade.uuid, payment: { blue: 1, green: 1 } }).success).toBe(true);
    engine.resolveTopOfStack();
    expect(engine.roomState.battlefield.some(card => card.uuid === blade.uuid)).toBe(true);
    expect(engine.roomState.battlefield.find(card => card.uuid === blade.uuid)?.state.attachedTo).toBeFalsy();
    expect(service.resolvePower(engine.roomState, first)).toBe(2);
    expect(Object.values(engine.roomState.players.player1.mana).every(amount => amount === 0)).toBe(true);
  });
  it('enters unattached and freely attaches/reassigns with a live +2 attack grant', () => {
    const { engine, blade, first, second } = game();
    expect(blade.state.attachedTo).toBeFalsy();
    const before = structuredClone(engine.roomState);
    equip(engine, blade, first);
    expect(service.resolvePower(engine.roomState, first)).toBe(4);
    expect(before.battlefield[0].state.attachedTo).toBeFalsy();
    equip(engine, blade, second);
    expect(service.resolvePower(engine.roomState, first)).toBe(2);
    expect(service.resolvePower(engine.roomState, second)).toBe(5);
    expect(engine.roomState.players.player1.mana).toEqual(before.players.player1.mana);
  });
  it('grants one ordered attack trigger that draws then damages an opposing creature', () => {
    const { engine, blade, first, enemy } = game(); equip(engine, blade, first);
    engine.roomState.phase = 'declareAttackersStep'; engine.roomState.priorityPlayerId = null;
    expect(engine.executePlayerAction('player1', 'declare_attackers', { attackers: [{ cardUuid: first.uuid }] }).success).toBe(true);
    const choice = engine.roomState.pendingChoice!;
    expect(choice).toBeTruthy(); if (choice.kind === 'number') throw new Error('Expected target selection');
    const option = choice.options.find(option => JSON.stringify(option).includes(enemy.uuid))!;
    expect(engine.executePlayerAction('player1', 'choose', { choiceId: choice.id, choices: [option.id] }).success).toBe(true);
    expect(engine.roomState.stack).toHaveLength(1);
    expect(engine.roomState.stack[0].effects.map(effect => effect.action)).toEqual(['DRAW', 'MODIFY_STATS']);
    engine.resolveTopOfStack();
    expect(engine.roomState.players.player1.hand).toHaveLength(1);
    expect(engine.roomState.battlefield.find(card => card.uuid === enemy.uuid)?.state.damageTaken).toBe(2);
    const events = engine.drainEventBatches().flatMap(batch => batch.events).map(event => event.eventId);
    expect(events).toContain('CARD_DRAWN'); expect(events).toContain('DAMAGE_DEALT');
    expect(events.indexOf('CARD_DRAWN')).toBeLessThan(events.indexOf('DAMAGE_DEALT'));
  });
  it.each(['host', 'source'] as const)('detaches or stops grants when the %s leaves and returns', which => {
    const { engine, blade, first } = game(); equip(engine, blade, first);
    expect(service.resolveAbilities(engine.roomState, first).some(ability => ability.id?.startsWith('flameblade-attack@'))).toBe(true);
    const subject = which === 'host' ? first : blade;
    engine.applyMutations([{ type: 'MOVE_CARD', cardUuid: subject.uuid, playerId: 'player1', from: 'battlefield', to: 'graveyard' }, { type: 'MOVE_CARD', cardUuid: subject.uuid, playerId: 'player1', from: 'graveyard', to: 'battlefield' }]);
    const host = engine.roomState.battlefield.find(card => card.uuid === first.uuid)!;
    expect(service.resolvePower(engine.roomState, host)).toBe(2);
    expect(service.resolveAbilities(engine.roomState, host).filter(ability => ability.id?.startsWith('flameblade-attack@'))).toEqual([]);
    expect(engine.roomState.battlefield.find(card => card.uuid === blade.uuid)?.state.attachedTo).toBeFalsy();
  });
  it.each(['host', 'source'] as const)('does not attach to a new incarnation when the selected %s leaves before resolution', which => {
    const { engine, blade, first } = game();
    expect(engine.executePlayerAction('player1', 'activate_ability', { cardUuid: blade.uuid, abilityId: 'attach', targets: [{ targetType: 'permanent', cardUuid: first.uuid }] }).success).toBe(true);
    const subject = which === 'host' ? first : blade;
    engine.applyMutations([{ type: 'MOVE_CARD', cardUuid: subject.uuid, playerId: 'player1', from: 'battlefield', to: 'graveyard' }, { type: 'MOVE_CARD', cardUuid: subject.uuid, playerId: 'player1', from: 'graveyard', to: 'battlefield' }]);
    engine.resolveTopOfStack();
    expect(engine.roomState.battlefield.find(card => card.uuid === blade.uuid)?.state.attachedTo).toBeFalsy();
  });
  it('rejects opponent creatures and activations outside the controllers main phase', () => {
    const { engine, blade, first, enemy } = game();
    const activate = (host: { uuid: string }) => engine.executePlayerAction('player1', 'activate_ability', { cardUuid: blade.uuid, abilityId: 'attach', targets: [{ targetType: 'permanent', cardUuid: host.uuid }] });
    expect(activate(enemy).success).toBe(false);
    engine.roomState.phase = 'declareAttackersStep'; expect(activate(first).success).toBe(false);
  });
});
