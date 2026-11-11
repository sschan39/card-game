import { describe, expect, it, vi } from 'vitest';
import { instantiateCard } from '@library/card-factory';
import { createTestRoom, fillTestLibraries } from '../helpers/test-room-factory';
import { creature } from '../helpers/combat-fixture';
import { hasKeyword, lethalDamageFor } from '@engine/card-utils';
import { abilityEffects } from '@engine/ability-effects';
import { declarationPlayer, isActionTimingAllowed, isMainPhase, PHASE_LABELS } from '@rules/turn-utils';
import { effectIsActive, effectSource, roomCards } from '@engine/continuous-effect-state';
import { selectModeEffects, validResolutionChoices } from '@rules/action-modes';
import { collectCardSource, validCardResultSource } from '@rules/card-collections';
import { validCardFilter } from '@rules/card-filter-validation';
import { conditionMatches } from '@rules/rule-condition-matcher';
import { ManaPool } from '@engine/mana-pool';
import { canAffordMaterials, materialPaymentOptions, planMaterialPayment } from '@engine/material-costs';
import {
  abilityUsage, abilityUsageAvailable, recordAbilityCommit, recordAbilityUsage, withReservedAbilityUses,
} from '@engine/ability-usage';
import { clearCardResults, probeCardResult, settleCardResult } from '@engine/resolution-results';
import { buildScenarioRoom, scenarioRandom } from '@engine/scenario-setup';
import {
  buildStartingCardMutations, createRoom, dealStartingHands, joinRoom, setupRPS,
} from '@engine/room-factory';
import { planDamageResults } from '@engine/damage-keywords';
import { declareBlockersHandler } from '@engine/handlers/declare-blockers-handler';
import { enterBattleHandler } from '@engine/handlers/enter-battle-handler';
import { playerCommands, validateActionData } from '@engine/player-commands';
import { captureSourceInformation } from '@engine/source-information';
import { createCardState } from '@rules/card-state';
import { gameReducer } from '@engine/game-reducer';
import { gameConfig } from '@config';
import type {
  ActivatedAbility, CardAbility, CardInstance, CardSnapshot, TriggeredAbility,
} from '@shared/card.types';
import type { ContinuousEffectEntry } from '@shared/continuous-effect.types';
import type { GameMutation } from '@shared/game-mutation.types';
import type { GameRoom } from '@shared/game.room.types';
import type { StackObject } from '@shared/effect.types';
import type { RuntimeContext } from '@rules/runtime-context';
import type { GameEngine } from '@engine/game-engine';

const drawEffect = { action: 'DRAW', params: { amount: 1 }, tags: [], targeting: { type: 'self', required: false } } as const;

function activated(extra: Partial<ActivatedAbility> = {}): ActivatedAbility {
  return {
    id: 'use', type: 'activated', cost: {}, castSpeed: 'instant', effect: drawEffect as never, ...extra,
  } as ActivatedAbility;
}

describe('small pure engine helpers', () => {
  it('reports printed keywords and their absence', () => {
    const card = creature('keyword-card', 'player1');
    expect(hasKeyword(card, 'Flying')).toBe(false);
    card.blueprint = { ...card.blueprint, keywords: ['Flying'] };
    expect(hasKeyword(card, 'Flying')).toBe(true);
    expect(lethalDamageFor(createTestRoom(), card)).toBe(4);
  });

  it('normalises legacy single-effect, ordered and empty abilities', () => {
    const ordered = { id: 'a', effects: [drawEffect, drawEffect] } as unknown as ActivatedAbility;
    const legacy = { id: 'b', effect: drawEffect } as unknown as ActivatedAbility;
    const empty = { id: 'c' } as unknown as ActivatedAbility;
    expect(abilityEffects(ordered)).toHaveLength(2);
    expect(abilityEffects(legacy)).toEqual([drawEffect]);
    expect(abilityEffects(empty)).toEqual([]);
  });

  it('exposes phase labels and timing predicates', () => {
    expect(PHASE_LABELS.stateMainPhase).toBe('Precombat Main');
    expect(isMainPhase('stateMainPhase')).toBe(true);
    expect(isMainPhase('postcombatMainPhase')).toBe(true);
    expect(isMainPhase('upkeepStep')).toBe(false);
    const room = createTestRoom();
    expect(isActionTimingAllowed(room, 'player1')).toBe(true);
    expect(isActionTimingAllowed(room, 'player2', 'sorcery')).toBe(false);
    room.activeTurnPlayerId = 'player2';
    expect(isActionTimingAllowed(room, 'player2', 'sorcery')).toBe(true);
    room.stack.push({ uuid: 's' } as StackObject);
    expect(isActionTimingAllowed(room, 'player2', 'sorcery')).toBe(false);
  });

  it('names the declaration owner, including an empty player-two seat', () => {
    const room = createTestRoom({ phase: 'declareAttackersStep' });
    expect(declarationPlayer(room)).toBe('player1');
    room.combatDeclarations = { attackers: true, blockers: false };
    expect(declarationPlayer(room)).toBeNull();
    room.phase = 'declareBlockersStep';
    room.combatDeclarations = undefined;
    expect(declarationPlayer(room)).toBe('player2');
    room.player2Id = null;
    expect(declarationPlayer(room)).toBeNull();
    room.activeTurnPlayerId = 'ghost';
    room.player2Id = 'player2';
    expect(declarationPlayer(room)).toBe('player1');
  });
});

