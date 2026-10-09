import { describe, expect, it } from 'vitest';
import { createTestRoom } from '../helpers/test-room-factory';
import { creature } from '../helpers/combat-fixture';
import { structuralTargetLegal, targetPermissionsAllow } from '../../src/shared/target-legality';
import { playCardHandler } from '../../src/engine/handlers/play-card-handler';
import { activateAbilityHandler } from '../../src/engine/handlers/activate-ability-handler';
import { ActionValidator } from '../../src/engine/action-validator';
import { OptionService } from '../../src/engine/option-service';
import { gameReducer } from '../../src/engine/game-reducer';
import type { ContinuousEffect } from '../../src/types/card.types';
import { CardCharacteristicService } from '../../src/engine/card-characteristic-service';

function fixture() {
  let room = createTestRoom(); room.phase = 'mainPhase'; room.activeTurnPlayerId = 'player1'; room.priorityPlayerId = 'player1';
  const card = creature('subject', 'player2'); const source = creature('source', 'player1'); room.battlefield = [card, source];
  Object.assign(source, { blueprint: { ...source.blueprint, castRequirements: { allowedZones: ['hand'], speed: 'sorcery', cost: {} } } });
  const add = (effect: unknown, uuid = card.uuid) => { room = gameReducer(room, { type: 'ADD_CONTINUOUS_EFFECT', entry: {
    source: 'global', requiredZone: null, layer: 6, scope: { cardUuid: uuid }, effect: effect as ContinuousEffect, duration: 'PERMANENT',
  } }); return room; };
  return { get room() { return room; }, card, source, add };
}
const target = { targetType: 'permanent' as const, cardUuid: 'subject' };

