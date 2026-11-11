import { describe, expect, it } from 'vitest';
import { readRulePath, safeRuleKey, validRulePath } from '@rules/rule-path';
import { validCounterRemoval } from '@rules/counter-cost-validation';
import {
  consistentObservationVisibility,
  hiddenObservation,
  observationHasAudience,
  observationLimits,
  publicObservation,
  resolveObservationAudience,
} from '@rules/observation-policy';
import type { CardInstance, CardSnapshot } from '@shared/card.types';
import type { CardObservation, ObservationVisibility } from '@shared/card-observation.types';

describe('rule path reading', () => {
  it('rejects reserved and empty keys', () => {
    expect(safeRuleKey('')).toBe(false);
    expect(safeRuleKey('__proto__')).toBe(false);
    expect(safeRuleKey('constructor')).toBe(false);
    expect(safeRuleKey('prototype')).toBe(false);
    expect(safeRuleKey('amount')).toBe(true);
  });

  it('requires every segment of a path to be a safe key', () => {
    expect(validRulePath(5)).toBe(false);
    expect(validRulePath('a.b')).toBe(true);
    expect(validRulePath('a..b')).toBe(false);
    expect(validRulePath('a.__proto__.b')).toBe(false);
    expect(readRulePath({ a: { b: 3 } }, 'a.b')).toBe(3);
  });

  it('reads only own fields and never executes inherited data', () => {
    expect(readRulePath({ a: 1 }, 'missing')).toBeUndefined();
    expect(readRulePath({ a: null }, 'a.b')).toBeUndefined();
    expect(readRulePath({ a: 1 }, 'a.b')).toBeUndefined();
    expect(readRulePath({ a: { b: 1 } }, 'a.__proto__')).toBeUndefined();
    expect(readRulePath('scalar', 'length')).toBeUndefined();
    expect(readRulePath({ a: { b: { c: 2 } } }, 'a.b.c')).toBe(2);
  });
});

describe('counter removal validation', () => {
  it('accepts source and battlefield forms', () => {
    expect(validCounterRemoval({ from: 'source', counterType: 'fade', amount: 1 })).toBe(true);
    expect(validCounterRemoval({ from: 'battlefield', counterType: 'fade', amount: 2 })).toBe(true);
    expect(validCounterRemoval({ from: 'battlefield', counterType: 'fade', amount: 2, filter: { cardTypes: ['Creature'] } })).toBe(true);
  });

  it('rejects malformed values', () => {
    expect(validCounterRemoval(undefined)).toBe(false);
    expect(validCounterRemoval([])).toBe(false);
    expect(validCounterRemoval('source')).toBe(false);
    expect(validCounterRemoval({ from: 'source', counterType: 'fade', amount: 1, extra: 1 })).toBe(false);
    expect(validCounterRemoval({ from: 'graveyard', counterType: 'fade', amount: 1 })).toBe(false);
    expect(validCounterRemoval({ from: 'source', counterType: '', amount: 1 })).toBe(false);
    expect(validCounterRemoval({ from: 'source', counterType: '__proto__', amount: 1 })).toBe(false);
    expect(validCounterRemoval({ from: 'source', counterType: 4, amount: 1 })).toBe(false);
    expect(validCounterRemoval({ from: 'source', counterType: 'fade', amount: 0 })).toBe(false);
    expect(validCounterRemoval({ from: 'source', counterType: 'fade', amount: 1.5 })).toBe(false);
    expect(validCounterRemoval({ from: 'battlefield', counterType: 'fade', amount: 1, filter: { cardTypes: 'Creature' } })).toBe(false);
  });
});

const snapshot = (uuid: string): CardSnapshot => {
  const card = { uuid } as CardInstance;
  return { card, power: 0, toughness: 0 };
};

const observation = (members: CardObservation['members'], emptyFaces: string[]): CardObservation => ({
  id: 'observation',
  ownerStackUuid: 'stack',
  resultName: 'result',
  controllerId: 'controller',
  zoneOwnerId: 'other',
  sourceInfo: snapshot('source'),
  emptyAudience: { faces: emptyFaces, count: emptyFaces, order: emptyFaces },
  members,
  turnNumber: 1,
});

describe('observation policy', () => {
  it('exposes frozen, validated limits', () => {
    expect(observationLimits).toEqual({ maxWindowCards: 64, historyLimit: 128 });
    expect(Object.isFrozen(observationLimits)).toBe(true);
  });

  it('ships hidden and public visibility presets', () => {
    expect(hiddenObservation).toEqual({ faces: [], count: [], order: [], expires: 'resolution_end' });
    expect(publicObservation).toEqual({
      faces: ['all_players'],
      count: ['all_players'],
      order: ['all_players'],
      expires: 'resolution_end',
    });
  });

  it('expands each role grant and de-duplicates overlapping roles', () => {
    const visibility: ObservationVisibility = {
      faces: ['all_players', 'controller', 'zone_owner', 'opponent'],
      count: ['all_players', 'controller'],
      order: ['all_players'],
      expires: 'resolution_end',
    };
    expect(resolveObservationAudience(visibility, 'controller', 'other', ['controller', 'other'])).toEqual({
      faces: ['controller', 'other'],
      count: ['controller', 'other'],
      order: ['controller', 'other'],
    });
    expect(resolveObservationAudience(hiddenObservation, 'controller', 'other', ['controller', 'other'])).toEqual({
      faces: [],
      count: [],
      order: [],
    });
  });

  it('refuses audiences outside the room players', () => {
    expect(() => resolveObservationAudience(publicObservation, 'stranger', 'other', ['controller', 'other'])).toThrow(
      'Observation audience must refer to room players',
    );
    expect(() => resolveObservationAudience(publicObservation, 'controller', 'stranger', ['controller', 'other'])).toThrow(
      'Observation audience must refer to room players',
    );
  });

  it('checks that higher grants imply lower ones for either possible source owner', () => {
    expect(consistentObservationVisibility(publicObservation)).toBe(true);
    expect(consistentObservationVisibility(hiddenObservation)).toBe(true);
    expect(
      consistentObservationVisibility({ faces: ['controller'], count: ['other'], order: [], expires: 'resolution_end' }),
    ).toBe(false);
    expect(
      consistentObservationVisibility({ faces: ['all_players'], count: ['all_players'], order: ['controller'], expires: 'resolution_end' }),
    ).toBe(true);
    expect(
      consistentObservationVisibility({ faces: ['other'], count: ['controller'], order: [], expires: 'resolution_end' }),
    ).toBe(false);
  });

  it('reports whether a viewer receives any observation data', () => {
    expect(observationHasAudience(observation([], ['controller']), 'controller')).toBe(true);
    expect(observationHasAudience(observation([], ['controller']), 'other')).toBe(false);

    const member = {
      snapshot: snapshot('a'),
      audience: { faces: ['other'], count: ['controller'], order: [] },
    };
    expect(observationHasAudience(observation([member], []), 'other')).toBe(true);
    expect(observationHasAudience(observation([member], []), 'controller')).toBe(true);
    expect(observationHasAudience(observation([member], []), 'stranger')).toBe(false);  });
});
