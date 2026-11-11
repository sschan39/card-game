import { describe, expect, it } from 'vitest';
import { deriveAppliedEvents } from '@engine/applied-events';
import { captureSourceInformation } from '@engine/source-information';
import type { CardInstance, CardSnapshot, CardZone } from '@shared/card.types';
import type { PendingChoice } from '@shared/choice.types';
import type { StackObject } from '@shared/effect.types';
import type { EventDraft, ResolutionReport } from '@shared/game-event.types';
import type { GameMutation } from '@shared/game-mutation.types';
import type { GameRoom } from '@shared/game.room.types';
import { createTestRoom } from '../helpers/test-room-factory';
import { creature } from '../helpers/combat-fixture';

function room(patch: (room: GameRoom) => void = () => {}): GameRoom {
  const created = createTestRoom();
  created.players.player1.hand = [];
  created.players.player2.hand = [];
  patch(created);
  return created;
}

const inZone = (card: CardInstance, zone: CardZone): CardInstance => ({ ...card, state: { ...card.state, zone } });
const onBattlefield = (card: CardInstance): CardInstance => inZone(card, 'battlefield');
const snap = (source: GameRoom, card: CardInstance): CardSnapshot => captureSourceInformation(source, card);

const spellObject = (uuid: string, source: CardInstance): StackObject => ({
  uuid,
  type: 'spell',
  controllerId: source.state.controllerId,
  source,
  effects: [],
  countered: false,
});

const choice = (id: string): PendingChoice =>
  ({
    id,
    playerId: 'player1',
    kind: 'options',
    prompt: 'pick',
    options: [],
    min: 0,
    max: 1,
    continuation: { type: 'action', actionId: 'act', data: {}, field: 'discardUuids' },
  }) as PendingChoice;

const derive = (before: GameRoom, after: GameRoom, mutation: GameMutation, resolution?: ResolutionReport, observe?: () => void): EventDraft[] =>
  deriveAppliedEvents(before, after, [{ mutation, before, after }], resolution, observe);
const ids = (events: EventDraft[]): string[] => events.map((event) => event.eventId);
const eventOf = (events: EventDraft[], id: string): EventDraft | undefined => events.find((event) => event.eventId === id);

describe('applied events: counters', () => {
  it('reports the counter delta with explicit source attribution', () => {
    const beforeCard = { ...creature('counter-target', 'player1'), state: { ...creature('counter-target', 'player1').state, counters: { charge: 1 } } };
    const afterCard = { ...beforeCard, state: { ...beforeCard.state, counters: { charge: 4 } } };
    const before = room((value) => { value.battlefield = [beforeCard]; });
    const after = room((value) => { value.battlefield = [afterCard]; });
    const sourceInfo = snap(before, creature('counter-source', 'player2'));

    const events = derive(before, after, {
      type: 'ADD_COUNTER',
      cardUuid: 'counter-target',
      counterType: 'charge',
      amount: 3,
      sourceControllerId: 'player2',
      sourceInfo,
    });

    expect(eventOf(events, 'COUNTER_CHANGED')?.payload).toMatchObject({
      card: afterCard,
      counterType: 'charge',
      oldCount: 1,
      newCount: 4,
      amount: 3,
      targetControllerId: 'player1',
      controllerId: 'player2',
      source: 'counter-source',
      sourceInfo,
    });
  });

  it('ignores a counter change that keeps the same total', () => {
    const card = onBattlefield(creature('empty-counters', 'player1'));
    const before = room((value) => { value.battlefield = [card]; });
    const after = room((value) => { value.battlefield = [card]; });

    const events = derive(before, after, {
      type: 'REMOVE_COUNTER',
      cardUuid: 'empty-counters',
      counterType: 'charge',
      amount: 1,
    });

    expect(ids(events)).toEqual(['MUTATION_APPLIED']);
  });

  it('falls back to the source snapshot and cause for attribution', () => {
    const beforeCard = { ...creature('attributed', 'player1'), state: { ...creature('attributed', 'player1').state, counters: { charge: 2 } } };
    const afterCard = { ...beforeCard, state: { ...beforeCard.state, counters: { charge: 1 } } };
    const before = room((value) => { value.battlefield = [beforeCard]; });
    const after = room((value) => { value.battlefield = [afterCard]; });
    const causeSource = creature('cause-source', 'player3');

    const fromSnapshot = derive(before, after, {
      type: 'REMOVE_COUNTER',
      cardUuid: 'attributed',
      counterType: 'charge',
      amount: 1,
      sourceInfo: snap(before, causeSource),
    });
    expect(eventOf(fromSnapshot, 'COUNTER_CHANGED')?.payload).toMatchObject({
      controllerId: 'player3',
      source: 'cause-source',
    });

    const fromCause = derive(before, after, {
      type: 'REMOVE_COUNTER',
      cardUuid: 'attributed',
      counterType: 'charge',
      amount: 1,
      cause: { id: 'c1', rootId: 'c1', kind: 'effect', controllerId: 'player2', source: snap(before, causeSource) },
    });
    expect(eventOf(fromCause, 'COUNTER_CHANGED')?.payload).toMatchObject({
      controllerId: 'player2',
      source: 'cause-source',
    });
  });
});

