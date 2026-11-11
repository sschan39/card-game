import { describe, expect, it } from 'vitest';
import { CardCharacteristicService } from '@engine/card-characteristic-service';
import { EventBus } from '@engine/event-bus';
import { TriggerManager, discoverTriggers } from '@engine/trigger-manager';
import { probeCardResult, settleCardResult } from '@engine/resolution-results';
import { planDamageResults } from '@engine/damage-keywords';
import { hasKeyword } from '@engine/card-utils';
import { abilityUsageAvailable, withReservedAbilityUses } from '@engine/ability-usage';
import { abilityUseKey } from '@engine/turn-history';
import { createTestRoom } from '../helpers/test-room-factory';
import { creature } from '../helpers/combat-fixture';
import { gameConfig } from '@config';
import type { GameRoom } from '@shared/game.room.types';
import type { CardAbility, CardInstance } from '@shared/card.types';
import type { ContinuousEffectEntry } from '@shared/continuous-effect.types';
import type { StackObject } from '@shared/effect.types';
import type { GameMutation } from '@shared/game-mutation.types';
import type { PendingTrigger } from '@engine/trigger-manager';

const gain = { action: 'MODIFY_LIFE', params: { amount: 1 } };

function room(): GameRoom {
  const state = createTestRoom({ phase: 'stateMainPhase', priorityPlayerId: 'player1', activeTurnPlayerId: 'player1' });
  state.battlefield = [];
  state.continuousEffectPool = [];
  return state;
}

function entry(partial: Partial<ContinuousEffectEntry> & Pick<ContinuousEffectEntry, 'effect' | 'source'>): ContinuousEffectEntry {
  return {
    layer: 7,
    scope: {},
    duration: 'PERMANENT',
    requiredZone: null,
    origin: 'static',
    ...partial,
  } as ContinuousEffectEntry;
}

function stackObject(source: CardInstance): StackObject {
  return { uuid: 'stack-object', type: 'triggered', controllerId: 'player1', source, effects: [], countered: false };
}

describe('characteristic layer branches', () => {
  it('reads characteristic-defining statics from any active zone', () => {
    const state = room();
    const target = creature('target', 'player1', 2, 2);
    state.battlefield.push(target);
    const source = creature('source', 'player1');
    source.state.zone = 'hand';
    source.blueprint = {
      ...source.blueprint,
      abilities: [{
        id: 'aura', type: 'static', characteristicDefining: true,
        effects: [{ layer: 7, effect: { type: 'STAT_DELTA', power: 1 }, scope: { cardTypes: ['Creature'] } }],
      }] as unknown as CardAbility[],
    };
    state.players.player1.hand = [source];
    expect(CardCharacteristicService.resolvePower(state, target)).toBe(3);
  });

  it('applies empty text replacements, id-less copy abilities and permission fallbacks', () => {
    const state = room();
    const target = creature('target', 'player1');
    state.battlefield.push(target);
    target.blueprint = {
      ...target.blueprint,
      abilities: [{ type: 'triggered', triggerCondition: 'ON_ENTER_BATTLEFIELD', effect: gain }] as unknown as CardAbility[],
    };
    state.continuousEffectPool = [
      entry({ id: 'text', source: 'global', effect: { type: 'TEXT', replacements: {} } }),
      entry({
        id: 'copy', source: 'global',
        effect: { type: 'COPY', blueprint: { ...target.blueprint, abilities: [
          { type: 'triggered', triggerCondition: 'ON_ENTER_BATTLEFIELD', effect: gain },
        ] as unknown as CardAbility[] } },
      }),
      entry({ id: 'permission', source: 'ghost', sourceControllerId: 'player1', effect: { type: 'PERMISSION', rules: [{ action: 'cast', mode: 'instant' }] } }),
    ];
    const resolved = CardCharacteristicService.resolveBlueprint(state, target);
    expect(resolved.permissions).toEqual([{ action: 'cast', mode: 'instant', sourceControllerId: 'player1' }]);
    expect(CardCharacteristicService.resolvePower(state, target)).toBe(target.blueprint.power);
  });

  it('removes and adds abilities without ids and keeps generated ids unique', () => {
    const state = room();
    const target = creature('target', 'player1');
    state.battlefield.push(target);
    target.blueprint = {
      ...target.blueprint,
      abilities: [
        { type: 'triggered', triggerCondition: 'ON_ENTER_BATTLEFIELD', effect: gain },
        { id: 'clash@grant:1', type: 'triggered', triggerCondition: 'ON_ENTER_BATTLEFIELD', effect: gain },
      ] as unknown as CardAbility[],
    };
    state.continuousEffectPool = [entry({
      id: 'grant', source: 'global',
      effect: {
        type: 'ABILITY', removeIds: [''],
        add: [
          { type: 'triggered', triggerCondition: 'ON_ENTER_BATTLEFIELD', effect: gain },
          { id: 'clash', type: 'triggered', triggerCondition: 'ON_ENTER_BATTLEFIELD', effect: gain },
        ] as unknown as CardAbility[],
      },
    })];
    const abilities = CardCharacteristicService.resolveAbilities(state, target).map((ability) => ability.id);
    expect(abilities).toContain('ability@grant:0');
    expect(abilities).toContain('clash@grant:1:');
  });

  it('evaluates conditions with a missing source and controller', () => {
    const state = room();
    state.turnHistory = undefined;
    const target = creature('target', 'player1');
    state.battlefield.push(target);
    state.continuousEffectPool = [entry({
      source: 'ghost',
      effect: { type: 'STAT_DELTA', power: 1 },
      scope: { cardTypes: ['Creature'] },
      condition: { op: 'eq', left: { path: 'target.power' }, right: 999 },
    })];
    expect(CardCharacteristicService.resolvePower(state, target)).toBe(target.blueprint.power);
  });

  it('drops static entries whose source ability no longer exists', () => {
    const state = room();
    const target = creature('target', 'player1');
    state.battlefield.push(target);
    state.continuousEffectPool = [entry({
      id: 'stale', source: 'missing', sourceAbilityId: 'gone',
      effect: { type: 'STAT_DELTA', power: 5 }, scope: { cardTypes: ['Creature'] },
    })];
    expect(CardCharacteristicService.resolvePower(state, target)).toBe(target.blueprint.power);
  });

  it('falls back to printed characteristics for a departed copiable card', () => {
    const state = room();
    const card = creature('departed', 'player1');
    card.state.zone = 'battlefield';
    card.state.zoneRevision = 3;
    card.lastKnownCharacteristics = {} as never;
    expect(CardCharacteristicService.resolveCopiableBlueprint(state, card).name).toBe(card.blueprint.name);
  });
});