describe('continuous effect source state', () => {
  const entry = (extra: Partial<ContinuousEffectEntry> = {}): ContinuousEffectEntry => ({
    source: 'source', layer: 7, effect: { type: 'STAT_DELTA', power: 1 }, scope: { self: true },
    duration: 'PERMANENT', ...extra,
  });

  it('de-duplicates room cards and resolves revision/zone-constrained sources', () => {
    const room = createTestRoom();
    const card = creature('source', 'player1');
    room.battlefield = [card];
    expect(roomCards(room).filter((c) => c.uuid === 'source')).toHaveLength(1);
    expect(effectSource([card], entry())).toBe(card);
    expect(effectSource([card], entry({ sourceRevision: 1 }))).toBeUndefined();
    expect(effectSource([card], entry({ requiredZone: 'hand' }))).toBeUndefined();
    expect(effectSource([card], entry({ requiredZone: 'battlefield' }))).toBe(card);
  });

  it('keeps WHILE_ATTACHED active only while the source is attached', () => {
    const card = creature('source', 'player1');
    expect(effectIsActive([card], entry({ duration: 'WHILE_ON_BATTLEFIELD' }))).toBe(true);
    expect(effectIsActive([], entry({ duration: 'WHILE_ON_BATTLEFIELD' }))).toBe(false);
    expect(effectIsActive([card], entry({ duration: 'WHILE_ATTACHED' }))).toBe(false);
    card.state.attachedTo = 'other';
    expect(effectIsActive([card], entry({ duration: 'WHILE_ATTACHED' }))).toBe(true);
  });

  it('treats zone-independent effects as always active and fallen sources as inactive', () => {
    const card = creature('source', 'player1');
    expect(effectIsActive([], entry({ requiredZone: null }))).toBe(true);
    expect(effectIsActive([], entry({ origin: 'resolved', requiredZone: undefined }))).toBe(true);
    expect(effectIsActive([], entry({ source: 'global' }))).toBe(true);
    expect(effectIsActive([], entry({ source: 'emblem' }))).toBe(true);
    expect(effectIsActive([], entry({ requiredZone: 'graveyard' }))).toBe(false);
    const graveyard = creature('source', 'player1');
    graveyard.state.zone = 'graveyard';
    expect(effectIsActive([graveyard], entry({ requiredZone: 'graveyard' }))).toBe(true);
  });
});

describe('resolution mode selection', () => {
  const base = [drawEffect as never];

  it('returns base for undefined or empty selections when no modes are authored', () => {
    expect(selectModeEffects(base, undefined, undefined)).toBe(base);
    expect(selectModeEffects(base, [], [])).toBe(base);
    expect(selectModeEffects(base, [], ['x'])).toBeUndefined();
    expect(selectModeEffects(base, undefined, ['x'])).toBeUndefined();
  });

  it('rejects invalid branches and appends selected modes in order', () => {
    expect(validResolutionChoices(base)).toBe(true);
    expect(validResolutionChoices([{ ...drawEffect, choice: { kind: 'options', options: [] } } as never])).toBe(true);
    const target = { kind: 'options', options: [{ id: 'o', effects: [{ ...drawEffect, targeting: { type: 'permanent', required: true } }] }] } as never;
    expect(validResolutionChoices([{ ...drawEffect, choice: target } as never])).toBe(false);
    const modes = [
      { id: 'm1', effects: [drawEffect as never] },
      { id: 'm2', effects: [drawEffect as never] },
    ];
    const combined = selectModeEffects(base, modes, ['m2', 'm1'], { min: 2, max: 2 });
    expect(combined).toHaveLength(3);
    expect(selectModeEffects(base, modes, ['m1', 'm1'])).toBeUndefined();
    expect(selectModeEffects(base, modes, ['bogus'])).toBeUndefined();
    expect(selectModeEffects(base, modes, [1 as never])).toBeUndefined();
    expect(selectModeEffects(base, modes, [])).toBeUndefined();
    expect(selectModeEffects(base, modes, ['m1'], { min: 2, max: 2 })).toBeUndefined();
  });

  it('enforces mode cast timing when a room is supplied', () => {
    const room = createTestRoom();
    const sorcery = [{ id: 'slow', effects: [drawEffect as never], castSpeed: 'sorcery' as const }];
    expect(selectModeEffects(base, sorcery, ['slow'], undefined, { room, playerId: 'player2' })).toBeUndefined();
    room.activeTurnPlayerId = 'player2';
    expect(selectModeEffects(base, sorcery, ['slow'], undefined, { room, playerId: 'player2' })).toHaveLength(2);
  });
});