describe('applied events: damage batches', () => {
  it('reports the marked damage delta for a permanent creature', () => {
    const attacker = creature('attacker', 'player1');
    const victim = creature('victim', 'player2');
    const unprotected = { ...victim, state: { ...victim.state, damageTaken: undefined as unknown as number } };
    const before = room((value) => { value.battlefield = [attacker, unprotected]; });
    const afterVictim = { ...victim, state: { ...victim.state, damageTaken: 2 } };
    const after = room((value) => { value.battlefield = [attacker, afterVictim]; });

    const events = derive(before, after, {
      type: 'APPLY_DAMAGE_BATCH',
      assignments: [
        { source: snap(before, attacker), recipient: { kind: 'permanent', cardUuid: 'victim', zoneRevision: 0 }, amount: 2, combat: true },
      ],
      results: [{ type: 'SET_DAMAGE', cardUuid: 'victim', amount: 2 }],
    });

    const marked = events.find((event) => event.eventId === 'DAMAGE_TAKEN' && (event.payload as { source?: string }).source === 'attacker');
    expect(marked?.payload).toMatchObject({ amount: 2, oldDamage: 0, newDamage: 2, source: 'attacker' });
    const dealt = events.find((event) => event.eventId === 'DAMAGE_DEALT' && (event.payload as { combat?: boolean }).combat === true);
    expect(dealt?.payload).toMatchObject({
      amount: 2,
      combat: true,
      card: expect.objectContaining({ uuid: 'attacker' }),
      recipient: { cardUuid: 'victim' },
    });
  });

  it('derives the damage results when the operation does not supply them', () => {
    const attacker = creature('plain-attacker', 'player1');
    const before = room((value) => { value.battlefield = [attacker]; });
    const after = room((value) => {
      value.battlefield = [attacker];
      value.players.player2.life = 18;
    });

    const events = derive(before, after, {
      type: 'APPLY_DAMAGE_BATCH',
      assignments: [
        { source: snap(before, attacker), recipient: { kind: 'player', playerId: 'player2' }, amount: 2, combat: false },
      ],
    });

    expect(eventOf(events, 'DAMAGE_DEALT')?.payload).toMatchObject({
      amount: 2,
      combat: false,
      recipient: { playerId: 'player2' },
    });
  });

  it('reports damage to a non-creature permanent without marked damage', () => {
    const attacker = creature('walker-attacker', 'player1');
    const walker = creature('walker', 'player2');
    walker.blueprint = { ...walker.blueprint, cardTypes: ['Planeswalker'] };
    walker.state.counters = { loyalty: 1 };
    const before = room((value) => { value.battlefield = [attacker, walker]; });
    const afterWalker = { ...walker, state: { ...walker.state, counters: {}, damageTaken: 1, zoneRevision: undefined } };
    const after = room((value) => { value.battlefield = [attacker, afterWalker]; });

    const events = derive(before, after, {
      type: 'APPLY_DAMAGE_BATCH',
      assignments: [
        { source: snap(before, attacker), recipient: { kind: 'permanent', cardUuid: 'walker', zoneRevision: 0 }, amount: 1, combat: false },
      ],
      results: [{ type: 'REMOVE_COUNTER', cardUuid: 'walker', counterType: 'loyalty', amount: 1 }],
    });

    expect(ids(events)).not.toContain('DAMAGE_TAKEN');
    expect(eventOf(events, 'DAMAGE_DEALT')?.payload).toMatchObject({ amount: 1, recipient: { cardUuid: 'walker' } });
  });

  it('uses the pre-step snapshot for a recipient that already left', () => {
    const attacker = creature('departing-attacker', 'player1');
    const victim = creature('departing-victim', 'player2');
    const before = room((value) => { value.battlefield = [attacker, victim]; });
    const after = room((value) => { value.battlefield = [attacker]; });

    const events = derive(before, after, {
      type: 'APPLY_DAMAGE_BATCH',
      assignments: [
        { source: snap(before, attacker), recipient: { kind: 'permanent', cardUuid: 'departing-victim', zoneRevision: 0 }, amount: 2, combat: false },
      ],
      results: [{ type: 'MOVE_CARD', cardUuid: 'departing-victim', playerId: 'player2', from: 'battlefield', to: 'graveyard' }],
    });

    expect(eventOf(events, 'DAMAGE_TAKEN')?.payload).toMatchObject({
      card: expect.objectContaining({ uuid: 'departing-victim' }),
      amount: 2,
      oldDamage: 0,
    });
  });
});