describe('effective permissions and legality', () => {
  it.each(['colorless', 'multicolored', 'creatures', 'artifacts'])('matches protection from %s against effective source qualities', quality => {
    const f = fixture();
    f.add({ type: 'ABILITY', addKeywords: ['Protection from ' + quality] });
    f.add({ type: 'COLOR', set: quality === 'multicolored' ? ['red', 'blue'] : [] }, f.source.uuid);
    if (quality === 'artifacts') f.add({ type: 'TYPE', add: ['Artifact'] }, f.source.uuid);
    expect(targetPermissionsAllow(f.room, 'player1', f.source, target)).toBe(false);
  });
  it('control changes reset tenure even when control returns to the original player', () => {
    const f = fixture(); expect(ActionValidator.canPayCost(f.room, 'player1', f.source, { tap: true })).toBe(true);
    f.add({ type: 'CONTROL', controllerId: 'player2' }, f.source.uuid);
    const stolen = f.room.battlefield.find(c => c.uuid === f.source.uuid)!;
    expect(ActionValidator.canPayCost(f.room, 'player2', stolen, { tap: true })).toBe(false);
    f.add({ type: 'CONTROL', controllerId: 'player1' }, f.source.uuid);
    const returned = f.room.battlefield.find(c => c.uuid === f.source.uuid)!;
    expect(ActionValidator.canPayCost(f.room, 'player1', returned, { tap: true })).toBe(false);
  });
  it('resolved game-rule prohibitions apply to later cards instead of freezing their recipients', () => {
    const f = fixture(); f.add({ type: 'PERMISSION', rules: [{ action: 'cast', mode: 'prohibit', players: 'any' }] }, f.source.uuid);
    // A separate global rule has a dynamic scope.
    const room = gameReducer(f.room, { type: 'ADD_CONTINUOUS_EFFECT', entry: { source: 'global', requiredZone: null, origin: 'resolved', layer: 6,
      effect: { type: 'PERMISSION', rules: [{ action: 'cast', mode: 'prohibit', players: 'any' }] }, scope: { cardTypes: ['Creature'] }, duration: 'END_OF_TURN' } });
    const later = creature('later', 'player1'); later.state.zone = 'hand'; room.players.player1.hand.push(later);
    expect(playCardHandler.validate(room, 'player1', { cardUuid: later.uuid }).success).toBe(false);
  });
  it('uses changed types and control in shared structural targeting', () => {
    const f = fixture(); f.add({ type: 'TYPE', set: ['Artifact'] }); f.add({ type: 'CONTROL', controllerId: 'player1' });
    expect(structuralTargetLegal(f.room, 'player1', target, { type: 'permanent', required: true, cardTypes: ['Creature'] })).toBe(false);
    expect(structuralTargetLegal(f.room, 'player1', target, { type: 'permanent', required: true, cardTypes: ['Artifact'], controller: 'self' })).toBe(true);
  });
  it('uses gained/lost hexproof and shroud with effective control', () => {
    const f = fixture(); f.add({ type: 'ABILITY', addKeywords: ['Hexproof'] });
    expect(targetPermissionsAllow(f.room, 'player1', f.source, target)).toBe(false);
    expect(targetPermissionsAllow(f.room, 'player2', f.source, target)).toBe(true);
    f.add({ type: 'CONTROL', controllerId: 'player1' });
    expect(targetPermissionsAllow(f.room, 'player1', f.source, target)).toBe(true);
    f.add({ type: 'ABILITY', addKeywords: ['Shroud'] });
    expect(targetPermissionsAllow(f.room, 'player1', f.source, target)).toBe(false);
    f.add({ type: 'ABILITY', removeAll: true });
    expect(targetPermissionsAllow(f.room, 'player1', f.source, target)).toBe(true);
  });
  it('uses effective source colors and types for protection', () => {
    const f = fixture(); f.add({ type: 'ABILITY', addKeywords: ['Protection from blue', 'Protection from Artifact'] });
    expect(targetPermissionsAllow(f.room, 'player1', f.source, target)).toBe(true);
    f.add({ type: 'COLOR', set: ['blue'] }, f.source.uuid);
    expect(targetPermissionsAllow(f.room, 'player1', f.source, target)).toBe(false);
    f.add({ type: 'COLOR', set: [] }, f.source.uuid); f.add({ type: 'TYPE', add: ['Artifact'] }, f.source.uuid);
    expect(targetPermissionsAllow(f.room, 'player1', f.source, target)).toBe(false);
  });
  it('allows effective flash during the opponent turn without skipping priority', () => {
    const f = fixture(); f.source.state.zone = 'hand'; f.room.battlefield = [f.card]; f.room.players.player1.hand = [f.source]; f.room.activeTurnPlayerId = 'player2';
    f.add({ type: 'ABILITY', addKeywords: ['Flash'] }, f.source.uuid);
    expect(playCardHandler.validate(f.room, 'player1', { cardUuid: f.source.uuid }).success).toBe(true);
    f.room.priorityPlayerId = 'player2';
    expect(playCardHandler.validate(f.room, 'player1', { cardUuid: f.source.uuid }).success).toBe(false);
  });
  it('applies casting prohibitions to server validation and advertised options', () => {
    const f = fixture(); f.source.state.zone = 'hand'; f.room.battlefield = [f.card]; f.room.players.player1.hand = [f.source];
    f.add({ type: 'ABILITY', addKeywords: ['Flash'] }, f.source.uuid);
    f.add({ type: 'PERMISSION', rules: [{ action: 'cast', mode: 'prohibit', players: 'any' }] }, f.source.uuid);
    expect(playCardHandler.validate(f.room, 'player1', { cardUuid: f.source.uuid }).success).toBe(false);
    expect(new OptionService().getOptions(f.room, 'player1', f.source.uuid, 'hand')[0].disabled).toBe(true);
  });
  it('removes and grants selected activated abilities without blueprint edits', () => {
    const f = fixture();
    const ability = { id: 'draw', type: 'activated', castSpeed: 'instant', cost: {}, effect: { action: 'DRAW', params: { amount: 1 }, tags: [], targeting: { type: 'self', required: false } } };
    f.add({ type: 'ABILITY', add: [ability] }, f.source.uuid);
    const abilityId = CardCharacteristicService.resolveAbilities(f.room, f.source)[0].id;
    expect(activateAbilityHandler.validate(f.room, 'player1', { cardUuid: f.source.uuid, abilityId }).success).toBe(true);
    expect(new OptionService().getOptions(f.room, 'player1', f.source.uuid, 'battlefield').map(o => o.data?.abilityId)).toContain(abilityId);
    f.add({ type: 'ABILITY', removeAll: true }, f.source.uuid);
    expect(activateAbilityHandler.validate(f.room, 'player1', { cardUuid: f.source.uuid, abilityId }).success).toBe(false);
  });
  it('uses effective haste/type for tap costs and activation prohibitions', () => {
    const f = fixture(); f.source.state.summoningSickness = true;
    expect(ActionValidator.canPayCost(f.room, 'player1', f.source, { tap: true })).toBe(false);
    f.add({ type: 'ABILITY', addKeywords: ['Haste'] }, f.source.uuid);
    expect(ActionValidator.canPayCost(f.room, 'player1', f.source, { tap: true })).toBe(true);
    f.add({ type: 'PERMISSION', rules: [{ action: 'activate', mode: 'prohibit', players: 'any' }] }, f.source.uuid);
    expect(ActionValidator.canActivate(f.room, 'player1', f.source, { allowedZones: ['battlefield'], speed: 'instant' }).valid).toBe(false);
  });
});