describe('card collections and filters', () => {
  it('rejects malformed result sources', () => {
    for (const value of [null, undefined, 1, 'x', [], {}, { kind: 'result' }, { kind: 'result', name: '' },
      { kind: 'result', name: '  ' }, { kind: 'result', name: '__proto__' }, { kind: 'result', name: 'ok', view: 'other' },
      { kind: 'result', name: 'ok', extra: true }]) {
      expect(validCardResultSource(value)).toBe(false);
    }
    expect(validCardResultSource({ kind: 'result', name: 'ok' })).toBe(true);
    expect(validCardResultSource({ kind: 'result', name: 'ok', view: 'recorded' })).toBe(true);
    expect(validCardResultSource({ kind: 'result', name: 'ok', view: 'current' })).toBe(true);
  });

  it('returns cards unchanged when no result source is requested', () => {
    const card = creature('card', 'player1');
    expect(collectCardSource([card])).toEqual([{ card }]);
    expect(collectCardSource([card], { kind: 'result', name: 'missing' }, {})).toBeUndefined();
  });

  it('accepts bounded filters and rejects unknown or malformed fields', () => {
    expect(validCardFilter({ tapped: true })).toBe(true);
    expect(validCardFilter({ tapped: 'yes' })).toBe(false);
    expect(validCardFilter({ summonKind: 'cast' })).toBe(true);
    expect(validCardFilter({ summonKind: 'effect' })).toBe(true);
    expect(validCardFilter({ summonKind: 'other' })).toBe(false);
    expect(validCardFilter({ power: { min: 1, max: 2 } })).toBe(true);
    expect(validCardFilter({ power: { min: 3, max: 2 } })).toBe(false);
    expect(validCardFilter({ counter: { type: 'x', min: 0 } })).toBe(true);
    expect(validCardFilter({ counter: { type: '', min: 0 } })).toBe(false);
    expect(validCardFilter({ unknownField: true })).toBe(false);
    expect(validCardFilter({ colors: ['purple'] })).toBe(false);
    expect(validCardFilter({ controller: 'nobody' })).toBe(false);
    expect(validCardFilter({ nameContains: 1 })).toBe(false);
    expect(validCardFilter({ ids: 'x' })).toBe(false);
    expect(validCardFilter({ allOf: [{ tapped: true }] })).toBe(true);
    expect(validCardFilter({ anyOf: [null] })).toBe(false);
    expect(validCardFilter({ not: { tapped: true } })).toBe(true);
    expect(validCardFilter(null)).toBe(false);
    expect(validCardFilter([])).toBe(false);
    let deeplyNested: unknown = { tapped: true };
    for (let i = 0; i < 26; i++) deeplyNested = { not: deeplyNested };
    expect(validCardFilter(deeplyNested)).toBe(false);
  });
});

describe('rule condition matching', () => {
  const match = (condition: unknown, context: unknown = {}) =>
    conditionMatches(condition as never, context);

  it('covers every comparison operator', () => {
    expect(match({ op: 'eq', left: 1, right: 1 })).toBe(true);
    expect(match({ op: 'ne', left: 1, right: 2 })).toBe(true);
    expect(match({ op: 'ne', left: 2, right: 2 })).toBe(false);
    expect(match({ op: 'includes', left: { path: 'list' }, right: 'a' }, { list: ['a', 'b'] })).toBe(true);
    expect(match({ op: 'includes', left: { path: 'list' }, right: 'z' }, { list: ['a', 'b'] })).toBe(false);
    expect(match({ op: 'gt', left: 2, right: 1 })).toBe(true);
    expect(match({ op: 'gte', left: 1, right: 1 })).toBe(true);
    expect(match({ op: 'lt', left: 1, right: 2 })).toBe(true);
    expect(match({ op: 'lte', left: 2, right: 1 })).toBe(false);
    expect(match({ op: 'lte', left: 1, right: 2 })).toBe(true);
    expect(match({ op: 'lte', left: 'a', right: 2 })).toBe(false);
    expect(match({ op: 'lte', left: 1, right: 'b' })).toBe(false);
  });

  it('combines boolean nodes, unresolved values and path reads', () => {
    expect(match(undefined)).toBe(true);
    expect(match({ all: [{ op: 'eq', left: 1, right: 1 }] })).toBe(true);
    expect(match({ any: [{ op: 'eq', left: 1, right: 2 }] })).toBe(false);
    expect(match({ not: { op: 'eq', left: 1, right: 2 } })).toBe(true);
    expect(match({ op: 'eq', left: { path: 'a.b' }, right: 1 }, { a: { b: 1 } })).toBe(true);
    expect(match({ op: 'eq', left: { path: 'missing' }, right: 1 }, {})).toBe(false);
    expect(match({ all: [{ op: 'eq', left: { numeric: { kind: 'binding', name: 'missing' } }, right: 1 }] })).toBe(false);
  });
});

describe('mana pool arithmetic', () => {
  const pool = () => ({ white: 1, blue: 2, green: 0, black: 0, red: 1, yellow: 0 });

  it('proposes colored and generic allocations', () => {
    expect(ManaPool.proposePayment(pool(), { red: 1, generic: 2 })).toEqual({ red: 1, white: 1, blue: 1 });
    expect(ManaPool.proposePayment(pool(), { red: 2 })).toBeUndefined();
    expect(ManaPool.proposePayment(pool(), { generic: 5 })).toBeUndefined();
    expect(ManaPool.canPay(pool(), { generic: 4 })).toBe(true);
    expect(ManaPool.canPay(pool(), { generic: 5 })).toBe(false);
  });

  it('validates explicit allocations instead of proposing one', () => {
    expect(ManaPool.proposePayment(pool(), { red: 1, generic: 1 }, { red: 1, blue: 1 })).toEqual({ red: 1, blue: 1 });
    expect(ManaPool.proposePayment(pool(), { generic: 1 }, { red: 2 })).toBeUndefined();
    expect(ManaPool.proposePayment(pool(), { red: 1 }, { blue: 1 })).toBeUndefined();
    expect(ManaPool.proposePayment(pool(), { red: 1, generic: 1 }, { red: 2 })).toBeUndefined();
    expect(ManaPool.proposePayment(pool(), { generic: 1 }, 'bad')).toBeUndefined();
  });

  it('rejects malformed costs, pools and overflow', () => {
    expect(ManaPool.proposePayment({ ...pool(), red: -1 }, {})).toBeUndefined();
    expect(ManaPool.proposePayment(pool(), { red: -1 })).toBeUndefined();
    expect(ManaPool.proposePayment(pool(), { generic: Number.MAX_SAFE_INTEGER, red: 1 })).toBeUndefined();
  });

  it('adds, spends and drains mana', () => {
    const value = pool();
    ManaPool.add(value, 'green', 3);
    expect(value.green).toBe(3);
    ManaPool.spend(value, { green: 2, blue: 1 });
    expect(value).toMatchObject({ green: 1, blue: 1 });
    expect(ManaPool.drain(value)).toEqual({ ...pool(), green: 1, blue: 1 });
    expect(value).toEqual({ white: 0, blue: 0, green: 0, black: 0, red: 0, yellow: 0 });
  });
});

