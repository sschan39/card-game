import { describe, expect, it } from 'vitest';
import {
  affectedPlayer,
  applicableReplacement,
  applyReplacement,
  builtinReplacements,
  eventCard,
  eventProhibited,
  registerReplacementOperation,
  replacementIsActive,
} from '@engine/replacement-rules';
import { captureSourceInformation } from '@engine/source-information';
import { activeRules, ruleUse } from '../../packages/engine/src/rules/runtime/active-rules';
import { staticEventReplacements } from '../../packages/engine/src/rules/runtime/event-replacements';
import { parseCardDefinition } from '@library/card-parser';
import type { GameRoom } from '@shared/game.room.types';
import type { ProposedEvent, ReplacementDefinition } from '@shared/proposed-event.types';
import type { DamageRecipient } from '@shared/damage.types';
import type { CardInstance } from '@shared/card.types';
import { createTestRoom } from '../helpers/test-room-factory';
import { creature } from '../helpers/combat-fixture';

function ruleCard(room: GameRoom, id: string, rules: Record<string, unknown>[], controllerId = 'player2', zone: CardInstance['state']['zone'] = 'battlefield'): CardInstance {
  const card = creature(id, controllerId);
  card.state.zone = zone;
  card.blueprint = parseCardDefinition({
    schemaVersion: 1,
    id,
    name: id,
    cardTypes: ['Enchantment'],
    abilities: [{ id: `${id}-static`, type: 'static', rules }],
  });
  room.battlefield = room.battlefield.filter((existing) => existing.uuid !== id);
  if (zone === 'battlefield') room.battlefield.push(card);
  return card;
}

const damageEvent = (
  room: GameRoom,
  source: CardInstance,
  recipient: { kind: 'player'; playerId: string } | { kind: 'permanent'; cardUuid: string; zoneRevision: number },
  over: Record<string, unknown> = {},
): ProposedEvent => ({
  kind: 'damage',
  assignment: { source: captureSourceInformation(room, source), recipient, amount: 3, combat: false, ...over },
}) as ProposedEvent;

const moveEvent = (cardUuid: string, from: string, to: string): ProposedEvent => ({
  kind: 'zone_transfer',
  move: { type: 'MOVE_CARD', cardUuid, playerId: 'player1', from, to },
}) as unknown as ProposedEvent;

const destroyEvent = (cardUuid: string): ProposedEvent => ({
  kind: 'destroy',
  move: { type: 'MOVE_CARD', cardUuid, playerId: 'player1', from: 'battlefield', to: 'graveyard' },
}) as unknown as ProposedEvent;