describe('applied events: damage and life mutations', () => {
  it('ignores marked damage on a card that is not on the battlefield', () => {
    const settled = room();
    const events = derive(settled, settled, { type: 'SET_DAMAGE', cardUuid: 'ghost', amount: 4 });

    expect(ids(events)).toEqual(['MUTATION_APPLIED']);
  });

  it('reports a life gain without a damage event', () => {
    const before = room();
    const after = room((value) => { value.players.player1.life = 23; });

    const events = derive(before, after, { type: 'SET_LIFE', playerId: 'player1', amount: 23 });

    expect(eventOf(events, 'LIFE_GAINED')?.payload).toMatchObject({ oldLife: 20, newLife: 23, amount: 3 });
    expect(ids(events)).not.toContain('DAMAGE_DEALT');
  });

  it('reports life loss from a damage source that is still on the battlefield', () => {
    const attacker = creature('life-attacker', 'player1');
    const before = room((value) => { value.battlefield = [attacker]; });
    const after = room((value) => { value.battlefield = [attacker]; value.players.player1.life = 17; });

    const events = derive(before, after, { type: 'SET_LIFE', playerId: 'player1', amount: 17, damageSource: 'life-attacker' });

    expect(eventOf(events, 'LIFE_LOST')?.payload).toMatchObject({ oldLife: 20, newLife: 17, amount: 3 });
    expect(eventOf(events, 'DAMAGE_DEALT')?.payload).toMatchObject({ amount: 3, combat: false, source: 'life-attacker' });
  });

  it('reports life loss from a spell on the stack and keeps the retained snapshot', () => {
    const caster = creature('spell-caster', 'player1');
    caster.state.zone = 'stack';
    const stackObj = spellObject('damage-spell', caster);
    const before = room((value) => { value.stack = [stackObj]; });
    const after = room((value) => { value.players.player1.life = 16; });

    const fromStack = derive(before, after, { type: 'SET_LIFE', playerId: 'player1', amount: 16, damageSource: 'spell-caster' });
    expect(eventOf(fromStack, 'DAMAGE_DEALT')?.payload).toMatchObject({
      card: expect.objectContaining({ uuid: 'spell-caster' }),
      amount: 4,
    });

    const retained = derive(before, after, {
      type: 'SET_LIFE',
      playerId: 'player1',
      amount: 16,
      damageSource: 'spell-caster',
      damageSourceInfo: snap(before, caster),
    });
    expect(eventOf(retained, 'DAMAGE_DEALT')?.payload).toMatchObject({ snapshot: expect.objectContaining({ power: 2 }) });
  });

  it('ignores a life total that did not change', () => {
    const settled = room();
    const events = derive(settled, settled, { type: 'SET_LIFE', playerId: 'player1', amount: 20 });

    expect(ids(events)).toEqual(['MUTATION_APPLIED']);
  });
});