describe('material destruction costs', () => {
  function material(id: string, controllerId: string, mana?: Record<string, number | undefined>) {
    const card = instantiateCard('empire-servant');
    card.blueprint = {
      ...card.blueprint, id, name: id,
      castRequirements: { ...card.blueprint.castRequirements, cost: { mana: mana as never } },
    };
    card.state = { ...card.state, zone: 'battlefield', ownerId: controllerId, controllerId };
    return card;
  }

  it('lists eligible controlled non-indestructible materials with mana values', () => {
    const first = material('first', 'player1', { generic: 3 });
    const second = material('second', 'player1', { red: 2 });
    const enemy = material('enemy', 'player2', { generic: 3 });
    const indestructible = material('indestructible', 'player1', { generic: 3 });
    indestructible.blueprint = { ...indestructible.blueprint, keywords: ['Indestructible'] };
    const unknownValue = material('unknown', 'player1', { red: Number.NaN });
    const room = createTestRoom({ battlefield: [first, second, enemy, indestructible, unknownValue] });
    const options = materialPaymentOptions(room, 'player1', { filter: {}, manaValueGreaterThan: 0 });
    expect(options.map((option) => option.id)).toEqual([first.uuid, second.uuid]);
    expect(options.map((option) => option.weight)).toEqual([3, 2]);
    expect(canAffordMaterials(room, 'player1', { filter: {}, manaValueGreaterThan: 4 })).toBe(true);
    expect(canAffordMaterials(room, 'player1', { filter: {}, manaValueGreaterThan: 5 })).toBe(false);
  });

  it('rejects empty, oversized, stale and underpaying selections', () => {
    const first = material('first', 'player1', { generic: 3 });
    const room = createTestRoom({ battlefield: [first] });
    const cost = { filter: {}, manaValueGreaterThan: 1 };
    expect(planMaterialPayment(room, 'player1', cost, [])).toEqual({ success: false, reason: 'Choose one or more ritual materials' });
    expect(planMaterialPayment(room, 'player1', cost, [{}, {}])).toEqual({ success: false, reason: 'Choose one or more ritual materials' });
    expect(planMaterialPayment(room, 'player1', cost, [{ cardUuid: 'missing', zoneRevision: 0 }])).toEqual({ success: false, reason: 'Invalid ritual material' });
    expect(planMaterialPayment(room, 'player1', cost, [{ cardUuid: first.uuid, zoneRevision: 9 }])).toEqual({ success: false, reason: 'Invalid ritual material' });
    expect(planMaterialPayment(room, 'player1', { ...cost, manaValueGreaterThan: 3 }, [{ cardUuid: first.uuid, zoneRevision: 0 }])).toEqual({ success: false, reason: 'Material mana value must be greater than 3' });
    expect(planMaterialPayment(room, 'player1', cost, [{ cardUuid: first.uuid, zoneRevision: 0 }])).toEqual({
      success: true, mutations: [{ type: 'DESTROY_CARD', cardUuid: first.uuid, zoneRevision: 0, requiredPayment: true }],
    });
  });
});