describe('staticEventReplacements', () => {
  function roomWith(rules: Record<string, unknown>[]) {
    const room = createTestRoom();
    const victim = creature('victim', 'player1', 2, 2);
    const lock = ruleCard(room, 'lock', rules);
    room.battlefield.push(victim);
    return { room, victim, lock };
  }

  const cardRule = (over: Record<string, unknown> = {}) => ({
    id: 'shield',
    family: 'event-replacements',
    events: ['damage'],
    scope: { type: 'card', filter: {} },
    operation: { type: 'prevent_damage' },
    ...over,
  });

  it('offers a card-scoped rule for the matching recipient only', () => {
    const { room, victim } = roomWith([cardRule()]);
    const source = creature('striker', 'player2');
    room.battlefield.push(source);
    const offered = staticEventReplacements(room, damageEvent(room, source, { kind: 'permanent', cardUuid: 'victim', zoneRevision: 0 }), victim, 'player1');
    expect(offered).toHaveLength(1);
    expect(offered[0]).toMatchObject({ label: 'lock: shield', operation: { type: 'prevent_damage' } });
    expect(offered[0].source).toEqual({ cardUuid: 'lock', zoneRevision: 0 });

    // No recipient and a filter mismatch both decline the rule.
    expect(staticEventReplacements(room, damageEvent(room, source, { kind: 'player', playerId: 'player1' }), undefined, 'player1')).toEqual([]);
    const filtered = roomWith([cardRule({ scope: { type: 'card', filter: { cardTypes: ['Land'] } } })]);
    expect(staticEventReplacements(filtered.room, damageEvent(filtered.room, source, { kind: 'permanent', cardUuid: 'victim', zoneRevision: 0 }), filtered.victim, 'player1')).toEqual([]);
  });

  it('skips rules that do not list the event kind or are not event replacements', () => {
    const { room, victim } = roomWith([
      cardRule({ id: 'other-kind', events: ['draw'], operation: { type: 'move_destination', to: 'exile' } }),
      {
        id: 'characteristic',
        family: 'characteristics',
        scope: {},
        operation: { type: 'TYPE', add: ['Creature'] },
      },
    ]);
    const source = creature('striker', 'player2');
    room.battlefield.push(source);
    expect(staticEventReplacements(room, damageEvent(room, source, { kind: 'permanent', cardUuid: 'victim', zoneRevision: 0 }), victim, 'player1')).toEqual([]);
  });

  it('applies a player-scoped rule only without a recipient and only for the matching player', () => {
    const scoped = roomWith([cardRule({ scope: { type: 'player', relation: 'self' } })]);
    const source = creature('striker', 'player2');
    scoped.room.battlefield.push(source);
    const playerEvent = damageEvent(scoped.room, source, { kind: 'player', playerId: 'player1' });

    // The rule belongs to player2 and only covers player2's own events.
    expect(staticEventReplacements(scoped.room, playerEvent, undefined, 'player1')).toEqual([]);
    const own = staticEventReplacements(scoped.room, playerEvent, undefined, 'player2');
    expect(own).toHaveLength(1);
    // A present recipient disqualifies a player-scoped rule.
    expect(staticEventReplacements(scoped.room, playerEvent, scoped.victim, 'player2')).toEqual([]);
  });

  it('honours the rule condition and records an available use', () => {
    const failing = roomWith([cardRule({
      scope: { type: 'player', relation: 'any' },
      condition: { op: 'eq', left: { path: 'event.eventId' }, right: 'other' },
    })]);
    const source = creature('striker', 'player2');
    failing.room.battlefield.push(source);
    const event = damageEvent(failing.room, source, { kind: 'player', playerId: 'player1' });
    expect(staticEventReplacements(failing.room, event, undefined, 'player1')).toEqual([]);

    const passing = roomWith([cardRule({
      id: 'used',
      scope: { type: 'player', relation: 'any' },
      usage: { period: 'turn', limit: 2, identity: 'source_card', consume: 'on_change' },
      condition: { op: 'eq', left: { path: 'event.eventId' }, right: 'damage' },
    })]);
    passing.room.battlefield.push(source);
    const offered = staticEventReplacements(passing.room, event, undefined, 'player1');
    expect(offered).toHaveLength(1);
    expect(offered[0].ruleUse).toMatchObject({ period: 'turn', limit: 2 });
  });

  it('reports revision zero for a rule whose source has no recorded revision', () => {
    const { room } = roomWith([cardRule({
      scope: { type: 'player', relation: 'any' },
    })]);
    const lockCard = room.battlefield.find((card) => card.uuid === 'lock')!;
    delete (lockCard.state as { zoneRevision?: number }).zoneRevision;
    const source = creature('striker', 'player2');
    room.battlefield.push(source);
    const offered = staticEventReplacements(room, damageEvent(room, source, { kind: 'player', playerId: 'player1' }), undefined, 'player1');
    expect(offered).toHaveLength(1);
    expect(offered[0].source).toEqual({ cardUuid: 'lock', zoneRevision: 0 });
  });

  it('drops a rule whose use budget is exhausted', () => {
    const { room, victim } = roomWith([cardRule({
      usage: { period: 'game', limit: 1, identity: 'source_card', consume: 'on_change' },
    })]);
    const source = creature('striker', 'player2');
    room.battlefield.push(source);
    const rule = activeRules(room).find((active) => active.definition.id === 'shield')!;
    const use = ruleUse(rule)!;
    room.gameRuleUses = { [use.key]: 1 };
    expect(staticEventReplacements(room, damageEvent(room, source, { kind: 'permanent', cardUuid: 'victim', zoneRevision: 0 }), victim, 'player1')).toEqual([]);
  });
});

