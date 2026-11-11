import { describe, expect, it } from 'vitest';
import {
  abilityAnnouncementDefinition,
  materializeAnnouncementCost,
  prepareAnnouncement,
  spellAnnouncementDefinition,
} from '@engine/announcement-values';
import { parseCardDefinition } from '@library/card-parser';
import type { CardBlueprint } from '@shared/card.types';
import { createTestRoom } from '../helpers/test-room-factory';
import { creature } from '../helpers/combat-fixture';

const source = () => {
  const card = creature('ann-source', 'player1');
  card.state.zone = 'hand';
  return card;
};
const definition = (over: Record<string, unknown> = {}) => ({ effects: [], ...over }) as never;
const draw = { action: 'DRAW', params: { amount: 1 } };

describe('materializeAnnouncementCost', () => {
  it('returns the fixed fields when no mana is authored', () => {
    expect(materializeAnnouncementCost()).toEqual({});
    expect(materializeAnnouncementCost({ life: 2 })).toEqual({ life: 2 });
  });

  it('copies authored colours and only evaluates an authored generic amount', () => {
    expect(materializeAnnouncementCost({ mana: { red: 1 } })).toEqual({ mana: { red: 1 } });
    expect(materializeAnnouncementCost({ mana: { red: 1, generic: 2 } })).toEqual({ mana: { red: 1, generic: 2 } });
    expect(materializeAnnouncementCost({ mana: { generic: { numeric: { kind: 'binding', name: 'X' } } } }, { X: 3 })).toEqual({
      mana: { generic: 3 },
    });
  });

  it('rejects a generic requirement that is not a non-negative safe integer', () => {
    expect(() => materializeAnnouncementCost({ mana: { generic: -1 } })).toThrow('Invalid generic mana requirement');
    expect(() => materializeAnnouncementCost({ mana: { generic: 1.5 } })).toThrow('Invalid generic mana requirement');
    expect(() => materializeAnnouncementCost({ mana: { generic: Number.NaN } })).toThrow('Invalid generic mana requirement');
    expect(() =>
      materializeAnnouncementCost({ mana: { generic: { numeric: { kind: 'binding', name: 'X' } } } }),
    ).toThrow('Invalid generic mana requirement');
  });
});

describe('announcement definitions', () => {
  const blueprint = parseCardDefinition({
    schemaVersion: 1,
    id: 'ann-spell',
    name: 'Announcement Spell',
    cardTypes: ['Spell'],
    manaCost: '{1}{R}',
    numericDeclarations: [{ name: 'X', min: 0, max: 3 }],
    onCastEffects: [draw],
    modes: [{ id: 'm1', effects: [draw] }],
    modeCount: { min: 1, max: 1 },
  });

  it('projects a spell blueprint and an activated ability onto the same announcement contract', () => {
    const spell = spellAnnouncementDefinition(blueprint);
    expect(spell.numericDeclarations).toEqual([{ name: 'X', min: 0, max: 3 }]);
    expect(spell.effects).toHaveLength(1);
    expect(spell.modes).toHaveLength(1);
    expect(spell.modeCount).toEqual({ min: 1, max: 1 });

    const activated = parseCardDefinition({
      schemaVersion: 1,
      id: 'ann-ability',
      name: 'Announcement Ability',
      cardTypes: ['Artifact'],
      abilities: [{
        id: 'tap-draw',
        type: 'activated',
        cost: { tap: true },
        numericDeclarations: [{ name: 'Y', min: 1 }],
        effects: [draw],
      }],
    }).abilities[0];
    const ability = abilityAnnouncementDefinition(activated as never);
    expect(ability).toMatchObject({ abilityId: 'tap-draw', cost: { tap: true }, effects: [draw] });
    expect(ability.numericDeclarations).toEqual([{ name: 'Y', min: 1 }]);
  });

  it('carries cost routes and additional costs through both projections', () => {
    const routes: CardBlueprint = {
      ...blueprint,
      castRequirements: {
        ...blueprint.castRequirements,
        additionalCost: { life: 1 },
        alternativeCosts: [{ id: 'alt', label: 'Alternative', cost: { mana: { blue: 2 } } }],
      },
    };
    expect(spellAnnouncementDefinition(routes)).toMatchObject({
      additionalCost: { life: 1 },
      alternativeCosts: [{ id: 'alt' }],
    });
    // A card without cast effects announces an empty effect list.
    const bare = { ...blueprint } as Partial<CardBlueprint>;
    delete bare.onCastEffects;
    expect(spellAnnouncementDefinition(bare as CardBlueprint).effects).toEqual([]);
  });
});