describe('ability usage budgets', () => {
  const card = () => {
    const value = creature('source', 'player1');
    value.state.zoneRevision = 0;
    value.blueprint = { ...value.blueprint, id: 'blueprint' };
    return value;
  };

  it('builds identities for source, controller and grouped budgets', () => {
    const source = card();
    expect(abilityUsage(source, activated())).toBeUndefined();
    expect(abilityUsage(source, activated({ id: undefined as never }))).toBeUndefined();
    const usage = { period: 'turn', limit: 1, identity: 'source_card' } as never;
    expect(abilityUsage(source, activated({ usage }))).toEqual({ key: 'ability-use:source:use', period: 'turn', limit: 1 });
    const controller = { period: 'game', limit: 2, identity: 'controller' } as never;
    expect(abilityUsage(source, activated({ id: 'a1', usage: controller }))).toEqual({
      key: 'ability-use:player1:blueprint:a1', period: 'game', limit: 2,
    });
    const grouped = { period: 'turn', limit: 1, identity: 'controller', group: 'g' } as never;
    expect(abilityUsage(source, activated({ usage: grouped }))).toEqual({
      key: 'usage:player1:group:g', period: 'turn', limit: 1,
    });
    const noId = abilityUsage(source, { ...activated(), id: undefined, usage: { period: 'turn', limit: 1 } } as unknown as ActivatedAbility);
    expect(noId?.key).toBe('ability-use:source:0:');
  });

  it('rejects invalid per-turn limits and counts reserved uses', () => {
    const source = card();
    const room = createTestRoom();
    room.turnNumber = 2;
    expect(abilityUsageAvailable(room, source, activated())).toBe(true);
    expect(abilityUsageAvailable(room, source, activated({ limitPerTurn: 0 }))).toBe(false);
    expect(abilityUsageAvailable(room, source, activated({ limitPerTurn: 1.5 }))).toBe(false);
    expect(abilityUsageAvailable(room, source, activated({ limitPerTurn: 1 }))).toBe(true);
    const gameUsage = { period: 'game', limit: 1, identity: 'source_card' } as never;
    const gameAbility = activated({ id: 'g', usage: gameUsage });
    const reserved: GameMutation[] = [
      { type: 'RECORD_GAME_RULE_USE', key: 'ability-use:source:g' },
    ];
    expect(abilityUsageAvailable(room, source, gameAbility, reserved)).toBe(false);
    const turnAbility = activated({ id: 't', limitPerTurn: 1 });
    const turnReserved: GameMutation[] = [
      { type: 'RECORD_ABILITY_USE', key: 'source:0:t', turnNumber: 1 },
      { type: 'RECORD_ABILITY_USE', key: 'source:0:t', turnNumber: 2 },
    ];
    expect(abilityUsageAvailable(room, source, turnAbility, turnReserved)).toBe(false);
    expect(abilityUsageAvailable(room, source, turnAbility, [{ type: 'RECORD_ABILITY_USE', key: 'other', turnNumber: 2 }])).toBe(true);
  });

  it('records occurrence history and debits explicit budgets', () => {
    const source = card();
    const room = createTestRoom();
    const expected = { type: 'RECORD_ABILITY_USE', key: 'source:0:on-enter', turnNumber: room.turnNumber ?? 1 };
    expect(recordAbilityCommit(room, source)).toEqual([expected]);
    const usage = { period: 'turn', limit: 1, identity: 'source_card' } as never;
    expect(recordAbilityCommit(room, source, activated({ id: 'a1', usage }))).toEqual([
      { type: 'RECORD_ABILITY_USE', key: 'source:0:a1', turnNumber: room.turnNumber ?? 1 },
      { type: 'RECORD_ABILITY_USE', key: 'ability-use:source:a1', turnNumber: room.turnNumber ?? 1 },
    ]);
    expect(recordAbilityUsage(room, source, activated({ usage }))).toHaveLength(1);
  });

  it('merges reserved uses without manufacturing turn history', () => {
    const source = card();
    const room = createTestRoom();
    room.turnNumber = 3;
    room.gameRuleUses = {};
    delete room.turnHistory;
    const merged = withReservedAbilityUses(room, [
      { type: 'RECORD_ABILITY_USE', key: 'k', turnNumber: 3 },
      { type: 'RECORD_ABILITY_USE', key: 'stale', turnNumber: 2 },
      { type: 'RECORD_GAME_RULE_USE', key: 'g' },
      { type: 'SET_LIFE', playerId: 'player1', amount: 1 },
    ]);
    expect(merged.turnHistory).toBeUndefined();
    expect(merged.gameRuleUses).toEqual({ g: 1 });
    room.turnHistory = {
      turnNumber: 3, events: [], counts: {}, playerCounts: {}, uses: { k: 2 }, landPlays: {},
    };
    const withHistory = withReservedAbilityUses(room, [
      { type: 'RECORD_ABILITY_USE', key: 'k', turnNumber: 3 },
      { type: 'RECORD_GAME_RULE_USE', key: 'g' },
    ]);
    expect(withHistory.turnHistory?.uses).toEqual({ k: 3 });
    expect(withHistory.gameRuleUses).toEqual({ g: 1 });
    expect(source.uuid).toBe('source');
  });
});

