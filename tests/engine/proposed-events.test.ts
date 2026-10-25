import { describe, expect, it } from 'vitest';
import { createTestRoom } from '../helpers/test-room-factory';
import { creature } from '../helpers/combat-fixture';
import { captureSourceInformation } from '@engine/source-information';
import { gameReducer } from '@engine/game-reducer';
import { GameEngine } from '@engine/game-engine';
import { planProposedMutations, resumeProposedChoice } from '@engine/proposed-events';
import { registerReplacementOperation } from '@engine/replacement-rules';
import type { GameRoom } from '@shared/game.room.types';
import type { GameMutation } from '@shared/game-mutation.types';
import type { ReplacementDefinition } from '@shared/proposed-event.types';

declare module '@shared/proposed-event.types' {
  interface ReplacementOperationMap { test_split: { type: 'test_split' }; test_gain_damage: { type: 'test_gain_damage' }; test_nested_gain: { type: 'test_nested_gain'; increase: boolean } }
}

function fixture(rules: ReplacementDefinition[]): GameRoom {
  return createTestRoom({ battlefield: [creature('source', 'player1')], replacementEffects: rules });
}
const double: ReplacementDefinition = { id: 'double', label: 'Double damage', match: { kinds: ['damage'] }, operation: { type: 'damage_scale', factor: 2 } };
const prevent: ReplacementDefinition = { id: 'prevent', label: 'Prevent three', match: { kinds: ['damage'] }, operation: { type: 'prevent_damage', amount: 3 } };
function damage(room: GameRoom, amount = 5): GameMutation {
  return { type: 'APPLY_DAMAGE_BATCH', assignments: [{ source: captureSourceInformation(room, room.battlefield[0]), recipient: { kind: 'player', playerId: 'player2' }, amount, combat: false }] };
}
const apply = (room: GameRoom, mutations: GameMutation[]) => mutations.reduce(gameReducer, room);