describe('replacementIsActive', () => {
  const base = (over: Partial<ReplacementDefinition> = {}): ReplacementDefinition => ({
    id: 'rule',
    label: 'Rule',
    operation: { type: 'cancel_event' },
    ...over,
  });

  it('treats an unlimited permanent rule as active', () => {
    expect(replacementIsActive(createTestRoom(), base())).toBe(true);
    expect(replacementIsActive(createTestRoom(), base({ duration: 'permanent' }))).toBe(true);
  });

  it('retires exhausted, expired and sourceless rules', () => {
    const room = createTestRoom();
    expect(replacementIsActive(room, base({ uses: 0 }))).toBe(false);
    expect(replacementIsActive(room, base({ uses: 1 }))).toBe(true);
    expect(replacementIsActive(room, base({ remaining: 0 }))).toBe(false);
    expect(replacementIsActive(room, base({ remaining: 1 }))).toBe(true);
    expect(replacementIsActive({ ...room, turnNumber: 3 }, base({ expiresTurn: 2 }))).toBe(false);
    expect(replacementIsActive({ ...room, turnNumber: 2 }, base({ expiresTurn: 2 }))).toBe(true);
    // A missing turn number counts as turn one.
    const unrevisioned: GameRoom = { ...room };
    delete (unrevisioned as { turnNumber?: number }).turnNumber;
    expect(replacementIsActive(unrevisioned, base({ expiresTurn: 0 }))).toBe(false);

    expect(replacementIsActive(room, base({ duration: 'while_source' }))).toBe(false);
    expect(replacementIsActive(room, base({ duration: 'while_source', source: { cardUuid: 'absent', zoneRevision: 0 } }))).toBe(false);
    const present = creature('kept', 'player1');
    room.battlefield = [present];
    expect(replacementIsActive(room, base({ duration: 'while_source', source: { cardUuid: 'kept', zoneRevision: 0 } }))).toBe(true);
    expect(replacementIsActive(room, base({ duration: 'while_source', source: { cardUuid: 'kept', zoneRevision: 4 } }))).toBe(false);
  });

  it('retires a rule whose shared use budget is spent', () => {
    const room = createTestRoom();
    room.turnHistory = { turnNumber: 1, events: [], counts: {}, playerCounts: {}, uses: { 'budget:1': 1 } };
    expect(replacementIsActive(room, base({ ruleUse: { key: 'budget:1', period: 'turn', limit: 1 } }))).toBe(false);
    expect(replacementIsActive(room, base({ ruleUse: { key: 'budget:2', period: 'turn', limit: 1 } }))).toBe(true);
    room.gameRuleUses = { 'budget:3': 1 };
    expect(replacementIsActive(room, base({ ruleUse: { key: 'budget:3', period: 'game', limit: 1 } }))).toBe(false);
  });
});

describe('eventCard and affectedPlayer', () => {
  function fixture() {
    const room = createTestRoom();
    const board = creature('board-card', 'player1');
    const grave = creature('grave-card', 'player2');
    grave.state.zone = 'graveyard';
    room.battlefield = [board];
    room.players.player2.graveyard = [grave];
    const source = creature('source-card', 'player2');
    room.battlefield.push(source);
    return { room, board, grave, source };
  }

  it('resolves the card an event acts on', () => {
    const { room, source } = fixture();
    expect(eventCard(room, damageEvent(room, source, { kind: 'permanent', cardUuid: 'board-card', zoneRevision: 0 }))?.uuid).toBe('board-card');
    expect(eventCard(room, damageEvent(room, source, { kind: 'player', playerId: 'player1' }))).toBeUndefined();
    expect(eventCard(room, moveEvent('grave-card', 'graveyard', 'exile'))?.uuid).toBe('grave-card');
    expect(eventCard(room, moveEvent('missing', 'graveyard', 'exile'))).toBeUndefined();
    expect(eventCard(room, { kind: 'draw', playerId: 'player1' } as ProposedEvent)).toBeUndefined();
    expect(eventCard(room, { kind: 'counter_change', card: { cardUuid: 'board-card', zoneRevision: 0 }, counterType: 'x', amount: 1 } as ProposedEvent)?.uuid).toBe('board-card');
  });

  it('attributes an event to its player, controller, owner or the active player', () => {
    const { room, source } = fixture();
    expect(affectedPlayer(room, { kind: 'draw', playerId: 'player2' } as ProposedEvent)).toBe('player2');
    expect(affectedPlayer(room, damageEvent(room, source, { kind: 'player', playerId: 'player2' }))).toBe('player2');
    // A battlefield permanent is attributed to its controller.
    expect(affectedPlayer(room, damageEvent(room, source, { kind: 'permanent', cardUuid: 'board-card', zoneRevision: 0 }))).toBe('player1');
    // Anything else falls back to its owner.
    expect(affectedPlayer(room, moveEvent('grave-card', 'graveyard', 'exile'))).toBe('player2');
    // No resolvable card falls back to the active player.
    expect(affectedPlayer(room, moveEvent('missing', 'graveyard', 'exile'))).toBe('player1');
  });
});