describe('resolution card results', () => {
  function roomWithLibrary(cards: CardInstance[]) {
    const room = createTestRoom();
    room.players.player1.deck = cards;
    return room;
  }

  function stackObject(source: CardInstance): StackObject {
    return { uuid: 'object', type: 'triggered', source, controllerId: 'player1', effects: [], countered: false };
  }

  it('captures only attempted library discards for the exact incarnation', () => {
    const first = creature('first', 'player1');
    first.state.zone = 'library';
    first.state.zoneRevision = 2;
    const second = creature('second', 'player1');
    second.state.zone = 'library';
    second.state.zoneRevision = 0;
    const room = roomWithLibrary([first, second]);
    const produced: GameMutation[] = [
      { type: 'SET_PRIORITY', playerId: 'player1' },
      { type: 'MOVE_CARD', cardUuid: first.uuid, playerId: 'player1', from: 'hand', to: 'graveyard' },
      { type: 'MOVE_CARD', cardUuid: first.uuid, playerId: 'player1', from: 'library', to: 'graveyard' },
      { type: 'MOVE_CARD', cardUuid: 'missing', playerId: 'player1', from: 'library', to: 'graveyard', reason: 'discard' },
      { type: 'MOVE_CARD', cardUuid: first.uuid, playerId: 'player1', from: 'library', to: 'graveyard', reason: 'discard', zoneRevision: 2 },
      { type: 'MOVE_CARD', cardUuid: first.uuid, playerId: 'player1', from: 'library', to: 'graveyard', reason: 'discard', zoneRevision: 2 },
      { type: 'MOVE_CARD', cardUuid: second.uuid, playerId: 'player1', from: 'library', to: 'graveyard', reason: 'discard' },
    ];
    const result = probeCardResult(room, stackObject(first), { name: 'milled', kind: 'milled' }, produced);
    expect(result?.cards.map((entry) => entry.before.card.uuid)).toEqual([first.uuid, second.uuid]);
    expect(probeCardResult(room, stackObject(first), undefined, produced)).toBeUndefined();
    expect(probeCardResult(room, stackObject(first), { name: 'milled', kind: 'captured' }, produced)).toBeUndefined();
    expect(() => probeCardResult(
      { ...room, stack: [] },
      { ...stackObject(first), resolutionResults: { milled: { name: 'milled', kind: 'milled', cards: [] } } },
      { name: 'milled', kind: 'milled' }, [],
    )).toThrow('Duplicate resolution result');
  });

  it('records arrival snapshots and clears results at the end of resolution', () => {
    const card = creature('card', 'player1');
    card.state.zone = 'library';
    card.state.zoneRevision = 0;
    const room = roomWithLibrary([card]);
    const probe = probeCardResult(room, stackObject(card), { name: 'milled', kind: 'milled' }, [
      { type: 'MOVE_CARD', cardUuid: card.uuid, playerId: 'player1', from: 'library', to: 'graveyard', reason: 'discard', zoneRevision: 0 },
    ])!;
    expect(probe.cards[0].after).toBeUndefined();
    const settled = settleCardResult(room, stackObject(card), probe, [
      { type: 'SET_PRIORITY', playerId: 'player1' },
      { type: 'MOVE_CARD', cardUuid: 'other', playerId: 'player1', from: 'library', to: 'graveyard' },
      { type: 'MOVE_CARD', cardUuid: card.uuid, playerId: 'player1', from: 'library', to: 'graveyard', reason: 'discard', zoneRevision: 0 },
    ]);
    expect(settled.resolutionResults?.milled.cards[0].after?.card.state.zone).toBe('graveyard');
    const object = stackObject(card);
    expect(settleCardResult(room, object, undefined, [])).toBe(object);
    expect(settleCardResult(room, object, { name: 'captured', kind: 'captured', observationId: 'o', cards: [] }, [])).toEqual({
      ...object,
      resolutionResults: { captured: { name: 'captured', kind: 'captured', observationId: 'o', cards: [] } },
    });
    expect('resolutionResults' in clearCardResults(settled)).toBe(false);
  });
});

describe('scenario room setup', () => {
  const context: RuntimeContext = { uuid: (() => { let n = 0; return () => `id-${++n}`; })(), random: () => 0.5 };

  function setup(overrides: Record<string, unknown> = {}) {
    return {
      players: [
        {
          life: 13,
          library: [{ cardId: 'empire-servant', quantity: 2 }, { cardId: 'land-red', quantity: 1 }],
          libraryOrder: ['rock', 'paper', 'scissors'],
          hand: [{ cardId: 'land-red', quantity: 1 }],
          graveyard: [{ cardId: 'empire-servant', quantity: 1 }],
          battlefield: [{ cardId: 'empire-servant', quantity: 1 }],
        },
        {
          life: 7,
          library: [{ cardId: 'empire-servant', quantity: 3 }],
          hand: [],
          graveyard: [],
          battlefield: [],
        },
      ],
      openingHandSize: 1,
      firstPlayer: 1 as const,
      shuffle: 'fixed' as const,
      seed: 7,
      ...overrides,
    };
  }

  it('builds deterministic rooms with ordered, expanded and drawn cards', () => {
    const room = buildScenarioRoom('scenario', ['p1', 'p2'], setup() as never, context);
    expect(room.player2Id).toBe('p2');
    expect(room.status).toBe('playing');
    expect(room.activeTurnPlayerId).toBe('p2');
    expect(room.players.p1.life).toBe(13);
    expect(room.players.p1.deck.map((card) => card.blueprint.id)).toEqual(['scissors', 'paper']);
    expect(room.players.p1.hand.map((card) => card.blueprint.id)).toEqual(['land-red', 'rock']);
    expect(room.players.p1.graveyard.map((card) => card.blueprint.id)).toEqual(['empire-servant']);
    expect(room.players.p2.deck.filter((card) => card.state.zone === 'library')).toHaveLength(2);
    expect(room.players.p2.hand.map((card) => card.blueprint.id)).toEqual(['empire-servant']);
    expect(room.battlefield.map((card) => card.state.zone)).toEqual(['battlefield']);
    expect(scenarioRandom(1)()).toBeGreaterThanOrEqual(0);
  });

  it('supports seeded shuffles and the scorch profile', () => {
    const room = buildScenarioRoom('scenario', ['p1', 'p2'], setup({
      rulesProfile: 'scorch-v1', shuffle: 'seeded', openingHandSize: 0,
    }) as never, context);
    expect(room.setup?.scorch).toBe(true);
    expect(room.players.p1.deck).toHaveLength(3);
    expect(room.players.p1.hand).toHaveLength(1);
  });

  it('throws when an opening draw runs out of cards', () => {
    expect(() => buildScenarioRoom('scenario', ['p1', 'p2'], setup({
      players: [
        { life: 1, library: [], hand: [], graveyard: [], battlefield: [] },
        { life: 1, library: [], hand: [], graveyard: [], battlefield: [] },
      ],
      openingHandSize: 1,
    }) as never, context)).toThrow('Invalid opening draw');
  });
});