describe('applied events: zones', () => {
  it('reports a card drawn from the library', () => {
    const drawn = creature('drawn', 'player1');
    drawn.state.zone = 'library';
    const before = room((value) => { value.players.player1.deck = [drawn]; });
    const after = room((value) => { value.players.player1.hand = [inZone(drawn, 'hand')]; });

    const events = derive(before, after, { type: 'MOVE_CARD', cardUuid: 'drawn', playerId: 'player1', from: 'library', to: 'hand', reason: 'draw' });

    expect(ids(events)).toEqual(expect.arrayContaining(['CARD_MOVED', 'CARD_DRAWN']));
    expect(eventOf(events, 'CARD_DRAWN')?.payload).toMatchObject({ playerId: 'player1', controllerId: 'player1' });
  });

  it('reports discards from hand and from library', () => {
    const handCard = inZone(creature('discarded-hand', 'player1'), 'hand');
    const beforeHand = room((value) => { value.players.player1.hand = [handCard]; });
    const afterHand = room((value) => { value.players.player1.graveyard = [inZone(handCard, 'graveyard')]; });
    const handEvents = derive(beforeHand, afterHand, {
      type: 'MOVE_CARD',
      cardUuid: 'discarded-hand',
      playerId: 'player1',
      from: 'hand',
      to: 'graveyard',
      reason: 'discard',
    });
    expect(ids(handEvents)).toEqual(expect.arrayContaining(['CARD_DISCARDED_FROM_HAND']));

    const libraryCard = inZone(creature('discarded-library', 'player1'), 'library');
    const beforeLibrary = room((value) => { value.players.player1.deck = [libraryCard]; });
    const afterLibrary = room((value) => { value.players.player1.graveyard = [inZone(libraryCard, 'graveyard')]; });
    const libraryEvents = derive(beforeLibrary, afterLibrary, {
      type: 'MOVE_CARD',
      cardUuid: 'discarded-library',
      playerId: 'player1',
      from: 'library',
      to: 'graveyard',
      reason: 'discard',
    });
    expect(ids(libraryEvents)).toEqual(expect.arrayContaining(['CARD_DISCARDED_FROM_LIBRARY']));
  });

  it('announces a cast spell from the stack or from the supplied stack object', () => {
    const spellCard = inZone(creature('cast-card', 'player1'), 'hand');
    const stackCard = inZone(spellCard, 'stack');
    const stackObj = spellObject('cast-stack', stackCard);
    const before = room((value) => { value.players.player1.hand = [spellCard]; });
    const after = room((value) => { value.stack = [stackObj]; });

    const found = derive(before, after, {
      type: 'MOVE_CARD',
      cardUuid: 'cast-card',
      playerId: 'player1',
      from: 'hand',
      to: 'stack',
      reason: 'cast',
    });
    expect(eventOf(found, 'SPELL_CAST')?.payload).toMatchObject({ stackObj, playerId: 'player1' });

    const immediate = derive(before, after, {
      type: 'MOVE_CARD',
      cardUuid: 'cast-card',
      playerId: 'player1',
      from: 'hand',
      to: 'stack',
      reason: 'cast',
      stackObject: { ...stackObj, uuid: 'immediate-stack', immediate: true } as StackObject & { immediate: true },
    });
    expect(eventOf(immediate, 'SPELL_CAST')?.payload).toMatchObject({ stackObj: expect.objectContaining({ uuid: 'immediate-stack' }) });
  });

  it('leaves a cast card that arrives on the battlefield without a spell event', () => {
    const permanent = inZone(creature('cast-permanent', 'player1'), 'hand');
    const before = room((value) => { value.players.player1.hand = [permanent]; });
    const arrived = inZone(permanent, 'battlefield');
    const after = room((value) => { value.battlefield = [arrived]; });

    const events = derive(before, after, {
      type: 'MOVE_CARD',
      cardUuid: 'cast-permanent',
      playerId: 'player1',
      from: 'hand',
      to: 'battlefield',
      reason: 'cast',
    });

    expect(ids(events)).not.toContain('SPELL_CAST');
    expect(eventOf(events, 'PERMANENT_ENTERED')?.payload).toMatchObject({ card: arrived, controllerId: 'player1' });
  });

  it('reports a token leaving the battlefield and the death it caused', () => {
    const token = { ...creature('token', 'player1'), isToken: true, state: { ...creature('token', 'player1').state, zoneRevision: undefined } };
    const bystander = onBattlefield(creature('bystander', 'player1'));
    const before = room((value) => { value.battlefield = [token]; });
    const after = room((value) => { value.battlefield = [bystander]; });

    const events = derive(before, after, {
      type: 'MOVE_CARD',
      cardUuid: 'token',
      playerId: 'player1',
      from: 'battlefield',
      to: 'graveyard',
      reason: 'destroy',
      kill: { victim: { cardUuid: 'token', zoneRevision: 0 }, reason: 'lethal', causes: [] },
    });

    expect(ids(events)).toEqual(
      expect.arrayContaining(['PERMANENT_LEFT', 'TOKEN_CEASED', 'CREATURE_KILLED', 'PERMANENT_DESTROYED', 'PERMANENT_DIED']),
    );
    expect(eventOf(events, 'TOKEN_CEASED')?.payload).toMatchObject({ destination: 'graveyard' });
  });

  it('does not invent a departure for a card that was not on the battlefield', () => {
    const ghost = inZone(creature('ghost', 'player1'), 'graveyard');
    const before = room();
    const after = room((value) => { value.players.player1.graveyard = [ghost]; });

    const events = derive(before, after, { type: 'MOVE_CARD', cardUuid: 'ghost', playerId: 'player1', from: 'battlefield', to: 'graveyard' });

    expect(ids(events)).toEqual(['MUTATION_APPLIED']);
  });

  it('reports a token that entered the battlefield', () => {
    const token = { ...creature('new-token', 'player1'), isToken: true };
    const before = room();
    const after = room((value) => { value.battlefield = [token]; });

    const events = derive(before, after, { type: 'CREATE_TOKEN', tokenId: 't', cardUuid: 'new-token', playerId: 'player1', sequence: 1 });

    expect(eventOf(events, 'PERMANENT_ENTERED')?.payload).toMatchObject({ card: token, controllerId: 'player1' });

    const unchanged = derive(room((value) => { value.battlefield = [token]; }), room((value) => { value.battlefield = [token]; }), {
      type: 'CREATE_TOKEN',
      tokenId: 't',
      cardUuid: 'new-token',
      playerId: 'player1',
      sequence: 2,
    });
    expect(ids(unchanged)).toEqual(['MUTATION_APPLIED']);
  });
});

describe('applied events: pending choices', () => {
  it('completes the previous choice and requests the next one', () => {
    const before = room((value) => { value.pendingChoice = choice('first'); });
    const after = room((value) => { value.pendingChoice = choice('second'); });

    const events = derive(before, after, { type: 'SET_PENDING_CHOICE', choice: choice('second') });

    expect(ids(events)).toEqual(expect.arrayContaining(['CHOICE_COMPLETED', 'CHOICE_REQUESTED']));
    expect(eventOf(events, 'CHOICE_COMPLETED')?.payload).toMatchObject({ choiceId: 'first', kind: 'options' });
    expect(eventOf(events, 'CHOICE_REQUESTED')?.payload).toMatchObject({ choiceId: 'second', kind: 'options' });
  });

  it('requests a choice without completing one and ignores an unchanged choice', () => {
    const before = room();
    const after = room((value) => { value.pendingChoice = choice('only'); });
    const requested = derive(before, after, { type: 'SET_PENDING_CHOICE', choice: choice('only') });
    expect(ids(requested)).toEqual(expect.arrayContaining(['CHOICE_REQUESTED']));
    expect(ids(requested)).not.toContain('CHOICE_COMPLETED');

    const stable = room((value) => { value.pendingChoice = choice('same'); });
    const unchanged = derive(stable, room((value) => { value.pendingChoice = choice('same'); }), {
      type: 'SET_PENDING_CHOICE',
      choice: choice('same'),
    });
    expect(ids(unchanged)).toEqual(['MUTATION_APPLIED']);
  });
});