describe('applicableReplacement matching', () => {
  function setup() {
    const room = createTestRoom();
    const board = creature('board-card', 'player1', 2, 2, ['Flying']);
    const source = creature('source-red', 'player2', 2, 2);
    room.battlefield = [board, source];
    return { room, board, source };
  }
  const rule = (over: Partial<ReplacementDefinition> = {}): ReplacementDefinition => ({
    id: 'rule',
    label: 'Rule',
    operation: { type: 'damage_scale', factor: 2 },
    ...over,
  });
  const event = (room: GameRoom, source: CardInstance) => damageEvent(room, source, { kind: 'permanent', cardUuid: 'board-card', zoneRevision: 0 });

  it('requires an active rule and a registered operation', () => {
    const { room, source } = setup();
    expect(applicableReplacement(room, event(room, source), rule({ uses: 0 }))).toBe(false);
    expect(applicableReplacement(room, event(room, source), rule({ match: { kinds: ['destroy'] } }))).toBe(false);
    expect(applicableReplacement(room, event(room, source), rule({ match: { kinds: ['damage'] } }))).toBe(true);
    expect(() => applicableReplacement(room, event(room, source), rule({ operation: { type: 'unknown' } as never }))).toThrow(
      'No handler for replacement operation: unknown',
    );
  });

  it('matches player, card identity, card type and controller', () => {
    const { room, source } = setup();
    const damage = event(room, source);
    expect(applicableReplacement(room, damage, rule({ match: { playerId: 'player2' } }))).toBe(false);
    expect(applicableReplacement(room, damage, rule({ match: { playerId: 'player1' } }))).toBe(true);
    expect(applicableReplacement(room, damage, rule({ match: { card: { cardUuid: 'missing', zoneRevision: 0 } } }))).toBe(false);
    expect(applicableReplacement(room, damage, rule({ match: { card: { cardUuid: 'board-card', zoneRevision: 4 } } }))).toBe(false);
    expect(applicableReplacement(room, damage, rule({ match: { card: { cardUuid: 'board-card', zoneRevision: 0 } } }))).toBe(true);
    expect(applicableReplacement(room, damage, rule({ match: { cardTypes: ['Land'] } }))).toBe(false);
    expect(applicableReplacement(room, damage, rule({ match: { cardTypes: ['Creature'] } }))).toBe(true);
    expect(applicableReplacement(room, damage, rule({ match: { controllerId: 'player2' } }))).toBe(false);
    expect(applicableReplacement(room, damage, rule({ match: { controllerId: 'player1' } }))).toBe(true);
    // Events without a card decline card-based matches.
    const playerDamage = damageEvent(room, source, { kind: 'player', playerId: 'player2' });
    expect(applicableReplacement(room, playerDamage, rule({ match: { card: { cardUuid: 'board-card', zoneRevision: 0 } } }))).toBe(false);
    expect(applicableReplacement(room, playerDamage, rule({ match: { cardTypes: ['Creature'] } }))).toBe(false);
    expect(applicableReplacement(room, playerDamage, rule({ match: { controllerId: 'player1' } }))).toBe(false);
  });

  it('matches damage source, combat flag and zone move endpoints', () => {
    const { room, source } = setup();
    const damage = event(room, source);
    expect(applicableReplacement(room, damage, rule({ match: { source: { cardUuid: 'source-red', zoneRevision: 0 } } }))).toBe(true);
    expect(applicableReplacement(room, damage, rule({ match: { source: { cardUuid: 'other', zoneRevision: 0 } } }))).toBe(false);
    expect(applicableReplacement(room, damage, rule({ match: { source: { cardUuid: 'source-red', zoneRevision: 9 } } }))).toBe(false);
    expect(applicableReplacement(room, damage, rule({ match: { source: { cardUuid: 'source-red', zoneRevision: 0 } } }))).toBe(true);
    const destroyed = moveEvent('board-card', 'battlefield', 'graveyard');
    expect(applicableReplacement(room, destroyed, rule({ match: { source: { cardUuid: 'source-red', zoneRevision: 0 } } }))).toBe(false);

    expect(applicableReplacement(room, damage, rule({ match: { combat: true } }))).toBe(false);
    expect(applicableReplacement(room, damage, rule({ match: { combat: false } }))).toBe(true);
    expect(applicableReplacement(room, destroyed, rule({ match: { combat: false } }))).toBe(false);

    const mover = (over: Partial<ReplacementDefinition>) => rule({ operation: { type: 'move_destination', to: 'exile' }, ...over });
    expect(applicableReplacement(room, destroyed, mover({ match: { from: 'battlefield' } }))).toBe(true);
    expect(applicableReplacement(room, destroyed, mover({ match: { from: 'hand' } }))).toBe(false);
    expect(applicableReplacement(room, damage, mover({ match: { from: 'battlefield' } }))).toBe(false);
    expect(applicableReplacement(room, destroyed, mover({ match: { to: 'graveyard' } }))).toBe(true);
    expect(applicableReplacement(room, destroyed, mover({ match: { to: 'exile' } }))).toBe(false);
    expect(applicableReplacement(room, damage, mover({ match: { to: 'graveyard' } }))).toBe(false);
  });

  it('delegates to the registered handler decision', () => {
    const { room, source } = setup();
    expect(applicableReplacement(room, event(room, source), rule({ operation: { type: 'damage_scale', factor: 1 } }))).toBe(false);
    expect(applicableReplacement(room, event(room, source), rule({ operation: { type: 'damage_scale', factor: -1 } }))).toBe(false);
    expect(applicableReplacement(room, event(room, source), rule({ operation: { type: 'damage_scale', factor: 2.5 } }))).toBe(false);
  });
});

