import { describe, expect, it } from 'vitest';
import { createTestRoom } from '../helpers/test-room-factory';
import { creature, combatRoom } from '../helpers/combat-fixture';
import { gameReducer } from '../../src/engine/game-reducer';
import { captureSourceInformation } from '../../src/engine/source-information';
import { CardCharacteristicService as service } from '../../src/engine/card-characteristic-service';
import { declareAttackersHandler } from '../../src/engine/handlers/declare-attackers-handler';
import { discoverTriggers } from '../../src/engine/trigger-manager';
import { manaAbilities } from '../../src/engine/mana-abilities';
import { reconcileCombatSelection } from '../../src/client/store/combatSelection';
import { createTargetingState } from '../../src/client/targeting';
import { normalizeCard } from '../../src/library/card-parser';
import { applyStructuralZoneChange } from '../../src/engine/effect-resolver';
import { deriveAppliedEvents } from '../../src/engine/applied-events';
import { GameEngine } from '../../src/engine/game-engine';
import { ActionValidator } from '../../src/engine/action-validator';
import { declareBlockersHandler } from '../../src/engine/handlers/declare-blockers-handler';
import type { ContinuousEffect, CardAbility } from '../../src/types/card.types';

describe('effective characteristic consumers', () => {
  it('removing an existing combat keyword immediately changes block legality', () => {
    const attacker = creature('attacker', 'player1', 2, 4, ['Flying']), blocker = creature('blocker', 'player2');
    let room = combatRoom(createTestRoom(), attacker); room.battlefield.push(blocker); room.phase = 'declareBlockersStep'; room.combatDeclarations = { attackers: true, blockers: false };
    const action = { assignments: [{ attackerUuid: attacker.uuid, blockerUuids: [blocker.uuid] }] };
    expect(declareBlockersHandler.validate(room, 'player2', action).reason).toContain('cannot block');
    room = gameReducer(room, { type: 'ADD_CONTINUOUS_EFFECT', entry: { source: 'global', requiredZone: null, duration: 'PERMANENT', layer: 6,
      effect: { type: 'ABILITY', removeAll: true }, scope: { cardUuid: attacker.uuid } } });
    expect(declareBlockersHandler.validate(room, 'player2', action).success).toBe(true);
  });
  it('reconciles combat and control tenure when a static source enters another zone', () => {
    const attacker = creature('attacker', 'player1'), source = creature('control-source', 'player2');
    let room = combatRoom(createTestRoom(), attacker); source.state.zone = 'hand';
    source.blueprint = { ...source.blueprint, abilities: [{ id: 'control', type: 'static', activeZones: ['graveyard'], effects: [{ layer: 2,
      effect: { type: 'CONTROL', controllerId: 'player2' }, scope: { cardUuid: attacker.uuid } }] }] };
    room.players.player2.hand = [source];
    room = gameReducer(room, { type: 'MOVE_CARD', cardUuid: source.uuid, playerId: 'player2', from: 'hand', to: 'graveyard' });
    expect(service.resolveController(room, room.battlefield[0])).toBe('player2');
    expect(room.battlefield[0].state.summoningSickness).toBe(true);
    expect(room.combat).toEqual([]);
  });
  it('tracks tenure of entering noncreatures before they become creatures', () => {
    let room = createTestRoom(); const card = creature('artifact', 'player1'); card.state.zone = 'hand';
    card.blueprint = { ...card.blueprint, cardTypes: ['Artifact'] }; room.players.player1.hand = [card];
    room = gameReducer(room, { type: 'MOVE_CARD', cardUuid: card.uuid, playerId: 'player1', from: 'hand', to: 'battlefield' });
    room = gameReducer(room, { type: 'ADD_CONTINUOUS_EFFECT', entry: { source: 'global', requiredZone: null, origin: 'static', duration: 'PERMANENT', layer: 4,
      effect: { type: 'TYPE', add: ['Creature'] }, scope: { zones: ['battlefield'] } } });
    expect(ActionValidator.canPayCost(room, 'player1', room.battlefield[0], { tap: true })).toBe(false);
  });
  it('delayed trigger filters query effective event characteristics', () => {
    const room = createTestRoom(), source = creature('source', 'player1'), entrant = creature('artifact', 'player1');
    entrant.state.zone = 'hand'; entrant.blueprint = { ...entrant.blueprint, cardTypes: ['Artifact'] }; room.battlefield = [source]; room.players.player1.hand = [entrant];
    const engine = new GameEngine(room); engine.initRoom();
    try {
      engine.applyMutations([{ type: 'ADD_CONTINUOUS_EFFECT', entry: { source: 'global', requiredZone: null, origin: 'static', duration: 'PERMANENT', layer: 4, effect: { type: 'TYPE', add: ['Creature'] }, scope: { zones: ['battlefield'], cardTypes: ['Artifact'] } } },
        { type: 'ADD_DELAYED_TRIGGER', registration: { id: 'delayed', source, sourceInfo: captureSourceInformation(room, source), controllerId: 'player1', lifetime: 'once',
          ability: { id: 'watch', type: 'triggered', triggerCondition: 'ON_ENTER_BATTLEFIELD', castSpeed: 'instant', trigger: { subject: 'any', controller: 'any', cardTypes: ['Creature'] },
            effect: { action: 'MODIFY_LIFE', params: { amount: 1 }, targeting: { type: 'self', required: false }, tags: [] } } } },
        { type: 'MOVE_CARD', cardUuid: entrant.uuid, playerId: 'player1', from: 'hand', to: 'battlefield' }]);
      expect(engine.roomState.stack).toHaveLength(1);
    } finally { engine.dispose(); }
  });
  it('client targeting uses copied spell effects and selected copied modes', () => {
    let room = createTestRoom(); const card = creature('spell', 'player1'); card.state.zone = 'hand'; room.players.player1.hand = [card];
    const targeted = { action: 'DRAW', params: { amount: 1 }, targeting: { type: 'player' as const, required: true }, tags: [] };
    const blueprint = { ...card.blueprint, onCastEffects: [targeted] };
    room = gameReducer(room, { type: 'ADD_CONTINUOUS_EFFECT', entry: { source: 'global', requiredZone: null, duration: 'PERMANENT', layer: 1, effect: { type: 'COPY', blueprint }, scope: { cardUuid: card.uuid } } });
    expect(createTargetingState(card, 'hand', 'cast_spell', undefined, room)?.groups[0].targeting.type).toBe('player');
    room.continuousEffectPool = [];
    room = gameReducer(room, { type: 'ADD_CONTINUOUS_EFFECT', entry: { source: 'global', requiredZone: null, duration: 'PERMANENT', layer: 1,
      effect: { type: 'COPY', blueprint: { ...blueprint, onCastEffects: [], modes: [{ id: 'target', label: 'target', effects: [targeted] }] } }, scope: { cardUuid: card.uuid } } });
    expect(createTargetingState(card, 'hand', 'cast_spell', undefined, room)).toBeNull();
    expect(createTargetingState(card, 'hand', 'cast_spell', { modes: ['target'] }, room)?.groups[0].targeting.type).toBe('player');
  });
  it('derives death and entry events from effective types and controller', () => {
    let room = createTestRoom(); const card = creature('subject', 'player1'); room.battlefield = [card];
    room = gameReducer(room, { type: 'ADD_CONTINUOUS_EFFECT', entry: { source: 'global', requiredZone: null, duration: 'PERMANENT', layer: 4,
      effect: { type: 'TYPE', set: ['Artifact'] }, scope: { cardUuid: card.uuid } } });
    const mutation = { type: 'MOVE_CARD' as const, cardUuid: card.uuid, playerId: 'player1', from: 'battlefield' as const, to: 'graveyard' as const };
    const after = gameReducer(room, mutation);
    expect(deriveAppliedEvents(room, after, [{ mutation, before: room, after }]).map(e => e.eventId)).not.toContain('PERMANENT_DIED');
    const returning = { ...mutation, from: 'graveyard' as const, to: 'battlefield' as const };
    after.continuousEffectPool = [{ source: 'global', layer: 2, effect: { type: 'CONTROL', controllerId: 'player2' }, scope: { zones: ['battlefield'] }, duration: 'PERMANENT' }];
    const entered = gameReducer(after, returning);
    expect(deriveAppliedEvents(after, entered, [{ mutation: returning, before: after, after: entered }]).find(e => e.eventId === 'PERMANENT_ENTERED')?.payload).toMatchObject({ controllerId: 'player2' });
  });
  it('chooses a resolving spell destination from its effective types', () => {
    let room = createTestRoom(); const card = creature('spell', 'player1'); card.state.zone = 'stack';
    Object.assign(card, { blueprint: { ...card.blueprint, cardTypes: ['Sorcery'] } });
    const spell = { uuid: 'stack', type: 'spell', controllerId: 'player1', source: card, effects: [], countered: false } as any;
    room.stack = [spell];
    room = gameReducer(room, { type: 'ADD_CONTINUOUS_EFFECT', entry: { source: 'global', requiredZone: null, duration: 'PERMANENT', layer: 4, effect: { type: 'TYPE', set: ['Creature'] }, scope: { cardUuid: card.uuid } } });
    expect(applyStructuralZoneChange(room, spell).mutations[0]).toMatchObject({ type: 'MOVE_CARD', to: 'battlefield' });
  });
  it('removes legacy enter abilities and copies the donor enter effects', () => {
    let room = createTestRoom(); const card = creature('entrant', 'player1');
    const draw = { action: 'DRAW', params: { amount: 1 }, targeting: { type: 'self', required: false }, tags: [] } as const;
    Object.assign(card, { blueprint: { ...card.blueprint, onEnterEffects: [draw] } }); room.battlefield = [card];
    const event = { eventId: 'PERMANENT_ENTERED', roomId: room.roomId, payload: { card, controllerId: 'player1' } } as any;
    const scan = () => discoverTriggers(event, { roomId: room.roomId, room, battlefield: room.battlefield });
    expect(scan()).toHaveLength(1);
    room = gameReducer(room, { type: 'ADD_CONTINUOUS_EFFECT', entry: { source: 'global', requiredZone: null, duration: 'PERMANENT', layer: 6, effect: { type: 'ABILITY', removeAll: true }, scope: { cardUuid: card.uuid } } });
    expect(scan()).toEqual([]);
    room.continuousEffectPool = [];
    const donor = creature('donor', 'player1'); Object.assign(donor, { blueprint: { ...donor.blueprint, onEnterEffects: [{ ...draw, params: { amount: 2 } }] } });
    room = gameReducer(room, { type: 'ADD_CONTINUOUS_EFFECT', entry: { source: 'global', requiredZone: null, duration: 'PERMANENT', layer: 1, effect: { type: 'COPY', blueprint: donor.blueprint }, scope: { cardUuid: card.uuid } } });
    expect(scan()[0].effects[0].params.amount).toBe(2);
  });
  it('removes combat participants when an effect changes their type or control', () => {
    const card = creature('attacker', 'player1');
    for (const effect of [{ type: 'TYPE', set: ['Artifact'] }, { type: 'CONTROL', controllerId: 'player2' }] as ContinuousEffect[]) {
      const room = combatRoom(createTestRoom(), card);
      const next = gameReducer(room, { type: 'ADD_CONTINUOUS_EFFECT', entry: { source: 'global', requiredZone: null, duration: 'PERMANENT', layer: 4, effect, scope: { cardUuid: card.uuid } } });
      expect(next.combat).toEqual([]);
    }
  });
  it('uses effective control for declarations, declaration snapshots and client selections', () => {
    let room = createTestRoom(); const card = creature('attacker', 'player2'); room.battlefield = [card]; room.phase = 'declareAttackersStep'; room.activeTurnPlayerId = 'player1';
    room = gameReducer(room, { type: 'ADD_CONTINUOUS_EFFECT', entry: { source: 'global', requiredZone: null, duration: 'PERMANENT', layer: 2, effect: { type: 'CONTROL', controllerId: 'player1' }, scope: { cardUuid: card.uuid } } });
    room = gameReducer(room, { type: 'SET_SUMMONING_SICKNESS', cardUuid: card.uuid, value: false });
    expect(declareAttackersHandler.validate(room, 'player1', { attackers: [{ cardUuid: card.uuid }] }).success).toBe(true);
    const result = declareAttackersHandler.propose(room, 'player1', { attackers: [{ cardUuid: card.uuid }] });
    for (const mutation of result.mutations!) room = gameReducer(room, mutation);
    expect(room.combat).toHaveLength(1);
    expect(room.combat[0].attacker.state.controllerId).toBe('player1');
    card.state.isTapped = false; card.state.attackedThisTurn = false;
    const selectable = { ...room, battlefield: [card], combatDeclarations: { attackers: false, blockers: false } };
    expect(reconcileCombatSelection({ attackers: [card.uuid], blockerPairs: [], pendingBlocker: null }, selectable).selection.attackers).toEqual([card.uuid]);
  });
  it('retains effective source colors, types, keywords and controller after departure', () => {
    let room = createTestRoom(); const card = creature('source', 'player1'); room.battlefield = [card];
    for (const effect of [{ type: 'COLOR', set: ['blue'] }, { type: 'TYPE', add: ['Artifact'] }, { type: 'ABILITY', addKeywords: ['Flying'] }, { type: 'CONTROL', controllerId: 'player2' }] as ContinuousEffect[]) {
      room = gameReducer(room, { type: 'ADD_CONTINUOUS_EFFECT', entry: { source: 'global', requiredZone: null, duration: 'PERMANENT', layer: 6, effect, scope: { cardUuid: card.uuid } } });
    }
    const snapshot = captureSourceInformation(room, card);
    room = gameReducer(room, { type: 'MOVE_CARD', cardUuid: card.uuid, playerId: 'player1', from: 'battlefield', to: 'graveyard' });
    room = gameReducer(room, { type: 'CLEAR_END_OF_TURN_EFFECTS' }); room.continuousEffectPool = [];
    expect(service.resolve(room, snapshot.card)).toMatchObject({ cardTypes: ['Creature', 'Artifact'], colors: ['blue'], keywords: ['Flying'], controllerId: 'player2' });
  });
  it('discovers gained triggers and stops discovering removed ones', () => {
    let room = createTestRoom(); const card = creature('watcher', 'player1'); room.battlefield = [card];
    const trigger: CardAbility = { id: 'draw', type: 'triggered', castSpeed: 'instant', triggerCondition: 'BEGIN_UPKEEP', effect: { action: 'DRAW', params: { amount: 1 }, targeting: { type: 'self', required: false }, tags: [] } };
    const event = { eventId: 'UPKEEP_STARTED', roomId: room.roomId, payload: { playerId: 'player1' } } as any;
    room = gameReducer(room, { type: 'ADD_CONTINUOUS_EFFECT', entry: { source: 'global', requiredZone: null, duration: 'PERMANENT', layer: 6, effect: { type: 'ABILITY', add: [trigger] }, scope: { cardUuid: card.uuid } } });
    expect(discoverTriggers(event, { roomId: room.roomId, room, battlefield: room.battlefield })).toHaveLength(1);
    room = gameReducer(room, { type: 'ADD_CONTINUOUS_EFFECT', entry: { source: 'global', requiredZone: null, duration: 'PERMANENT', layer: 6, effect: { type: 'ABILITY', removeAll: true }, scope: { cardUuid: card.uuid } } });
    expect(discoverTriggers(event, { roomId: room.roomId, room, battlefield: room.battlefield })).toEqual([]);
  });
  it('client targeting uses granted ability definitions', () => {
    let room = createTestRoom(); const card = creature('source', 'player1'); room.battlefield = [card];
    room = gameReducer(room, { type: 'ADD_CONTINUOUS_EFFECT', entry: { source: 'global', requiredZone: null, duration: 'PERMANENT', layer: 6, scope: { cardUuid: card.uuid }, effect: { type: 'ABILITY', add: [{ id: 'target', type: 'activated', castSpeed: 'instant', cost: {}, effect: { action: 'GRANT_STATS', params: { power: 1 }, tags: [], targeting: { type: 'permanent', required: true, cardTypes: ['Creature'] } } }] } } });
    const targeting = createTargetingState(card, 'battlefield', 'activate_ability', { abilityId: service.resolveAbilities(room, card)[0].id }, room);
    expect(targeting?.groups).toHaveLength(1);
  });
  it('normalizes static definitions and explicit colors without treating them as activated abilities', () => {
    const raw = { id: 'generic-static', name: 'generic-static', cardTypes: ['Enchantment'], colors: ['blue'], abilities: [{ id: 'anthem', type: 'static', activeZones: ['graveyard'], effects: [{ layer: 7, effect: { type: 'STAT_DELTA', power: 1 }, scope: { cardTypes: ['Creature'] } }] }] };
    const blueprint = normalizeCard(raw);
    expect(blueprint.abilities[0]).toMatchObject(raw.abilities[0]);
    expect(blueprint.colors).toEqual(['blue']);
  });
  it('removed land mana abilities stay removed', () => {
    let room = createTestRoom(); const card = creature('land', 'player1'); Object.assign(card, { blueprint: { ...card.blueprint, cardTypes: ['Land'] } }); room.battlefield = [card];
    expect(manaAbilities(card, room)).toHaveLength(1);
    room = gameReducer(room, { type: 'ADD_CONTINUOUS_EFFECT', entry: { source: 'global', requiredZone: null, duration: 'PERMANENT', layer: 6, effect: { type: 'ABILITY', removeAll: true }, scope: { cardUuid: card.uuid } } });
    expect(manaAbilities(card, room)).toEqual([]);
  });
});