describe('applied events: stack', () => {
  it('reports a countered spell and its move to the graveyard', () => {
    const spellCard = inZone(creature('countered-spell', 'player1'), 'stack');
    const counterStack = spellObject('countered-stack', spellCard);
    const before = room((value) => { value.stack = [counterStack]; });
    const after = room((value) => { value.players.player1.graveyard = [inZone(spellCard, 'graveyard')]; });

    const events = derive(before, after, { type: 'COUNTER_STACK', stackUuid: 'countered-stack' });
    expect(ids(events)).toEqual(expect.arrayContaining(['STACK_COUNTERED', 'CARD_MOVED']));
    expect(eventOf(events, 'CARD_MOVED')?.payload).toMatchObject({ cardUuid: 'countered-spell', from: 'stack', to: 'graveyard' });
  });

  it('ignores an unknown stack object and a spell missing from its graveyard', () => {
    const empty = room();
    expect(ids(derive(empty, empty, { type: 'COUNTER_STACK', stackUuid: 'missing' }))).toEqual(['MUTATION_APPLIED']);

    const spellCard = inZone(creature('lost-spell', 'player1'), 'stack');
    const before = room((value) => { value.stack = [spellObject('lost-stack', spellCard)]; });
    const leftover = spellObject('leftover-stack', inZone(creature('leftover-spell', 'player2'), 'stack'));
    const after = room((value) => { value.stack = [leftover]; });
    const events = derive(before, after, { type: 'COUNTER_STACK', stackUuid: 'lost-stack' });
    expect(ids(events)).toContain('STACK_COUNTERED');
    expect(ids(events)).not.toContain('CARD_MOVED');
  });

  it('reports a countered triggered ability without a card move', () => {
    const source = onBattlefield(creature('trigger-source', 'player1'));
    const triggered: StackObject = {
      uuid: 'triggered-stack',
      type: 'triggered',
      controllerId: 'player1',
      source,
      effects: [],
      countered: false,
    };
    const before = room((value) => { value.stack = [triggered]; });
    const after = room((value) => {
      value.stack = [spellObject('other-stack', inZone(creature('other-spell', 'player2'), 'stack'))];
    });

    const events = derive(before, after, { type: 'COUNTER_STACK', stackUuid: 'triggered-stack' });
    expect(ids(events)).toContain('STACK_COUNTERED');
    expect(ids(events)).not.toContain('CARD_MOVED');
  });

  it('publishes stack changes and the newly proposed object', () => {
    const spellCard = inZone(creature('proposed', 'player1'), 'stack');
    const stackObj = spellObject('proposed-stack', spellCard);
    const existing = spellObject('existing-stack', inZone(creature('existing', 'player2'), 'stack'));
    const before = room((value) => { value.stack = [existing]; });
    const after = room((value) => { value.stack = [existing, stackObj]; });

    const added = derive(before, after, { type: 'SET_STATUS', status: 'playing' });
    expect(ids(added)).toEqual(expect.arrayContaining(['STACK_UPDATED', 'ACTION_PROPOSED']));
    expect(eventOf(added, 'ACTION_PROPOSED')?.payload).toMatchObject({ actionType: 'spell', playerId: 'player1' });

    const removed = derive(after, room(), { type: 'SET_STATUS', status: 'playing' });
    expect(ids(removed)).toContain('STACK_UPDATED');
    expect(ids(removed)).not.toContain('ACTION_PROPOSED');
  });
});