describe('room factory branches', () => {
  it('honours explicit card lists and custom setups', () => {
    const explicitCards = Array.from({ length: gameConfig.setup.openingHandSize + 1 }, () => 'empire-servant');
    const room = createRoom('explicit', 'p1', explicitCards);
    expect(room.players.p1.deck).toEqual([]);
    expect(room.setup?.playerDecks).toEqual({ p1: explicitCards });
    const custom = createRoom('custom', 'p1', undefined, { debugMode: 'off' } as never);
    expect(custom.debugMode).toBe('off');
    const withSetup = createRoom('custom', 'p1', undefined, {
      setup: { ...gameConfig.setup, startingLife: 9 }, debugMode: 'off',
    });
    expect(withSetup.players.p1.life).toBe(9);
  });

  it('seats player two with and without an explicit deck', () => {
    const room = createRoom('seating', 'p1');
    joinRoom(room, 'p2', ['empire-servant']);
    expect(room.setup?.playerDecks?.p2).toEqual(['empire-servant']);
    delete room.setup;
    joinRoom(room, 'p3', ['land-red']);
    expect(room.setup?.playerDecks?.p3).toEqual(['land-red']);
    delete room.setup;
    joinRoom(room, 'p4');
    expect(room.players.p4.life).toBe(gameConfig.setup.startingLife);
  });

  it('returns early when a second seat is missing', () => {
    const room = createRoom('empty-seat', 'p1');
    setupRPS(room);
    expect(room.status).toBe('RPS');
    expect(room.players.p1.hand).toHaveLength(0);
    dealStartingHands(room);
    expect(room.players.p1.hand).toHaveLength(0);
    expect(buildStartingCardMutations(room)).toEqual([]);
  });

  it('builds starting zones from pinned decks or the configured deck', () => {
    const room = createRoom('deal', 'p1');
    joinRoom(room, 'p2');
    room.setup = { ...room.setup!, playerDecks: { p1: ['empire-servant', 'land-red'], p2: ['rock', 'paper'] } };
    const pinned = buildStartingCardMutations(room);
    expect(pinned.map((mutation) => mutation.type)).toEqual(['SET_PLAYER_ZONES', 'SET_PLAYER_ZONES']);
    delete room.setup?.playerDecks;
    const configured = buildStartingCardMutations(room);
    expect(configured).toHaveLength(2);
    expect(room.players.p1.hand).toHaveLength(0);
  });
});

describe('damage keyword results', () => {
  it('skips permanents that left the battlefield before damage landed', () => {
    const source = creature('source', 'player1');
    const room = createTestRoom({ battlefield: [source] });
    const snapshot = captureSourceInformation(room, source);
    const results = planDamageResults(room, [
      { source: snapshot, recipient: { kind: 'permanent', cardUuid: 'gone', zoneRevision: 0 }, amount: 2, combat: true },
      { source: snapshot, recipient: { kind: 'player', playerId: 'player2' }, amount: 2, combat: true },
    ]);
    expect(results.some((mutation) => mutation.type === 'MARK_DAMAGE')).toBe(false);
    expect(results.some((mutation) => mutation.type === 'CHANGE_LIFE')).toBe(true);
  });
});

describe('combat declaration handlers', () => {
  function combatRoom() {
    const room = createTestRoom({ phase: 'declareBlockersStep' });
    const attacker = creature('attacker', 'player1', 2, 2);
    const blocker = creature('blocker', 'player2', 1, 1);
    room.battlefield = [attacker, blocker];
    room.combat = [{ uuid: attacker.uuid, attacker: structuredClone(attacker), attackerPower: 2, blockers: [] }];
    return { room, attacker, blocker };
  }

  it('rejects declarations after combat is complete or while the stack is busy', () => {
    const { room } = combatRoom();
    room.combatDeclarations = { attackers: true, blockers: true };
    expect(declareBlockersHandler.validate(room, 'player2', {})).toEqual({
      success: false, phase: 'validate', reason: 'Combat declaration is already complete or responses are pending',
    });
    room.combatDeclarations = undefined;
    room.stack.push({ uuid: 's' } as StackObject);
    expect(declareBlockersHandler.validate(room, 'player2', {}).success).toBe(false);
  });

  it('rejects a blocker controlled by the attacker', () => {
    const { room, attacker, blocker } = combatRoom();
    blocker.state.controllerId = 'player1';
    expect(declareBlockersHandler.validate(room, 'player2', {
      assignments: [{ attackerUuid: attacker.uuid, blockerUuids: [blocker.uuid] }],
    })).toEqual({ success: false, phase: 'validate', reason: `Blocker ${blocker.uuid} is not on your battlefield` });
  });

  it('accepts an omitted assignment list', () => {
    const { room } = combatRoom();
    expect(declareBlockersHandler.validate(room, 'player2', {})).toEqual({ success: true });
    expect(declareBlockersHandler.propose(room, 'player2', {}).success).toBe(true);
  });
});