describe('ability usage fallbacks', () => {
  it('defaults an id-less occurrence key and tolerates a missing turn number', () => {
    const state = room();
    const source = creature('source', 'player1');
    const noId = { type: 'triggered', triggerCondition: 'ON_ENTER_BATTLEFIELD', effect: gain } as unknown as CardAbility;
    expect(abilityUsageAvailable(state, source, noId)).toBe(true);

    state.turnNumber = undefined;
    state.turnHistory = undefined;
    const budgeted = { id: 'spend', type: 'activated', effect: gain, limitPerTurn: 1 } as unknown as CardAbility;
    expect(abilityUsageAvailable(state, source, budgeted, [
      { type: 'RECORD_ABILITY_USE', key: abilityUseKey(source, 'spend') },
    ])).toBe(false);
    const reserved = withReservedAbilityUses(state, [
      { type: 'RECORD_ABILITY_USE', key: abilityUseKey(source, 'spend') },
    ]);
    expect(reserved.turnHistory).toBeUndefined();
  });
});

describe('resolution result incarnations', () => {
  it('matches absent zone revisions through the zero fallback', () => {
    const card = creature('milled', 'player1');
    card.state.zone = 'library';
    card.state.zoneRevision = undefined;
    const state = room();
    state.players.player1.deck = [card];
    const produced: GameMutation[] = [
      { type: 'MOVE_CARD', cardUuid: card.uuid, playerId: 'player1', from: 'library', to: 'graveyard', reason: 'discard', zoneRevision: 0 },
    ];
    const probe = probeCardResult(state, stackObject(card), { name: 'milled', kind: 'milled' }, produced)!;
    expect(probe.cards).toHaveLength(1);
    const settled = settleCardResult(state, stackObject(card), probe, produced);
    expect(settled.resolutionResults?.milled.cards[0].after?.card.state.zone).toBe('graveyard');
  });

  it('records no arrival when the probed incarnation is already gone', () => {
    const state = room();
    const ghost = creature('ghost', 'player1');
    const object = stackObject(ghost);
    const probe = {
      name: 'milled', kind: 'milled' as const,
      cards: [{ before: { card: { ...ghost, uuid: 'vanished', state: { ...ghost.state, zone: 'library' as const, zoneRevision: 0 } } } }],
    };
    const settled = settleCardResult(state, object, probe, [
      { type: 'MOVE_CARD', cardUuid: 'vanished', playerId: 'player1', from: 'library', to: 'graveyard' },
    ]);
    expect(settled.resolutionResults?.milled.cards[0].after).toBeUndefined();
  });
});

describe('card keyword helper', () => {
  it('handles blueprints with no keyword list', () => {
    const card = creature('plain', 'player1');
    card.blueprint = { ...card.blueprint, keywords: undefined as unknown as string[] };
    expect(hasKeyword(card, 'Flying')).toBe(false);
  });
});