describe('applied events: combat', () => {
  const declaration = (attacker: CardInstance, blockers: CardInstance[] = []) => ({
    uuid: `decl-${attacker.uuid}`,
    attacker,
    attackerPower: 2,
    blockers,
    blocked: blockers.length > 0,
  });

  it('reports declared attackers', () => {
    const attacker = onBattlefield(creature('declared-attacker', 'player1'));
    const before = room();
    const after = room((value) => { value.combat = [declaration(attacker)]; });

    const events = derive(before, after, { type: 'DECLARE_ATTACKERS', declarations: [] });
    expect(eventOf(events, 'ATTACKERS_DECLARED')?.payload).toEqual({ attackerIds: ['declared-attacker'] });
    expect(eventOf(events, 'ATTACK_DECLARED')?.payload).toMatchObject({ card: attacker, controllerId: 'player1' });
  });

  it('reports blockers once, either assigned directly or completed', () => {
    const attacker = onBattlefield(creature('attack-target', 'player1'));
    const blocker = onBattlefield(creature('blocker', 'player2'));
    const before = room();
    const after = room((value) => { value.combat = [declaration(attacker, [blocker])]; });

    const assigned = derive(before, after, { type: 'ASSIGN_BLOCKERS', attackerUuid: 'attack-target', blockerUuids: ['blocker'] });
    expect(eventOf(assigned, 'BLOCKERS_DECLARED')?.payload).toEqual({
      blockerAssignments: [{ attackerUuid: 'attack-target', blockerUuids: ['blocker'] }],
    });
    expect(ids(assigned)).not.toContain('BLOCK_DECLARED');

    const completed = deriveAppliedEvents(before, after, [
      { mutation: { type: 'ASSIGN_BLOCKERS', attackerUuid: 'attack-target', blockerUuids: ['blocker'] }, before, after },
      { mutation: { type: 'COMPLETE_BLOCKER_DECLARATION' }, before, after },
    ]);
    expect(eventOf(completed, 'BLOCKERS_DECLARED')).toBeDefined();
    expect(eventOf(completed, 'BLOCK_DECLARED')?.payload).toMatchObject({ card: blocker, attackerUuid: 'attack-target' });
  });

  it('publishes combat damage once for a later completed pass', () => {
    const state = (passIndex: number) => ({
      passes: ['first', 'second'],
      passIndex,
      completed: true,
      requests: [],
      allocations: {},
    });
    const before = room((value) => { value.combatDamage = state(0); });
    const after = room((value) => { value.combatDamage = state(1); });
    const damage: GameMutation = { type: 'APPLY_DAMAGE_BATCH', assignments: [], results: [] };

    const events = deriveAppliedEvents(before, after, [
      { mutation: damage, before, after: before },
      { mutation: { type: 'SET_COMBAT_DAMAGE', state: state(1) }, before, after },
    ]);

    expect(eventOf(events, 'COMBAT_DAMAGE_RESOLVED')?.payload).toMatchObject({
      pass: 'second',
      currentPlayer: 'player1',
      damageAssignments: [expect.objectContaining({ type: 'APPLY_DAMAGE_BATCH' })],
    });

    const repeated = derive(room((value) => { value.combatDamage = state(1); }), room((value) => { value.combatDamage = state(1); }), {
      type: 'SET_COMBAT_DAMAGE',
      state: state(1),
    });
    expect(ids(repeated)).not.toContain('COMBAT_DAMAGE_RESOLVED');
  });
});

describe('applied events: phases and priority', () => {
  it.each([
    ['stateTurnStart', 'TURN_STARTED'],
    ['upkeepStep', 'UPKEEP_STARTED'],
    ['stateEndPhase', 'END_STEP_STARTED'],
    ['beginCombatStep', 'COMBAT_BEGIN'],
    ['endCombatStep', 'COMBAT_ENDED'],
  ] as const)('publishes %s phase entry notifications', (phase, expected) => {
    const before = room();
    const after = room((value) => { value.phase = phase; });

    const events = derive(before, after, { type: 'SET_PHASE', phase });

    expect(eventOf(events, 'PHASE_CHANGED')?.payload).toMatchObject({ previousPhase: 'stateMainPhase', phase });
    expect(ids(events)).toContain(expected);
  });

  it('ignores an unchanged phase, turn and priority holder', () => {
    const settled = room();
    expect(ids(derive(settled, settled, { type: 'SET_PHASE', phase: 'stateMainPhase' }))).toEqual(['MUTATION_APPLIED']);
    expect(ids(derive(settled, settled, { type: 'SET_TURN', playerId: 'player1' }))).toEqual(['MUTATION_APPLIED']);
    expect(ids(derive(settled, settled, { type: 'SET_PRIORITY', playerId: 'player1' }))).toEqual(['MUTATION_APPLIED']);
  });

  it('reports a turn switch and a priority handoff', () => {
    const before = room();
    const afterTurn = room((value) => { value.activeTurnPlayerId = 'player2'; });
    expect(eventOf(derive(before, afterTurn, { type: 'SET_TURN', playerId: 'player2' }), 'TURN_SWITCHED')?.payload).toEqual({
      previousPlayer: 'player1',
      newPlayer: 'player2',
    });

    const afterPriority = room((value) => { value.priorityPlayerId = 'player2'; });
    expect(eventOf(derive(before, afterPriority, { type: 'SET_PRIORITY', playerId: 'player2' }), 'PRIORITY_GIVEN')?.payload).toEqual({
      previousPlayer: 'player1',
      playerId: 'player2',
    });
  });
});

