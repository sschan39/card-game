import { describe, expect, it } from 'vitest';
import { hasLegalNonPassAction, allocations } from '@engine/legal-actions';
import { parseCardDefinition } from '@library/card-parser';
import { newTurnHistory } from '@engine/turn-history';
import { createTestRoom, fillTestLibraries } from '../helpers/test-room-factory';
import { creature } from '../helpers/combat-fixture';
import type { GameRoom } from '@shared/game.room.types';
import type { CardAbility } from '@shared/card.types';

const gain = { action: 'MODIFY_LIFE', params: { amount: 1 } };
const enemy = { type: 'permanent', controller: 'opponent', cardTypes: ['Creature'], required: true };

function room(): GameRoom {
  const state = createTestRoom({ phase: 'stateMainPhase', priorityPlayerId: 'player1', activeTurnPlayerId: 'player1' });
  fillTestLibraries(state);
  state.players.player1.hand = [];
  state.battlefield = [];
  state.turnHistory = newTurnHistory(state.turnNumber ?? 1);
  state.players.player1.mana = { white: 0, blue: 0, black: 0, red: 0, green: 0, yellow: 0 };
  return state;
}

let nextCard = 0;
function card(state: GameRoom, extra: Record<string, unknown> = {}, zone: 'hand' | 'battlefield' = 'hand') {
  const source = creature('source-' + nextCard++, 'player1');
  source.blueprint = parseCardDefinition({ schemaVersion: 1, id: source.uuid, cardTypes: ['Spell'], onCastEffects: [gain], ...extra });
  source.state.zone = zone;
  if (zone === 'hand') state.players.player1.hand.push(source); else state.battlefield.push(source);
  return source;
}