describe('damage keyword combinations', () => {
  it('plans loyalty, defense, wither, deathtouch and lifelink damage', () => {
    const state = room();
    const walker = creature('walker', 'player2');
    walker.blueprint = { ...walker.blueprint, cardTypes: ['Planeswalker'] };
    const battle = creature('battle', 'player2');
    battle.blueprint = { ...battle.blueprint, cardTypes: ['Battle'] };
    const victim = creature('victim', 'player2');
    const artifact = creature('artifact', 'player2');
    artifact.blueprint = { ...artifact.blueprint, cardTypes: ['Artifact'] };
    state.battlefield.push(walker, battle, victim, artifact);
    const source = creature('source', 'player1');
    source.blueprint = { ...source.blueprint, keywords: ['Wither', 'Deathtouch', 'Lifelink'] };
    state.battlefield.push(source);
    const results = planDamageResults(state, [
      { amount: 2, recipient: { kind: 'permanent', cardUuid: walker.uuid, zoneRevision: walker.state.zoneRevision ?? 0 }, source: { card: source } },
      { amount: 2, recipient: { kind: 'permanent', cardUuid: battle.uuid, zoneRevision: battle.state.zoneRevision ?? 0 }, source: { card: source } },
      { amount: 2, recipient: { kind: 'permanent', cardUuid: victim.uuid, zoneRevision: victim.state.zoneRevision ?? 0 }, source: { card: source } },
      { amount: 2, recipient: { kind: 'permanent', cardUuid: artifact.uuid, zoneRevision: artifact.state.zoneRevision ?? 0 }, source: { card: source } },
      { amount: 2, recipient: { kind: 'player', playerId: 'player2' }, source: { card: source } },
    ] as never);
    expect(results.filter((mutation) => mutation.type === 'REMOVE_COUNTER').map((mutation) => mutation.counterType))
      .toEqual(['loyalty', 'defense']);
    expect(results.some((mutation) => mutation.type === 'SET_DEATHTOUCH_DAMAGE')).toBe(true);
    expect(results.filter((mutation) => mutation.type === 'CHANGE_LIFE')).toHaveLength(6);
  });

  it('skips lifelink when the source controller has left the game', () => {
    const state = room();
    const source = creature('source', 'ghost');
    source.blueprint = { ...source.blueprint, keywords: ['Lifelink'] };
    state.battlefield.push(source);
    const results = planDamageResults(state, [
      { amount: 1, recipient: { kind: 'player', playerId: 'player2' }, source: { card: source } },
    ] as never);
    expect(results.map((mutation) => mutation.type)).toEqual(['CHANGE_LIFE']);
  });
});

describe('trigger manager edge branches', () => {
  it('deduplicates discovered abilities that share a source and id', () => {
    const state = room();
    const card = creature('source', 'player1');
    card.blueprint = {
      ...card.blueprint,
      abilities: [
        { id: 'dup', type: 'triggered', triggerCondition: 'ON_ENTER_BATTLEFIELD', effect: gain },
        { id: 'dup', type: 'triggered', triggerCondition: 'ON_ENTER_BATTLEFIELD', effect: gain },
      ] as unknown as CardAbility[],
    };
    state.battlefield.push(card);
    const pending = discoverTriggers(
      { eventId: 'PERMANENT_ENTERED', roomId: state.roomId, payload: { card, controllerId: 'player1' } },
      { roomId: state.roomId, battlefield: state.battlefield },
    );
    expect(pending).toHaveLength(1);
  });

  it('falls back to on-enter accounting and recaptured source information', () => {
    const state = room();
    const source = creature('source', 'player1');
    source.blueprint = { ...source.blueprint, onEnterEffects: [gain] };
    state.battlefield.push(source);
    const collector: GameMutation[] = [];
    const bus = new EventBus(state.roomId);
    const manager = new TriggerManager(bus, collector, () => 'generated-uuid', () => state);
    const previous = gameConfig.logging.appliedEvents;
    gameConfig.logging.appliedEvents = true;
    try {
      const event = {
        eventId: 'PERMANENT_ENTERED', eventUuid: 'event-1', roomId: state.roomId,
        payload: { card: source, controllerId: 'player1' },
      };
      (manager as unknown as { onEvent(event: unknown, context: unknown): void }).onEvent(event, { before: state, after: state });
      expect(collector.some((mutation) => mutation.type === 'PUSH_STACK')).toBe(true);
      const trigger: PendingTrigger = {
        source, sourceInfo: undefined, controllerId: 'player1', effects: [],
        event: { eventId: 'PERMANENT_ENTERED', eventUuid: 'event-2', roomId: state.roomId, payload: {} },
      };
      expect((manager as unknown as { pushTrigger(trigger: PendingTrigger, room: GameRoom, key: string): boolean })
        .pushTrigger(trigger, state, 'entry-key')).toBe(true);
    } finally {
      gameConfig.logging.appliedEvents = previous;
      manager.dispose(bus);
    }
  });
});