describe('applyReplacement built-in operations', () => {
  function setup() {
    const room = createTestRoom();
    const target = creature('target', 'player1', 2, 4);
    const source = creature('attacker', 'player2', 2, 2);
    room.battlefield = [target, source];
    return { room, target, source };
  }
  const rule = (operation: ReplacementDefinition['operation'], over: Partial<ReplacementDefinition> = {}): ReplacementDefinition => ({
    id: 'rule',
    label: 'Rule',
    operation,
    ...over,
  });

  it('scales damage and passes non-damage events through untouched', () => {
    const { room, source } = setup();
    const damage = damageEvent(room, source, { kind: 'player', playerId: 'player1' }, { amount: 3 });
    const scaled = applyReplacement(room, damage, rule({ type: 'damage_scale', factor: 2 }));
    expect(scaled.events[0]).toMatchObject({ kind: 'damage', assignment: { amount: 6 } });
    expect(applyReplacement(room, moveEvent('target', 'battlefield', 'graveyard'), rule({ type: 'damage_scale', factor: 2 })).events).toHaveLength(1);
  });

  it('prevents damage up to the shield limits', () => {
    const { room, source } = setup();
    const damage = damageEvent(room, source, { kind: 'player', playerId: 'player1' }, { amount: 5 });
    expect(applyReplacement(room, damage, rule({ type: 'prevent_damage' }))).toMatchObject({ prevented: 5 });
    expect(applyReplacement(room, damage, rule({ type: 'prevent_damage', amount: 2 }))).toMatchObject({ prevented: 2 });
    expect(applyReplacement(room, damage, rule({ type: 'prevent_damage' }, { remaining: 1 }))).toMatchObject({ prevented: 1 });
    // Unpreventable damage passes through and reports nothing prevented.
    const unpreventable = damageEvent(room, source, { kind: 'player', playerId: 'player1' }, { amount: 5, preventable: false });
    expect(applyReplacement(room, unpreventable, rule({ type: 'prevent_damage' }))).toEqual({ events: [unpreventable], prevented: 0 });
    expect(applyReplacement(room, moveEvent('target', 'battlefield', 'graveyard'), rule({ type: 'prevent_damage' })).events).toHaveLength(1);
  });

  it('redirects damage and leaves other events alone', () => {
    const { room, source } = setup();
    const damage = damageEvent(room, source, { kind: 'player', playerId: 'player1' });
    const redirected = applyReplacement(room, damage, rule({ type: 'redirect_damage', recipient: { kind: 'player', playerId: 'player2' } }));
    expect(redirected.events[0]).toMatchObject({ assignment: { recipient: { kind: 'player', playerId: 'player2' } } });
    expect(applyReplacement(room, moveEvent('target', 'battlefield', 'graveyard'), rule({ type: 'redirect_damage', recipient: { kind: 'player', playerId: 'player2' } })).events).toHaveLength(1);
  });

  it('moves a zone change to the replacement destination', () => {
    const { room } = setup();
    const destroyed = moveEvent('target', 'battlefield', 'graveyard');
    const replaced = applyReplacement(room, destroyed, rule({ type: 'move_destination', to: 'exile' }));
    expect(replaced.events[0]).toMatchObject({ kind: 'zone_transfer', move: { to: 'exile' } });
    expect(applyReplacement(room, damageEvent(room, room.battlefield[1], { kind: 'player', playerId: 'player1' }), rule({ type: 'move_destination', to: 'exile' })).events).toHaveLength(1);
  });

  it('cancels the event entirely', () => {
    const { room, source } = setup();
    expect(applyReplacement(room, damageEvent(room, source, { kind: 'player', playerId: 'player1' }), rule({ type: 'cancel_event' }))).toEqual({ events: [] });
  });

  it('regenerates the destroyed card it can still find', () => {
    const { room } = setup();
    const destroyed = moveEvent('target', 'battlefield', 'graveyard');
    expect(applyReplacement(room, destroyed, rule({ type: 'regenerate' }))).toEqual({
      events: [],
      mutations: [{ type: 'REGENERATE_CARD', cardUuid: 'target', zoneRevision: 0 }],
    });
    room.battlefield = [];
    expect(applyReplacement(room, destroyed, rule({ type: 'regenerate' }))).toEqual({ events: [], mutations: [] });
  });

  it('rejects an operation without a registered handler', () => {
    const { room, source } = setup();
    expect(() => applyReplacement(room, damageEvent(room, source, { kind: 'player', playerId: 'player1' }), rule({ type: 'unknown' } as never))).toThrow(
      'No handler for replacement operation: unknown',
    );
  });
});