describe('legal action search limits', () => {
  it('bounds ordered mode enumeration at the node budget and the depth cap', () => {
    const shallow = room();
    card(shallow, { modes: [{ id: 'only', label: 'Only', effects: [gain] }], modeCount: { min: 1, max: 1 } });
    expect(hasLegalNonPassAction(shallow, 'player1', { maxNodes: 1 })).toEqual({ kind: 'unknown', reason: 'search_limit' });

    const mid = room();
    card(mid, { modes: [{ id: 'only', label: 'Only', effects: [gain] }], modeCount: { min: 1, max: 1 } });
    expect(hasLegalNonPassAction(mid, 'player1', { maxNodes: 2 })).toEqual({ kind: 'unknown', reason: 'search_limit' });

    const deep = room();
    const modes = Array.from({ length: 33 }, (_, index) => ({ id: 'm' + index, label: 'M' + index, effects: [gain] }));
    card(deep, { onCastEffects: [], modes, modeCount: { min: 33, max: 33 } });
    expect(hasLegalNonPassAction(deep, 'player1')).toEqual({ kind: 'unknown', reason: 'search_limit' });
  });

  it('bounds distribution enumeration at the node budget and the option cap', () => {
    const shallow = room();
    card(shallow, { onCastEffects: [{ action: 'DEAL_DAMAGE', params: { amount: 1 }, targeting: enemy, choice: { kind: 'distribution', total: 1 } }] });
    shallow.battlefield.push(creature('enemy', 'player2'));
    expect(hasLegalNonPassAction(shallow, 'player1', { maxNodes: 1 })).toEqual({ kind: 'unknown', reason: 'search_limit' });

    const mid = room();
    card(mid, { onCastEffects: [{ action: 'DEAL_DAMAGE', params: { amount: 1 }, targeting: enemy, choice: { kind: 'distribution', total: 1 } }] });
    mid.battlefield.push(creature('enemy', 'player2'));
    expect(hasLegalNonPassAction(mid, 'player1', { maxNodes: 2 })).toEqual({ kind: 'unknown', reason: 'search_limit' });
  });

  it('defaults absent allocation totals and minimums to zero', () => {
    const missing = {
      kind: 'distribution', id: 'missing', playerId: 'player1', prompt: '',
      options: [{ id: 'a', label: 'a', value: 1 }],
      min: 0, max: 1,
      continuation: { type: 'resolution', resolutionId: 'r', effectId: 'e', field: 'distributions' },
    } as unknown as Parameters<typeof allocations>[0];
    expect([...allocations(missing, { remaining: 10 })]).toEqual([{ a: 0 }]);
  });

  it('bounds counter allocation payments at the 32-option cap across many holders', () => {
    const state = room();
    const source = card(state, {
      cardTypes: ['Creature'], power: 1, toughness: 2,
      abilities: [{
        id: 'spend', type: 'activated', effect: gain,
        cost: { removeCounters: [{ from: 'battlefield', counterType: '+1/+1', amount: 1 }] },
      }],
    }, 'battlefield');
    source.state.counters['+1/+1'] = 2;
    for (let index = 0; index < 33; index++) {
      const holder = creature('holder-' + index, 'player1');
      holder.state.counters['+1/+1'] = 1;
      state.battlefield.push(holder);
    }
    expect(hasLegalNonPassAction(state, 'player1')).toEqual({ kind: 'unknown', reason: 'search_limit' });
    expect(hasLegalNonPassAction(state, 'player1', { maxNodes: 1000 }).kind).toBe('unknown');
  });

  it('rejects impossible allocation answers instead of yielding them', () => {
    const counters = room();
    const source = card(counters, {
      cardTypes: ['Creature'], power: 1, toughness: 2,
      abilities: [{
        id: 'drain', type: 'activated', effect: gain,
        cost: { removeCounters: [{ from: 'battlefield', counterType: '+1/+1', amount: 2 }] },
      }],
    }, 'battlefield');
    source.state.counters['+1/+1'] = 1;
    expect(hasLegalNonPassAction(counters, 'player1').kind).not.toBe('available');
  });

  it('walks empty distribution prompts and their node budgets', () => {
    const state = room();
    const spell = card(state, { onCastEffects: [] });
    spell.blueprint = {
      ...spell.blueprint,
      onCastEffects: [{
        action: 'DEAL_DAMAGE', params: { amount: 1 },
        targeting: { type: 'permanent', controller: 'opponent', required: false, minTargets: 0, maxTargets: 0 },
        choice: { kind: 'distribution' },
      }],
    } as never;
    expect(hasLegalNonPassAction(state, 'player1').kind).toBeDefined();
    expect(hasLegalNonPassAction(state, 'player1', { maxNodes: 3 }).kind).toBeDefined();
  });

  it('supports distributions without a total and with limited counter payment options', () => {
    const free = room();
    const freeCard = card(free, { onCastEffects: [] });
    freeCard.blueprint = {
      ...freeCard.blueprint,
      onCastEffects: [{ action: 'DEAL_DAMAGE', params: { amount: 0 }, targeting: enemy, choice: { kind: 'distribution' } }],
    } as never;
    free.battlefield.push(creature('enemy', 'player2'));
    expect(hasLegalNonPassAction(free, 'player1').kind).not.toBe('unknown');

    const counters = room();
    const source = card(counters, {
      cardTypes: ['Creature'], power: 1, toughness: 2,
      abilities: [{
        id: 'spend', type: 'activated', effect: gain,
        cost: { removeCounters: [{ from: 'battlefield', counterType: '+1/+1', amount: 1 }] },
      }],
    }, 'battlefield');
    source.state.counters['+1/+1'] = 2;
    expect(hasLegalNonPassAction(counters, 'player1').kind).toBe('available');
    expect(hasLegalNonPassAction(counters, 'player1', { maxNodes: 1 })).toEqual({ kind: 'unknown', reason: 'search_limit' });
    expect(hasLegalNonPassAction(counters, 'player1', { maxNodes: 2 })).toEqual({ kind: 'unknown', reason: 'search_limit' });
  });

  it('bounds numeric ranges by the node budget', () => {
    const state = room();
    card(state, { manaCost: '{X}', numericDeclarations: [{ name: 'X', min: 0, max: 2 }] });
    expect(hasLegalNonPassAction(state, 'player1', { maxNodes: 1 })).toEqual({ kind: 'unknown', reason: 'search_limit' });
  });

  it('guards deep continuation chains and unsupported continuations', () => {
    const state = room();
    const effects = Array.from({ length: 33 }, (_, index) => ({
      action: 'DEAL_DAMAGE', params: { amount: 1 }, targetGroup: 'group-' + index,
      targeting: enemy,
    }));
    card(state, { onCastEffects: effects });
    for (let index = 0; index < 33; index++) state.battlefield.push(creature('target-' + index, 'player2'));
    expect(hasLegalNonPassAction(state, 'player1')).toEqual({ kind: 'unknown', reason: 'search_limit' });
  });

  it('skips malformed mana output, missing seats, revision-less lands and default activation zones', () => {
    const malformed = room();
    const malformedCard = card(malformed, { cardTypes: ['Creature'], abilities: [] }, 'battlefield');
    malformedCard.blueprint = {
      ...malformedCard.blueprint,
      abilities: [{
        id: 'bad-mana', type: 'activated', cost: { tap: true },
        effect: { action: 'ADD_MANA', params: { color: 'purple', amount: 1 }, tags: [], targeting: { type: 'self', required: false } },
      }],
    } as never;
    expect(hasLegalNonPassAction(malformed, 'player1')).toEqual({ kind: 'none' });

    const missingSeat = room();
    delete (missingSeat.players as Partial<GameRoom['players']>).player2;
    missingSeat.priorityPlayerId = 'player2';
    expect(hasLegalNonPassAction(missingSeat, 'player2')).toEqual({ kind: 'unknown', reason: 'not_ready' });

    const land = room();
    const landCard = card(land, { cardTypes: ['Land'], onCastEffects: [] });
    landCard.state.zoneRevision = undefined;
    expect(hasLegalNonPassAction(land, 'player1').kind).toBe('available');

    const zones = room();
    const zoned = card(zones, { manaCost: '{9}' });
    zoned.blueprint = {
      ...zoned.blueprint,
      abilities: [{ id: 'hand', type: 'activated', effect: gain }] as unknown as CardAbility[],
    };
    expect(hasLegalNonPassAction(zones, 'player1')).toEqual({ kind: 'none' });
  });
});