describe('enter battle handler lifecycle', () => {
  it('proposes and resolves without mutations', () => {
    const room = createTestRoom();
    expect(enterBattleHandler.propose(room, 'player1', {})).toEqual({ success: true });
    expect(enterBattleHandler.resolve(room, { uuid: 's' } as StackObject)).toEqual({ success: true });
  });
});

describe('player command validation', () => {
  it('accepts every concrete target pointer shape', () => {
    const valid = [
      { targetType: 'self' },
      { targetType: 'player', playerId: 'p' },
      { targetType: 'card', cardUuid: 'c' },
      { targetType: 'permanent', cardUuid: 'c' },
      { targetType: 'spell', stackUuid: 's' },
      { targetType: 'stack', stackUuid: 's' },
      { targetType: 'zone', zone: 'hand' },
      { targetType: 'any', playerId: 'p' },
      { targetType: 'any', cardUuid: 'c' },
      { targetType: 'any', stackUuid: 's' },
      { targetType: 'self', all: false, cardTypes: ['Creature'], subTypes: ['Elf'] },
    ];
    for (const target of valid) expect(validateActionData({ targets: [target] })).toBeUndefined();
  });

  it('rejects malformed target pointers', () => {
    const invalid = [
      { targetType: 'self', all: true },
      { targetType: 'self', cardTypes: 'Creature' },
      { targetType: 'self', cardTypes: [''] },
      { targetType: 'self', subTypes: [3] },
      { targetType: 'player' },
      { targetType: 'card' },
      { targetType: 'spell' },
      { targetType: 'zone' },
      { targetType: 'any' },
      { targetType: 'unknown' },
      { all: true },
    ];
    for (const target of invalid) {
      expect(validateActionData({ targets: [target] })).toBe('targets must be an array of valid target pointers');
    }
  });

  it('rejects every malformed shared field', () => {
    expect(validateActionData(null)).toBe('Action data must be an object');
    expect(validateActionData({ payment: { red: -1 } })).toBe('payment must contain nonnegative integer mana amounts');
    expect(validateActionData({ targetGroups: 'bad' })).toBe('targetGroups must contain IDs and concrete targets');
    expect(validateActionData({ targetGroups: [{ id: '', targets: [] }] })).toBe('targetGroups must contain IDs and concrete targets');
    expect(validateActionData({ targetGroups: [{ id: 'g', targets: 'bad' }] })).toBe('targetGroups must contain IDs and concrete targets');
    expect(validateActionData({ targetGroups: [{ id: 'g', targets: [{ targetType: 'player' }] }] })).toBe('targetGroups must contain IDs and concrete targets');
    expect(validateActionData({ abilityIndex: -1 })).toBe('abilityIndex must be a nonnegative integer');
    expect(validateActionData({ abilityIndex: 1.5 })).toBe('abilityIndex must be a nonnegative integer');
    expect(validateActionData({ manaColor: 'purple' })).toBe('manaColor must name a mana color');
    expect(validateActionData({ cardUuid: ' ' })).toBe('cardUuid must be a nonempty string');
    expect(validateActionData({ stackUuid: '' })).toBe('stackUuid must be a nonempty string');
    expect(validateActionData({ targets: 'bad' })).toBe('targets must be an array of valid target pointers');
    expect(validateActionData({ manaColor: 'red', abilityIndex: 0, stackUuid: 's', cardUuid: 'c' })).toBeUndefined();
  });

  it('covers command execute fallbacks through the public command table', () => {
    const engine = {
      roomState: createTestRoom(), priorityPlayerId: 'player1',
      proposeAndStack: vi.fn(() => ({ success: true })),
      givePriorityTo: vi.fn(() => []),
      passPriority: vi.fn(() => ({ success: false })),
      handleAction: vi.fn(() => ({ success: true })),
      applyMutations: vi.fn(() => []),
      advancePhase: vi.fn(() => []),
    } as unknown as GameEngine;
    expect(playerCommands.declare_attackers.execute(engine, 'player1', { attackers: [] })).toEqual({
      success: true, mutations: [],
    });
    const result = playerCommands.enter_battle.execute(engine, 'player1', {});
    expect(result).toEqual({ success: false, phase: 'validate', reason: 'Not your priority!' });
    const rps = playerCommands.rpsPlay.execute(engine, 'player1', {});
    expect(rps).toEqual({ success: true, mutations: [] });
    expect(engine.applyMutations).toHaveBeenCalledWith([]);
  });

  it('returns handler validation failures from enter battle', () => {
    const room = createTestRoom({ status: 'RPS' });
    const engine = {
      roomState: room, priorityPlayerId: 'player1', passPriority: vi.fn(),
    } as unknown as GameEngine;
    expect(playerCommands.enter_battle.execute(engine, 'player1', {})).toEqual({
      success: false, phase: 'validate', reason: 'Cannot enter battle during Rock Paper Scissors phase!',
    });
  });
});

describe('game reducer fixture sanity', () => {
  it('moves a card with a fresh zone revision', () => {
    const card = creature('card', 'player1');
    card.state.zone = 'library';
    const room = createTestRoom();
    room.players.player1.deck = [card];
    const next = gameReducer(room, { type: 'MOVE_CARD', cardUuid: card.uuid, playerId: 'player1', from: 'library', to: 'graveyard' });
    expect(next.players.player1.graveyard[0]?.state.zone).toBe('graveyard');
    expect(createCardState(card.blueprint, 'player1', 'player1', 'hand').zone).toBe('hand');
  });
});