describe('registerReplacementOperation', () => {
  const handler = { applies: () => true, replace: () => ({ events: [] }) };
  const other = { applies: () => false, replace: () => ({ events: [] }) };

  it('refuses a duplicate registration for an operation type', () => {
    const dispose = registerReplacementOperation('custom-operation' as never, handler as never);
    expect(() => registerReplacementOperation('custom-operation' as never, other as never)).toThrow(
      'Replacement operation already registered: custom-operation',
    );
    dispose();
    // Removing restores the "no handler" state.
    expect(() => applyReplacement(createTestRoom(), damageEvent(createTestRoom(), creature('s', 'player1'), {
      kind: 'player',
      playerId: 'player1',
    }), { id: 'r', label: 'R', operation: { type: 'custom-operation' } as never })).toThrow(
      'No handler for replacement operation: custom-operation',
    );
  });

  it('does not remove a handler another registration replaced', () => {
    const disposeFirst = registerReplacementOperation('second-operation' as never, handler as never);
    disposeFirst();
    const disposeSecond = registerReplacementOperation('second-operation' as never, other as never);
    // The first disposer must not remove the second handler.
    disposeFirst();
    const room = createTestRoom();
    const source = creature('s', 'player1');
    expect(applyReplacement(room, damageEvent(room, source, { kind: 'player', playerId: 'player1' }), {
      id: 'r',
      label: 'R',
      operation: { type: 'second-operation' } as never,
    })).toEqual({ events: [] });
    disposeSecond();
  });
});