describe('applied events: characteristics, owned events and resolution', () => {
  it('compares characteristics for cards that remain the same incarnation', () => {
    const card = onBattlefield(creature('changed', 'player1'));
    card.state.zoneRevision = undefined as unknown as number;
    const before = room((value) => { value.battlefield = [card]; });
    const after = room((value) => {
      value.battlefield = [onBattlefield({ ...card, state: { ...card.state, controllerId: 'player2', zoneRevision: undefined } })];
    });

    const events = derive(before, after, { type: 'SET_STATUS', status: 'playing' });
    expect(eventOf(events, 'CHARACTERISTICS_CHANGED')?.payload).toMatchObject({
      controllerId: 'player2',
      before: expect.objectContaining({ controllerId: 'player1' }),
      after: expect.objectContaining({ controllerId: 'player2' }),
    });
  });

  it('forwards events owned by an operation and observes each published event', () => {
    const settled = room();
    const observed: string[] = [];
    const events = deriveAppliedEvents(
      settled,
      settled,
      [
        {
          mutation: { type: 'SET_STATUS', status: 'playing' },
          before: settled,
          after: settled,
          events: [{ eventId: 'LIFE_GAINED', roomId: settled.roomId, payload: { playerId: 'player1', oldLife: 1, newLife: 2, amount: 1 } }],
        },
      ],
      undefined,
      () => observed.push('observed'),
    );

    expect(ids(events)).toEqual(['MUTATION_APPLIED', 'LIFE_GAINED']);
    expect(observed).toHaveLength(2);
  });

  it('publishes an immediate resolution and its reveals', () => {
    const caster = onBattlefield(creature('reveal-caster', 'player1'));
    const revealed = inZone(creature('revealed-card', 'player2'), 'library');
    const sourceInfo = snap(room((value) => { value.battlefield = [caster]; }), caster);
    const stackObj: StackObject = {
      uuid: 'reveal-stack',
      type: 'activated',
      immediate: true,
      controllerId: 'player1',
      source: caster,
      effects: [{ action: 'REVEAL_TOP', params: {}, targeting: { type: 'self', required: false } }],
      countered: false,
      resolutionReveals: [{ cards: [revealed], sourceInfo, controllerId: 'player1' }],
    };
    const resolution: ResolutionReport = { stackObj, effects: [{ effectId: 'REVEAL_TOP', fizzled: false }] };
    const before = room((value) => { value.stack = [stackObj]; value.battlefield = [caster]; });
    const after = room((value) => {
      value.stack = [spellObject('follow-up', inZone(creature('follow-up-source', 'player2'), 'stack'))];
      value.players.player2.deck = [inZone(revealed, 'library')];
      value.battlefield = [caster];
    });

    const events = deriveAppliedEvents(before, after, [], resolution);

    expect(ids(events)).toEqual(expect.arrayContaining(['ACTION_RESOLVED', 'CARD_REVEALED', 'STACK_ITEM_RESOLVED', 'STACK_RESOLVED']));
    const revealedEvent = eventOf(events, 'CARD_REVEALED');
    expect(revealedEvent?.payload).toMatchObject({ card: expect.objectContaining({ uuid: 'revealed-card' }), controllerId: 'player1' });
    expect(revealedEvent?.payload).not.toHaveProperty('revealedSnapshot');
    expect(eventOf(events, 'STACK_RESOLVED')?.payload).toMatchObject({ effectId: 'REVEAL_TOP', countered: false });
  });

  it('publishes a reveal resolved from the stack with its retained snapshot', () => {
    const caster = onBattlefield(creature('snapshot-caster', 'player1'));
    const revealed = inZone(creature('snapshot-card', 'player2'), 'library');
    const snapshot = snap(room(), revealed);
    const stackObj: StackObject = {
      uuid: 'snapshot-stack',
      type: 'activated',
      controllerId: 'player1',
      source: caster,
      effects: [],
      countered: false,
      resolutionReveals: [{ cards: [revealed], snapshots: [snapshot], sourceInfo: snap(room(), caster), controllerId: 'player1' }],
    };
    const resolution: ResolutionReport = { stackObj, effects: [{ effectId: 'struct', fizzled: true }] };
    const before = room((value) => { value.stack = [stackObj]; value.battlefield = [caster]; });
    const after = room((value) => {
      value.stack = [spellObject('snapshot-follow-up', inZone(creature('snapshot-follow-up-source', 'player2'), 'stack'))];
      value.battlefield = [caster];
    });

    const events = deriveAppliedEvents(before, after, [], resolution);

    expect(ids(events)).toContain('CARD_REVEALED');
    expect(eventOf(events, 'CARD_REVEALED')?.payload).toMatchObject({ revealedSnapshot: snapshot });
    expect(eventOf(events, 'STACK_ITEM_RESOLVED')?.payload).toMatchObject({ effectId: 'struct', fizzled: true });
    expect(eventOf(events, 'STACK_RESOLVED')?.payload).toMatchObject({ effectId: 'structural' });
    expect(ids(events)).not.toContain('ACTION_RESOLVED');
  });

  it('publishes an immediate resolution that revealed nothing', () => {
    const caster = onBattlefield(creature('quiet-caster', 'player1'));
    const stackObj: StackObject = {
      uuid: 'quiet-stack',
      type: 'activated',
      immediate: true,
      controllerId: 'player1',
      source: caster,
      effects: [],
      countered: false,
    };
    const resolution: ResolutionReport = { stackObj, effects: [] };
    const before = room((value) => { value.stack = [stackObj]; value.battlefield = [caster]; });
    const after = room((value) => { value.battlefield = [caster]; });

    const events = deriveAppliedEvents(before, after, [], resolution);

    expect(ids(events)).toEqual(expect.arrayContaining(['ACTION_RESOLVED', 'STACK_RESOLVED']));
    expect(ids(events)).not.toContain('CARD_REVEALED');
  });

  it('matches reveal snapshots by incarnation and tolerates missing revisions', () => {
    const caster = onBattlefield(creature('revision-caster', 'player1'));
    const libraryCard = (uuid: string, zoneRevision: number | undefined): CardInstance => {
      const card = inZone(creature(uuid, 'player2'), 'library');
      return { ...card, state: { ...card.state, zoneRevision } };
    };
    const leftMissing = libraryCard('left-missing', undefined);
    const rightMissing = libraryCard('right-missing', 0);
    const wrongZone = libraryCard('wrong-zone', 0);
    const wrongRevision = libraryCard('wrong-revision', 2);
    const revealedCards = [leftMissing, rightMissing, wrongZone, wrongRevision];
    const snapshotOf = (card: CardInstance, state: Partial<CardInstance['state']> = {}): CardSnapshot => ({
      card: { ...card, state: { ...card.state, ...state } },
      power: 2,
      toughness: 2,
    });
    const snapshots = [
      snapshotOf(leftMissing, { zoneRevision: 0 }),
      snapshotOf(rightMissing, { zoneRevision: undefined }),
      snapshotOf(wrongZone, { zone: 'hand' }),
      snapshotOf(wrongRevision, { zoneRevision: 1 }),
    ];
    const stackObj: StackObject = {
      uuid: 'revision-stack',
      type: 'activated',
      immediate: true,
      controllerId: 'player1',
      source: caster,
      effects: [],
      countered: false,
      resolutionReveals: [{ cards: revealedCards, snapshots, sourceInfo: snap(room(), caster), controllerId: 'player1' }],
    };
    const resolution: ResolutionReport = { stackObj, effects: [] };
    const before = room((value) => { value.battlefield = [caster]; });
    const after = room((value) => {
      value.battlefield = [caster];
      value.players.player2.deck = revealedCards.map((card) => inZone(card, 'library'));
    });

    const events = deriveAppliedEvents(before, after, [], resolution);
    const reveals = events.filter((event) => event.eventId === 'CARD_REVEALED');

    expect(reveals).toHaveLength(4);
    expect((reveals[0].payload as { revealedSnapshot?: CardSnapshot }).revealedSnapshot?.card.state.zoneRevision).toBe(0);
    expect((reveals[1].payload as { revealedSnapshot?: CardSnapshot }).revealedSnapshot?.card.state.zoneRevision).toBeUndefined();
    expect(reveals[2].payload).not.toHaveProperty('revealedSnapshot');
    expect(reveals[3].payload).not.toHaveProperty('revealedSnapshot');
  });

  it('skips damage results that leave the room unchanged', () => {
    const settled = room();

    const events = derive(settled, settled, {
      type: 'APPLY_DAMAGE_BATCH',
      assignments: [],
      results: [
        { type: 'SET_DAMAGE', cardUuid: 'ghost', amount: 3 },
        { type: 'SET_DAMAGE', cardUuid: 'ghost', amount: 4 },
      ],
    });

    expect(ids(events)).toEqual(['MUTATION_APPLIED']);
  });

  it('does not report a non-creature permanent as having died', () => {
    const artifact: CardInstance = {
      uuid: 'artifact-left',
      blueprint: {
        id: 'artifact-left',
        name: 'Artifact Left',
        cardTypes: ['Artifact'],
        keywords: [],
        castRequirements: { allowedZones: ['hand'], cost: {} },
        rulesText: '',
        abilities: [],
      },
      state: {
        zone: 'battlefield',
        zoneRevision: 0,
        ownerId: 'player1',
        controllerId: 'player1',
        isTapped: false,
        damageTaken: 0,
        summoningSickness: false,
        attackedThisTurn: false,
        counters: {},
      },
    };
    const before = room((value) => { value.battlefield = [artifact]; });
    const after = room((value) => { value.players.player1.graveyard = [inZone(artifact, 'graveyard')]; });

    const events = derive(before, after, {
      type: 'MOVE_CARD',
      cardUuid: 'artifact-left',
      playerId: 'player1',
      from: 'battlefield',
      to: 'graveyard',
      reason: 'destroy',
    });

    expect(ids(events)).toContain('PERMANENT_DESTROYED');
    expect(ids(events)).not.toContain('PERMANENT_DIED');
  });

  it('withholds reveals from a countered resolving object', () => {
    const caster = onBattlefield(creature('countered-caster', 'player1'));
    const revealed = inZone(creature('hidden-card', 'player2'), 'library');
    const stackObj: StackObject = {
      uuid: 'countered-reveal-stack',
      type: 'activated',
      immediate: true,
      controllerId: 'player1',
      source: caster,
      effects: [],
      countered: true,
      resolutionReveals: [{ cards: [revealed], sourceInfo: snap(room(), caster), controllerId: 'player1' }],
    };
    const resolution: ResolutionReport = { stackObj, effects: [] };
    const before = room((value) => { value.battlefield = [caster]; });
    const after = room((value) => {
      value.battlefield = [caster];
      value.players.player2.deck = [inZone(revealed, 'library')];
    });

    const events = deriveAppliedEvents(before, after, [], resolution);

    expect(ids(events)).toContain('ACTION_RESOLVED');
    expect(ids(events)).not.toContain('CARD_REVEALED');
  });
});