describe('proposed event replacement decisions', () => {
  it.each([['double', 13], ['prevent', 16]])('honors affected-player order beginning with %s', (id, life) => {
    const room = fixture([double, prevent]);
    const initial = planProposedMutations(room, [damage(room)]);
    expect(initial.mutations).toEqual([]);
    expect(initial.pendingChoice?.playerId).toBe('player2');
    expect(initial.pendingChoice?.options.map(o => o.id)).toEqual(['double', 'prevent']);
    const final = resumeProposedChoice(room, initial.pendingChoice!, { values: [id] });
    expect(final.pendingChoice).toBeUndefined();
    expect(apply(room, final.mutations).players.player2.life).toBe(life);
    expect(room.players.player2.life).toBe(20);
  });

  it('applies a self replacement before ordinary replacement choices', () => {
    const room = fixture([{ ...double, selfReplacement: true }, prevent]);
    const plan = planProposedMutations(room, [damage(room)]);
    expect(plan.pendingChoice).toBeUndefined();
    expect(apply(room, plan.mutations).players.player2.life).toBe(13);
  });

  it('does not repeatedly invoke one rule on its own modified event', () => {
    const room = fixture([double]);
    const plan = planProposedMutations(room, [damage(room)]);
    expect(apply(room, plan.mutations).players.player2.life).toBe(10);
  });

  it('re-evaluates applicability after a recipient changes', () => {
    const room = fixture([
      { id: 'redirect', label: 'Redirect', match: { kinds: ['damage'], playerId: 'player2' }, operation: { type: 'redirect_damage', recipient: { kind: 'player', playerId: 'player1' } } },
      { ...double, match: { kinds: ['damage'], playerId: 'player1' } },
    ]);
    const plan = planProposedMutations(room, [damage(room)]);
    const after = apply(room, plan.mutations);
    expect(after.players.player1.life).toBe(10);
    expect(after.players.player2.life).toBe(20);
  });

  it('retains a partially used finite shield for the next damage event', () => {
    const room = fixture([{ ...prevent, remaining: 3 }]);
    const first = damage(room, 2) as Extract<GameMutation, { type: 'APPLY_DAMAGE_BATCH' }>;
    const partial = apply(room, planProposedMutations(room, [first]).mutations);
    expect(partial.replacementEffects?.[0].remaining).toBe(1);
    const proposal: GameMutation = { ...first, assignments: [{ ...first.assignments[0], recipient: { kind: 'player', playerId: 'player1' } }] };
    const plan = planProposedMutations(partial, [proposal]);
    const after = apply(partial, plan.mutations);
    expect(after.players.player2.life).toBe(20);
    expect(after.players.player1.life).toBe(19);
    expect(after.replacementEffects).toEqual([]);
  });

  it('resumes a JSON-round-tripped transaction without committing its cost prefix or tail early', () => {
    const room = fixture([double, prevent]);
    const plan = planProposedMutations(room, [{ type: 'SPEND_MANA', playerId: 'player1', cost: { red: 2 } }, damage(room), { type: 'ADD_MANA', playerId: 'player1', color: 'blue', amount: 1 }]);
    expect(plan.mutations).toEqual([]);
    const choice = JSON.parse(JSON.stringify(plan.pendingChoice));
    const final = resumeProposedChoice(structuredClone(room), choice, { values: ['prevent'] });
    const after = apply(room, final.mutations);
    expect(after.players.player1.mana.red).toBe(3);
    expect(after.players.player1.mana.blue).toBe(6);
    expect(after.players.player2.life).toBe(16);
  });

  it('tracks rule application on each descendant of a split event', () => {
    const unregister = registerReplacementOperation('test_split', {
      applies: (_room, event) => event.kind === 'damage',
      replace: (_room, event) => event.kind === 'damage' ? { events: [event, { ...event, assignment: { ...event.assignment, recipient: { kind: 'player', playerId: 'player1' } } }] } : { events: [event] },
    });
    try {
      const room = fixture([{ id: 'split', label: 'Split', match: { kinds: ['damage'] }, operation: { type: 'test_split' } } as ReplacementDefinition]);
      const plan = planProposedMutations(room, [damage(room, 2)]);
      const after = apply(room, plan.mutations);
      expect(after.players.player1.life).toBe(18);
      expect(after.players.player2.life).toBe(18);
    } finally { unregister(); }
  });

  it('ignores expired sources and references to a previous incarnation', () => {
    const room = fixture([{ ...double, source: { cardUuid: 'source', zoneRevision: 2 }, duration: 'while_source' }]);
    expect(apply(room, planProposedMutations(room, [damage(room)]).mutations).players.player2.life).toBe(15);
  });

  it('matches player-specific draw and discard events', () => {
    const room = fixture([{ id: 'stop-draw', label: 'Stop draw', match: { kinds: ['draw'], playerId: 'player1' }, operation: { type: 'cancel_event' } },
      { id: 'stop-discard', label: 'Stop discard', match: { kinds: ['discard'], playerId: 'player1' }, operation: { type: 'cancel_event' } }]);
    const card = room.players.player1.hand[0];
    const discarded = planProposedMutations(room, [{ type: 'MOVE_CARD', cardUuid: card.uuid, playerId: 'player1', from: 'hand', to: 'graveyard', reason: 'discard' }]);
    expect(apply(room, discarded.mutations).players.player1.hand).toHaveLength(1);
    const libraryCard = { ...card, state: { ...card.state, zone: 'library' as const } };
    room.players.player1.deck = [libraryCard]; room.players.player1.hand = [];
    const drawn = planProposedMutations(room, [{ type: 'MOVE_CARD', cardUuid: card.uuid, playerId: 'player1', from: 'library', to: 'hand', reason: 'draw' }]);
    expect(apply(room, drawn.mutations).players.player1.deck).toHaveLength(1);
  });

  it('lets the affected player divide a finite shield between simultaneous sources', () => {
    const room = fixture([{ ...prevent, remaining: 3, match: { kinds: ['damage'], playerId: 'player2' } }]);
    const first = damage(room, 3) as Extract<GameMutation, { type: 'APPLY_DAMAGE_BATCH' }>;
    const plan = planProposedMutations(room, [{ ...first, assignments: [first.assignments[0], { ...first.assignments[0], source: { ...first.assignments[0].source, card: creature('second', 'player1') } }] }]);
    expect(plan.pendingChoice?.kind).toBe('distribution');
    expect(plan.pendingChoice?.total).toBe(3);
    const final = resumeProposedChoice(room, JSON.parse(JSON.stringify(plan.pendingChoice)), { values: [], allocations: { 'damage:0': 1, 'damage:1': 2 } });
    const committed = final.mutations.find(m => m.type === 'APPLY_DAMAGE_BATCH') as Extract<GameMutation, { type: 'APPLY_DAMAGE_BATCH' }>;
    expect(committed.assignments.map(a => a.amount)).toEqual([2, 1]);
    expect(apply(room, final.mutations).players.player2.life).toBe(17);
  });

  it('offers replacement decisions in active-player order across simultaneous damage events', () => {
    const room = fixture([double, prevent]);
    const first = damage(room, 5) as Extract<GameMutation, { type: 'APPLY_DAMAGE_BATCH' }>;
    const plan = planProposedMutations(room, [{ ...first, assignments: [first.assignments[0], { ...first.assignments[0], recipient: { kind: 'player', playerId: 'player1' } }] }]);
    expect(plan.pendingChoice?.playerId).toBe('player1');
  });

  it('processes damage created by a replacement of a damage result, including a persisted nested choice', () => {
    const newSource = creature('new-source', 'player1');
    const stop = registerReplacementOperation('test_gain_damage', {
      applies: (_room, event) => event.kind === 'life_change' && event.amount > 0,
      replace: (room, event) => ({ events: event.kind === 'life_change' ? [{ kind: 'damage', assignment: { source: captureSourceInformation(room, newSource), recipient: { kind: 'player', playerId: 'player2' }, amount: event.amount, combat: false } }] : [event] }),
    });
    try {
      const room = fixture([{ id: 'gain-damage', label: 'Replace gain with damage', match: { kinds: ['life_change'] }, operation: { type: 'test_gain_damage' } },
        { ...double, match: { kinds: ['damage'], source: { cardUuid: 'new-source', zoneRevision: 0 } } },
        { ...prevent, operation: { type: 'prevent_damage', amount: 1 }, match: { kinds: ['damage'], source: { cardUuid: 'new-source', zoneRevision: 0 } } }]);
      room.battlefield[0] = creature('source', 'player1', 2, 4, ['Lifelink']);
      const plan = planProposedMutations(room, [damage(room, 2)]);
      expect(plan.mutations).toEqual([]);
      expect(plan.pendingChoice?.playerId).toBe('player2');
      const final = resumeProposedChoice(room, JSON.parse(JSON.stringify(plan.pendingChoice)), { values: ['double'] });
      expect(final.pendingChoice).toBeUndefined();
      const after = apply(room, final.mutations);
      expect(after.players.player1.life).toBe(20);
      expect(after.players.player2.life).toBe(15);
    } finally { stop(); }
  });

  it('retains the parent atomic batch when new damage has its own result choice', () => {
    const newSource = creature('new-source', 'player1', 2, 4, ['Lifelink']);
    const stops = [registerReplacementOperation('test_gain_damage', {
      applies: (_room, event) => event.kind === 'life_change' && event.amount > 0,
      replace: (room, event) => ({ events: event.kind === 'life_change' ? [{ kind: 'damage', assignment: { source: captureSourceInformation(room, newSource), recipient: { kind: 'player', playerId: 'player2' }, amount: event.amount, combat: false } }] : [event] }),
    }), registerReplacementOperation('test_nested_gain', {
      applies: (_room, event) => event.kind === 'life_change' && event.amount === 4,
      replace: (_room, event, rule) => ({ events: rule.operation.increase && event.kind === 'life_change' ? [{ ...event, amount: event.amount * 2 }] : [] }),
    })];
    try {
      const room = fixture([{ id: 'gain-damage', label: 'Replace gain', match: { kinds: ['life_change'] }, operation: { type: 'test_gain_damage' } },
        { ...double, match: { kinds: ['damage'], source: { cardUuid: 'new-source', zoneRevision: 0 } } },
        { id: 'gain-up', label: 'Double gain', operation: { type: 'test_nested_gain', increase: true } },
        { id: 'gain-stop', label: 'Cancel gain', operation: { type: 'test_nested_gain', increase: false } }]);
      room.battlefield[0] = creature('source', 'player1', 2, 4, ['Lifelink']);
      const plan = planProposedMutations(room, [damage(room, 2)]);
      expect(plan.pendingChoice?.continuation.type).toBe('replacement');
      if (plan.pendingChoice?.continuation.type !== 'replacement') throw new Error('Missing replacement choice');
      expect(plan.pendingChoice.continuation.parents).toHaveLength(1);
      const final = resumeProposedChoice(room, JSON.parse(JSON.stringify(plan.pendingChoice)), { values: ['gain-up'] });
      const after = apply(room, final.mutations);
      expect(after.players.player2.life).toBe(14);
      expect(after.players.player1.life).toBe(28);
      const engine = new GameEngine(JSON.parse(JSON.stringify({ ...room, pendingChoice: { ...plan.pendingChoice, id: 'nested' }, priorityPlayerId: null, engineState: 'resolving_stack' })));
      const answered = engine.executePlayerAction('player1', 'choose', { choiceId: 'nested', choices: ['gain-up'] });
      expect(answered.success).toBe(true);
      expect(engine.roomState.priorityPlayerId).toBe('player1');
      expect(engine.roomState.players.player2.life).toBe(14);
      engine.dispose();
    } finally { stops.forEach(stop => stop()); }
  });
});