describe('registered handler applicability', () => {
  function setup() {
    const room = createTestRoom();
    const target = creature('target', 'player1', 2, 4);
    const source = creature('attacker', 'player2');
    room.battlefield = [target, source];
    return { room, target, source };
  }
  const rule = (operation: ReplacementDefinition['operation']): ReplacementDefinition => ({ id: 'rule', label: 'Rule', operation });
  const damage = (room: GameRoom, source: CardInstance, recipient: DamageRecipient, amount: number) => ({
    kind: 'damage',
    assignment: { source: captureSourceInformation(room, source), recipient, amount, combat: false },
  }) as ProposedEvent;

  it('decides whether a damage shield applies to the event', () => {
    const { room, source } = setup();
    const player = { kind: 'player', playerId: 'player1' } as const;
    expect(applicableReplacement(room, damage(room, source, player, 3), rule({ type: 'prevent_damage' }))).toBe(true);
    expect(applicableReplacement(room, damage(room, source, player, 3), rule({ type: 'prevent_damage', amount: 2 }))).toBe(true);
    expect(applicableReplacement(room, damage(room, source, player, 3), rule({ type: 'prevent_damage', amount: 0 }))).toBe(false);
    expect(applicableReplacement(room, damage(room, source, player, 3), rule({ type: 'prevent_damage', amount: 1.5 }))).toBe(false);
    expect(applicableReplacement(room, damage(room, source, player, 0), rule({ type: 'prevent_damage' }))).toBe(false);
    expect(applicableReplacement(room, moveEvent('target', 'battlefield', 'graveyard'), rule({ type: 'prevent_damage' }))).toBe(false);
  });

  it('decides whether a redirect applies to the event', () => {
    const { room, source } = setup();
    const player = { kind: 'player', playerId: 'player1' } as const;
    expect(applicableReplacement(room, damage(room, source, player, 3), rule({ type: 'redirect_damage', recipient: { kind: 'player', playerId: 'player2' } }))).toBe(true);
    expect(applicableReplacement(room, damage(room, source, player, 3), rule({ type: 'redirect_damage', recipient: { kind: 'player', playerId: 'player1' } }))).toBe(false);
    expect(applicableReplacement(room, damage(room, source, player, 3), rule({ type: 'redirect_damage', recipient: { kind: 'player', playerId: 'ghost' } }))).toBe(false);
    expect(applicableReplacement(room, damage(room, source, player, 3), rule({ type: 'redirect_damage', recipient: { kind: 'permanent', cardUuid: 'target', zoneRevision: 0 } }))).toBe(true);
    expect(applicableReplacement(room, damage(room, source, player, 3), rule({ type: 'redirect_damage', recipient: { kind: 'permanent', cardUuid: 'target', zoneRevision: 7 } }))).toBe(false);
    expect(applicableReplacement(room, damage(room, source, player, 3), rule({ type: 'redirect_damage', recipient: { kind: 'permanent', cardUuid: 'gone', zoneRevision: 0 } }))).toBe(false);
    expect(applicableReplacement(room, damage(room, source, player, 0), rule({ type: 'redirect_damage', recipient: { kind: 'player', playerId: 'player2' } }))).toBe(false);
    expect(applicableReplacement(room, moveEvent('target', 'battlefield', 'graveyard'), rule({ type: 'redirect_damage', recipient: { kind: 'player', playerId: 'player2' } }))).toBe(false);
  });

  it('decides whether an event is cancelled or regenerated', () => {
    const { room, source } = setup();
    const player = { kind: 'player', playerId: 'player1' } as const;
    expect(applicableReplacement(room, damage(room, source, player, 3), rule({ type: 'cancel_event' }))).toBe(true);
    expect(applicableReplacement(room, destroyEvent('target'), rule({ type: 'regenerate' }))).toBe(true);
    expect(applicableReplacement(room, damage(room, source, player, 3), rule({ type: 'regenerate' }))).toBe(false);
    expect(applicableReplacement(room, moveEvent('target', 'battlefield', 'graveyard'), rule({ type: 'move_destination', to: 'exile' }))).toBe(true);
    expect(applicableReplacement(room, moveEvent('target', 'battlefield', 'exile'), rule({ type: 'move_destination', to: 'exile' }))).toBe(false);
  });
});