describe('prepareAnnouncement', () => {
  it('accepts an announcement with no choices and materializes an empty cost', () => {
    const result = prepareAnnouncement(source(), definition(), {});
    expect(result).toMatchObject({ success: true, bindings: {}, missing: undefined, missingCostRoute: false });
    expect(result.success && result.cost).toEqual({});
    expect(result.success && result.snapshot.source).toMatchObject({ uuid: 'ann-source', zone: 'hand', zoneRevision: 0 });

    // A source without a recorded revision announces revision zero.
    const unrevisioned = source();
    delete (unrevisioned.state as { zoneRevision?: number }).zoneRevision;
    const bare = prepareAnnouncement(unrevisioned, definition(), {});
    expect(bare.success && bare.snapshot.source.zoneRevision).toBe(0);
  });

  it('omits the cost-rule signature when no rule applies to the source', () => {
    const room = createTestRoom();
    const card = source();
    room.players.player1.hand = [card];
    const untaxed = prepareAnnouncement(card, definition(), {}, { room, playerId: 'player1' });
    expect(untaxed).toMatchObject({ success: true });
    expect(untaxed.success && untaxed.snapshot.costRules).toBeUndefined();
  });

  it('rejects definitions whose numeric declarations, costs, routes or effects are invalid', () => {
    const card = source();
    expect(prepareAnnouncement(card, definition({ numericDeclarations: [{ name: '', min: 0 }] }), {})).toEqual({
      success: false,
      reason: 'Invalid numeric declaration',
    });
    expect(prepareAnnouncement(card, definition({
      cost: { mana: { generic: { numeric: { kind: 'binding', name: 'Unowned' } } } },
    }), {})).toEqual({ success: false, reason: 'Numeric binding has no retained owner in this definition' });
    expect(prepareAnnouncement(card, definition({
      alternativeCosts: [
        { id: 'same', label: 'First', cost: {} },
        { id: 'same', label: 'Second', cost: {} },
      ],
    }), {})).toEqual({ success: false, reason: 'Invalid alternative cost route' });
    expect(prepareAnnouncement(card, definition({
      effects: [{ action: 'DRAW', params: { amount: { numeric: { kind: 'binding', name: 'Unowned' } } } }],
    }), {})).toEqual({ success: false, reason: 'Numeric binding has no retained owner in this definition' });
    expect(prepareAnnouncement(card, definition({
      modes: [{ id: 'm', effects: [{ action: 'DRAW', params: { amount: { numeric: { kind: 'binding', name: 'Unowned' } } } }] }],
    }), {})).toEqual({ success: false, reason: 'Numeric binding has no retained owner in this definition' });
  });

  it('reports a non-Error rejection through the generic reason', () => {
    const effects: unknown[] = [];
    (effects as unknown as { forEach: () => void }).forEach = () => {
      throw 'not an error';
    };
    expect(prepareAnnouncement(source(), definition({ effects }), {})).toEqual({
      success: false,
      reason: 'Invalid announcement',
    });
  });

  it('requires the client announcement to describe the same source and definition', () => {
    const card = source();
    const decl = [{ name: 'X', min: 0 }];
    const def = definition({ numericDeclarations: decl });
    const matching = { source: { uuid: 'ann-source', zone: 'hand', zoneRevision: 0 }, definition: { numericDeclarations: [{ name: 'X', min: 0 }], effects: [] } };
    expect(prepareAnnouncement(card, def, { announcement: matching })).toMatchObject({ success: true });

    // A different array length, a different key set and a plain value all diverge.
    const longer = { ...matching, definition: { numericDeclarations: [{ name: 'X', min: 0 }, { name: 'Y', min: 0 }], effects: [] } };
    expect(prepareAnnouncement(card, def, { announcement: longer })).toEqual({
      success: false,
      reason: 'Announcement source or definition changed; cancel and restart',
    });
    const renamed = { ...matching, definition: { numericDeclarations: [{ name: 'X', min: 0 }], bogus: [] } };
    expect(prepareAnnouncement(card, def, { announcement: renamed })).toEqual({
      success: false,
      reason: 'Announcement source or definition changed; cancel and restart',
    });
    const arrayShape = { ...matching, definition: [] };
    expect(prepareAnnouncement(card, def, { announcement: arrayShape })).toEqual({
      success: false,
      reason: 'Announcement source or definition changed; cancel and restart',
    });
    expect(prepareAnnouncement(card, def, { announcement: 'nope' })).toEqual({
      success: false,
      reason: 'Announcement source or definition changed; cancel and restart',
    });
    expect(prepareAnnouncement(card, def, { announcement: null })).toEqual({
      success: false,
      reason: 'Announcement source or definition changed; cancel and restart',
    });
  });

  it('validates every supplied numeric binding', () => {
    const card = source();
    const def = definition({ numericDeclarations: [{ name: 'X', min: 1, max: 2 }, { name: 'Y', min: 0 }] });
    expect(prepareAnnouncement(card, def, { numericBindings: { X: 1, Y: 2 } })).toMatchObject({ success: true, missing: undefined });
    expect(prepareAnnouncement(card, def, { numericBindings: { X: 1 } })).toMatchObject({ success: true, missing: { name: 'Y' } });
    expect(prepareAnnouncement(card, def, { numericBindings: [] as never })).toEqual({
      success: false,
      reason: 'Invalid numeric binding record',
    });
    for (const bindings of [{ X: 0 }, { X: 3 }, { X: '1' }, { X: 1.5 }, { Unknown: 1 }]) {
      expect(prepareAnnouncement(card, def, { numericBindings: bindings as never })).toEqual({
        success: false,
        reason: 'Invalid announced numeric binding',
      });
    }
    // A missing upper bound accepts any non-negative integer.
    expect(prepareAnnouncement(card, definition({ numericDeclarations: [{ name: 'Z', min: 0 }] }), {
      numericBindings: { Z: 99 },
    })).toMatchObject({ success: true });
  });

  it('resolves the selected cost route', () => {
    const routesDefinition = definition({
      cost: { mana: { red: 1 } },
      alternativeCosts: [{ id: 'free', label: 'Free', cost: { life: 2 } }],
      additionalCost: { life: 1 },
    });
    const card = source();

    // No route yet: the caller must ask which route to pay.
    const undecided = prepareAnnouncement(card, routesDefinition, {});
    expect(undecided).toMatchObject({ success: true, missingCostRoute: true, cost: undefined });

    expect(prepareAnnouncement(card, routesDefinition, { costRoute: { kind: 'base' } })).toMatchObject({
      success: true,
      cost: { mana: { red: 1 }, life: 1 },
    });
    expect(prepareAnnouncement(card, routesDefinition, { costRoute: { kind: 'alternative', id: 'free' } })).toMatchObject({
      success: true,
      cost: { life: 3 },
    });

    for (const costRoute of ['nope', { kind: 'other' }, { kind: 'base', id: 'x' }]) {
      expect(prepareAnnouncement(card, routesDefinition, { costRoute: costRoute as never })).toEqual({
        success: false,
        reason: 'Invalid cost route selection',
      });
    }
    expect(prepareAnnouncement(card, routesDefinition, {
      costRoute: { kind: 'alternative', id: 'missing' } as never,
    })).toEqual({ success: false, reason: 'Unknown alternative cost route' });
    expect(prepareAnnouncement(card, routesDefinition, {
      costRoute: { kind: 'alternative' } as never,
    })).toEqual({ success: false, reason: 'Unknown alternative cost route' });
  });

  it('composes an additional cost even without a rule context', () => {
    expect(prepareAnnouncement(source(), definition({
      cost: { mana: { green: 1 } },
      additionalCost: { life: 2 },
    }), {})).toMatchObject({ success: true, cost: { mana: { green: 1 }, life: 2 } });
    expect(prepareAnnouncement(source(), definition({
      cost: {},
      alternativeCosts: [{ id: 'alt', label: 'Alt', cost: {} }],
    }), { costRoute: { kind: 'alternative', id: 'alt' } })).toMatchObject({ success: true });
  });

  it('records the signature of an active cost rule and applies it', () => {
    const room = createTestRoom();
    const tax = creature('tax-enchantment', 'player2');
    tax.blueprint = parseCardDefinition({
      schemaVersion: 1,
      id: 'tax-enchantment',
      name: 'Tax',
      cardTypes: ['Enchantment'],
      abilities: [{
        id: 'tax',
        type: 'static',
        rules: [{
          id: 'raise',
          family: 'costs',
          action: 'cast',
          scope: {},
          operation: { type: 'mana.increase', color: 'generic', amount: 1 },
        }],
      }],
    });
    room.battlefield = [tax];
    const card = source();
    card.state.zone = 'hand';
    room.players.player1.hand = [card];

    const taxed = prepareAnnouncement(
      card,
      definition({ cost: { mana: { red: 1 } } }),
      {},
      { room, playerId: 'player1' },
    );
    expect(taxed).toMatchObject({ success: true, cost: { mana: { red: 1, generic: 1 } } });
    expect(taxed.success && taxed.snapshot.costRules).toHaveLength(1);
  });

  it('reports the consumed rule uses when the cost rule is limited', () => {
    const room = createTestRoom();
    const tax = creature('usage-tax', 'player2');
    tax.blueprint = parseCardDefinition({
      schemaVersion: 1,
      id: 'usage-tax',
      name: 'Usage tax',
      cardTypes: ['Enchantment'],
      abilities: [{
        id: 'tax',
        type: 'static',
        rules: [{
          id: 'raise',
          family: 'costs',
          action: 'cast',
          scope: {},
          usage: { period: 'turn', limit: 1, identity: 'source_card', consume: 'on_commit' },
          operation: { type: 'mana.increase', color: 'generic', amount: 1 },
        }],
      }],
    });
    room.battlefield = [tax];
    const card = source();
    room.players.player1.hand = [card];
    const result = prepareAnnouncement(card, definition({ cost: { mana: { red: 1 } } }), {}, { room, playerId: 'player1' });
    expect(result).toMatchObject({ success: true });
    expect(result.success && result.ruleUses).toHaveLength(1);
  });
});