describe('rules without recorded zone revisions', () => {
  function bare(card: CardInstance): CardInstance {
    delete (card.state as { zoneRevision?: number }).zoneRevision;
    return card;
  }

  it('treats a missing incarnation as revision zero everywhere it is compared', () => {
    const room = createTestRoom();
    const kept = bare(creature('kept', 'player1', 2, 4, ['Protection from red']));
    const source = bare(creature('striker', 'player2'));
    source.blueprint = { ...source.blueprint, colors: ['red'] };
    room.battlefield = [kept, source];

    expect(replacementIsActive(room, {
      id: 'while',
      label: 'While',
      operation: { type: 'cancel_event' },
      duration: 'while_source',
      source: { cardUuid: 'kept', zoneRevision: 0 },
    })).toBe(true);

    const damage = damageEvent(room, source, { kind: 'permanent', cardUuid: 'kept', zoneRevision: 0 });
    expect(applicableReplacement(room, damage, {
      id: 'rule',
      label: 'Rule',
      operation: { type: 'damage_scale', factor: 2 },
      match: { card: { cardUuid: 'kept', zoneRevision: 0 } },
    })).toBe(true);
    expect(applicableReplacement(room, damage, {
      id: 'rule',
      label: 'Rule',
      operation: { type: 'damage_scale', factor: 2 },
      match: { source: { cardUuid: 'striker', zoneRevision: 0 } },
    })).toBe(true);
    expect(applicableReplacement(room, damage, {
      id: 'rule',
      label: 'Rule',
      operation: { type: 'redirect_damage', recipient: { kind: 'permanent', cardUuid: 'striker', zoneRevision: 0 } },
    })).toBe(true);

    // Regeneration and protection also report revision zero for such a card.
    expect(applyReplacement(room, destroyEvent('kept'), {
      id: 'rule',
      label: 'Rule',
      operation: { type: 'regenerate' },
    })).toEqual({ events: [], mutations: [{ type: 'REGENERATE_CARD', cardUuid: 'kept', zoneRevision: 0 }] });
    expect(builtinReplacements(room, damage).some((definition) => definition.id === 'protection:kept:0')).toBe(true);

    // A source rule keeps its own revision when the source has one.
    expect(staticEventReplacements(room, damage, kept, 'player1')).toEqual([]);
  });
});

describe('builtinReplacements and eventProhibited', () => {
  it('adds a protection shield for protected permanents only', () => {
    const room = createTestRoom();
    const protectedCard = creature('protected', 'player1', 2, 2, ['Protection from red']);
    const source = creature('red-source', 'player2');
    source.blueprint = { ...source.blueprint, colors: ['red'] };
    room.battlefield = [protectedCard, source];

    const shielded = builtinReplacements(room, damageEvent(room, source, { kind: 'permanent', cardUuid: 'protected', zoneRevision: 0 }));
    expect(shielded.some((definition) => definition.label === 'Protection')).toBe(true);

    const plain = creature('plain', 'player1', 2, 2);
    room.battlefield = [plain, source];
    expect(builtinReplacements(room, damageEvent(room, source, { kind: 'permanent', cardUuid: 'plain', zoneRevision: 0 }))).toEqual([]);

    // A recipient that no longer exists yields no protection entry.
    expect(builtinReplacements(room, damageEvent(room, source, { kind: 'permanent', cardUuid: 'gone', zoneRevision: 0 }))).toEqual([]);
    // Non-permanent damage never consults protection.
    expect(builtinReplacements(room, damageEvent(room, source, { kind: 'player', playerId: 'player1' }))).toEqual([]);
    expect(builtinReplacements(room, moveEvent('plain', 'battlefield', 'graveyard'))).toEqual([]);
  });

  it('prohibits destroying an indestructible permanent', () => {
    const room = createTestRoom();
    room.battlefield = [creature('tough', 'player1', 2, 2, ['Indestructible']), creature('soft', 'player1', 2, 2)];
    expect(eventProhibited(room, destroyEvent('tough'))).toBe(true);
    expect(eventProhibited(room, destroyEvent('soft'))).toBe(false);
    expect(eventProhibited(room, destroyEvent('missing'))).toBe(false);
    expect(eventProhibited(room, damageEvent(room, room.battlefield[0], { kind: 'player', playerId: 'player1' }))).toBe(false);
  });
});
