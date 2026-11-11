import { describe, expect, it } from 'vitest';
import { answerStateBasedChoice, planStateBasedActions } from '@engine/state-based-planner';
import type { CardInstance } from '@shared/card.types';
import type { GameRoom } from '@shared/game.room.types';
import type { ChoiceAnswer, PendingChoice } from '@shared/choice.types';
import type { StateBasedBatch } from '@shared/state-based.types';
import type { StackObject } from '@shared/effect.types';
import { createTestRoom } from '../helpers/test-room-factory';
import { creature } from '../helpers/combat-fixture';

interface CardOptions {
  cardTypes?: string[];
  subTypes?: string[];
  superTypes?: string[];
  controllerId?: string;
  name?: string;
  power?: number;
  toughness?: number;
  attachmentRequirements?: unknown;
  state?: Partial<CardInstance['state']>;
}

const cardOf = (uuid: string, options: CardOptions = {}): CardInstance => {
  const card = creature(uuid, options.controllerId ?? 'player1', options.power ?? 2, options.toughness ?? 2);
  card.blueprint = {
    ...card.blueprint,
    id: uuid,
    name: options.name ?? uuid,
    cardTypes: (options.cardTypes ?? ['Creature']) as never,
    subTypes: (options.subTypes ?? []) as never,
    superTypes: (options.superTypes ?? []) as never,
    ...(options.attachmentRequirements ? { attachmentRequirements: options.attachmentRequirements as never } : {}),
  };
  card.state = { ...card.state, ...options.state };
  return card;
};

const roomOf = (battlefield: CardInstance[], patch: (room: GameRoom) => void = () => {}): GameRoom => {
  const room = createTestRoom();
  room.battlefield = battlefield;
  room.players.player1.hand = [];
  room.players.player2.hand = [];
  patch(room);
  return room;
};

const removed = (plan: ReturnType<typeof planStateBasedActions>): string[] =>
  plan.mutations.flatMap((mutation) =>
    (mutation.type === 'MOVE_CARD' || mutation.type === 'DESTROY_CARD') && 'cardUuid' in mutation ? [mutation.cardUuid] : [],
  );
const unattached = (plan: ReturnType<typeof planStateBasedActions>): string[] =>
  plan.mutations.flatMap((mutation) => (mutation.type === 'UNATTACH_CARD' ? [mutation.cardUuid] : []));

const triggeredObject = (uuid: string, source: CardInstance): StackObject => ({
  uuid,
  type: 'triggered',
  controllerId: source.state.controllerId,
  source,
  effects: [],
  countered: false,
});

const baseChoice = (batch: StateBasedBatch, decisionId: string): PendingChoice =>
  ({
    id: 'sb-choice',
    playerId: 'player1',
    kind: 'selection',
    prompt: 'choose',
    options: [],
    min: 1,
    max: 1,
    continuation: { type: 'state_based', batch, decisionId },
  }) as PendingChoice;
const answer = (value: unknown): ChoiceAnswer => ({ values: [value] });

describe('state based planner: attachments', () => {
  it('keeps a legal aura on a living player and removes one with a missing player', () => {
    const legal = cardOf('aura-legal', {
      cardTypes: ['Enchantment'],
      subTypes: ['Aura'],
      state: { attachedToPlayerId: 'player1' },
    });
    const withRequirements = cardOf('aura-required', {
      cardTypes: ['Enchantment'],
      subTypes: ['Aura'],
      attachmentRequirements: { type: 'player', required: true, controller: 'self' },
      state: { attachedToPlayerId: 'player1' },
    });
    const ghost = cardOf('aura-ghost', {
      cardTypes: ['Enchantment'],
      subTypes: ['Aura'],
      state: { attachedToPlayerId: 'missing-player' },
    });

    const plan = planStateBasedActions(roomOf([legal, withRequirements, ghost]));
    expect(removed(plan)).toEqual(['aura-ghost']);
  });

  it('enforces equipment and fortification host types', () => {
    const hostArtifact = cardOf('host-artifact', { cardTypes: ['Artifact'] });
    const hostCreature = cardOf('host-creature');
    const hostLand = cardOf('host-land', { cardTypes: ['Land'] });
    const equipBad = cardOf('equip-bad', {
      cardTypes: ['Artifact'],
      subTypes: ['Equipment'],
      state: { attachedTo: 'host-artifact' },
    });
    const equipOk = cardOf('equip-ok', {
      cardTypes: ['Artifact'],
      subTypes: ['Equipment'],
      state: { attachedTo: 'host-creature' },
    });
    const fortOk = cardOf('fort-ok', {
      cardTypes: ['Artifact'],
      subTypes: ['Fortification'],
      state: { attachedTo: 'host-land' },
    });
    const fortBad = cardOf('fort-bad', {
      cardTypes: ['Artifact'],
      subTypes: ['Fortification'],
      state: { attachedTo: 'host-creature' },
    });

    const plan = planStateBasedActions(roomOf([hostArtifact, hostCreature, hostLand, equipBad, equipOk, fortOk, fortBad]));
    expect(unattached(plan).sort()).toEqual(['equip-bad', 'fort-bad']);
  });

  it('unattaches an otherwise ordinary permanent that claims an attachment', () => {
    const host = cardOf('plain-host');
    const stray = cardOf('stray', { state: { attachedTo: 'plain-host' } });

    const plan = planStateBasedActions(roomOf([host, stray]));
    expect(unattached(plan)).toEqual(['stray']);
  });
});

describe('state based planner: battles and planeswalkers', () => {
  it('sacrifices a battle whose defense counters are exhausted', () => {
    const open = cardOf('siege-open', {
      cardTypes: ['Battle'],
      subTypes: ['Siege'],
      state: { counters: {}, zoneRevision: undefined },
    });

    const plan = planStateBasedActions(roomOf([open]));
    expect(removed(plan)).toEqual(['siege-open']);
  });

  it('waits for a queued trigger before sacrificing a siege', () => {
    const siege = cardOf('siege-waiting', {
      cardTypes: ['Battle'],
      subTypes: ['Siege'],
      state: { counters: {}, zoneRevision: undefined },
    });
    const room = roomOf([siege], (value) => {
      value.triggerQueue = { entries: [{ object: triggeredObject('queued-trigger', siege) as never, selections: {}, ordered: false }], resumePriority: 'player1' };
    });

    expect(removed(planStateBasedActions(room))).toEqual([]);
  });

  it('waits for a pending trigger mutation or the pending argument', () => {
    const fromRoom = cardOf('siege-room-pending', {
      cardTypes: ['Battle'],
      subTypes: ['Siege'],
      state: { counters: {} },
    });
    const roomPending = roomOf([fromRoom], (value) => {
      value.pendingTriggers = [{ type: 'PUSH_STACK', stackObject: triggeredObject('room-trigger', fromRoom) }];
    });
    expect(removed(planStateBasedActions(roomPending))).toEqual([]);

    const fromArgument = cardOf('siege-arg-pending', {
      cardTypes: ['Battle'],
      subTypes: ['Siege'],
      state: { counters: {} },
    });
    const roomArgument = roomOf([fromArgument]);
    expect(
      removed(planStateBasedActions(roomArgument, [{ type: 'PUSH_STACK', stackObject: triggeredObject('arg-trigger', fromArgument) }])),
    ).toEqual([]);

    const unrelated = cardOf('siege-unrelated-pending', {
      cardTypes: ['Battle'],
      subTypes: ['Siege'],
      state: { counters: {} },
    });
    const roomUnrelated = roomOf([unrelated]);
    expect(removed(planStateBasedActions(roomUnrelated, [{ type: 'TAP_CARD', cardUuid: 'siege-unrelated-pending' }]))).toEqual([
      'siege-unrelated-pending',
    ]);
  });

  it('assigns the only possible battle protector', () => {
    const siege = cardOf('siege-protector', {
      cardTypes: ['Battle'],
      subTypes: ['Siege'],
      state: { counters: { defense: 2 }, zoneRevision: undefined },
    });
    const plan = planStateBasedActions(roomOf([siege]));
    expect(plan.mutations).toContainEqual({ type: 'SET_BATTLE_PROTECTOR', cardUuid: 'siege-protector', playerId: 'player2' });

    const normal = cardOf('battle-protector', {
      cardTypes: ['Battle'],
      subTypes: ['Battle'],
      state: { counters: { defense: 2 } },
    });
    expect(planStateBasedActions(roomOf([normal])).mutations).toContainEqual({
      type: 'SET_BATTLE_PROTECTOR',
      cardUuid: 'battle-protector',
      playerId: 'player1',
    });
  });

  it('asks the controller to choose when several protectors are legal', () => {
    const siege = cardOf('siege-choice', {
      cardTypes: ['Battle'],
      subTypes: ['Siege'],
      state: { counters: { defense: 3 } },
    });
    const room = roomOf([siege], (value) => {
      value.players.player3 = { ...value.players.player2, id: 'player3' };
    });

    const plan = planStateBasedActions(room);
    expect(plan.mutations).toEqual([]);
    expect(plan.pendingChoice).toMatchObject({
      kind: 'selection',
      playerId: 'player1',
      min: 1,
      max: 1,
      continuation: { type: 'state_based', decisionId: 'protector:siege-choice' },
    });
    expect(plan.pendingChoice?.options.map((option) => option.value).sort()).toEqual(['player2', 'player3']);
  });

  it('sacrifices a battle with no legal protector and leaves a valid protector alone', () => {
    const lonely = cardOf('siege-lonely', {
      cardTypes: ['Battle'],
      subTypes: ['Siege'],
      state: { counters: { defense: 1 } },
    });
    const lonelyRoom = roomOf([lonely], (value) => {
      value.players = { player1: value.players.player1 };
    });
    expect(removed(planStateBasedActions(lonelyRoom))).toEqual(['siege-lonely']);

    const settled = cardOf('siege-settled', {
      cardTypes: ['Battle'],
      subTypes: ['Siege'],
      state: { counters: { defense: 1 }, protectorId: 'player2' },
    });
    expect(planStateBasedActions(roomOf([settled])).mutations).toEqual([]);
  });

  it('removes planeswalkers without loyalty and collapses duplicate removal', () => {
    const loyal = cardOf('walker-loyal', { cardTypes: ['Planeswalker'], state: { counters: { loyalty: 1 } } });
    expect(planStateBasedActions(roomOf([loyal])).mutations).toEqual([]);

    const doomed = cardOf('walker-doomed', { cardTypes: ['Planeswalker'], state: { counters: {} } });
    expect(removed(planStateBasedActions(roomOf([doomed])))).toEqual(['walker-doomed']);

    const duplicate = cardOf('double-removal', {
      cardTypes: ['Creature', 'Planeswalker'],
      toughness: 0,
      state: { counters: {} },
    });
    const plan = planStateBasedActions(roomOf([duplicate]));
    expect(removed(plan)).toEqual(['double-removal']);
    expect(plan.mutations.filter((mutation) => mutation.type === 'MOVE_CARD')).toHaveLength(1);
  });

  it('destroys a creature with lethal damage once', () => {
    const damaged = cardOf('lethal-damage', { toughness: 2, state: { damageTaken: 3 } });
    const plan = planStateBasedActions(roomOf([damaged]));

    expect(plan.mutations).toContainEqual(expect.objectContaining({ type: 'DESTROY_CARD', cardUuid: 'lethal-damage' }));
  });
});

describe('state based planner: legends and worlds', () => {
  const legend = (uuid: string) => cardOf(uuid, { superTypes: ['Legendary'], name: 'Legendary Hero' });

  it('asks which legendary copy to keep and then moves the others', () => {
    const first = legend('legend-a');
    const second = legend('legend-b');
    const room = roomOf([first, second]);

    const plan = planStateBasedActions(room);
    expect(plan.mutations).toEqual([]);
    expect(plan.pendingChoice).toMatchObject({ kind: 'selection', continuation: { type: 'state_based' } });

    const choice = plan.pendingChoice!;
    const decision = choice.continuation.type === 'state_based'
      ? choice.continuation.batch.decisions[0]
      : undefined;
    expect(decision?.kind).toBe('legend');

    const kept = decision!.options[0].value;
    const resolved = answerStateBasedChoice(room, choice, answer(kept));
    expect(removed(resolved)).toEqual(['legend-b']);

    const keptSecond = decision!.options[1].value;
    expect(removed(answerStateBasedChoice(room, choice, answer(keptSecond)))).toEqual(['legend-a']);
  });

  it('keeps only the newest world permanent', () => {
    const older = cardOf('world-older', { cardTypes: ['Enchantment'], superTypes: ['World'], state: { worldTimestamp: 1 } });
    const newest = cardOf('world-newest', { cardTypes: ['Enchantment'], superTypes: ['World'], state: { worldTimestamp: 2 } });
    expect(removed(planStateBasedActions(roomOf([older, newest])))).toEqual(['world-older']);

    const noStampA = cardOf('world-a', { cardTypes: ['Enchantment'], superTypes: ['World'] });
    const noStampB = cardOf('world-b', { cardTypes: ['Enchantment'], superTypes: ['World'], state: { characteristicTimestamp: undefined } });
    expect(removed(planStateBasedActions(roomOf([noStampA, noStampB]))).sort()).toEqual(['world-a', 'world-b']);
  });
});

describe('state based planner: answering decisions', () => {
  it('rejects malformed, stale and unknown answers', () => {
    const battle = cardOf('answered-battle', {
      cardTypes: ['Battle'],
      subTypes: ['Battle'],
      state: { counters: { defense: 2 }, zoneRevision: undefined },
    });
    const room = roomOf([battle]);
    const batch: StateBasedBatch = {
      mutations: [],
      decisions: [
        {
          id: 'protector-1',
          kind: 'protector',
          playerId: 'player1',
          prompt: 'Choose a protector',
          options: [{ id: 'player2', label: 'player2', value: 'player2' }],
          card: { cardUuid: 'answered-battle', zoneRevision: 0 },
        },
      ],
      references: [{ cardUuid: 'answered-battle', zoneRevision: 0 }],
      resumePriority: 'player1',
    };
    const choice = baseChoice(batch, 'protector-1');

    expect(() => answerStateBasedChoice(room, { ...choice, continuation: { type: 'action', actionId: 'a', data: {}, field: 'x' } } as PendingChoice, answer('player2'))).toThrow(
      'Invalid state-based decision',
    );
    expect(() => answerStateBasedChoice(room, choice, { values: ['player2', 'player3'] })).toThrow('Invalid state-based decision');
    expect(() => answerStateBasedChoice(roomOf([]), choice, answer('player2'))).toThrow('State-based decision is stale');
    expect(() => answerStateBasedChoice(room, baseChoice(batch, 'missing'), answer('player2'))).toThrow('Invalid state-based selection');
    expect(() => answerStateBasedChoice(room, choice, answer('player1'))).toThrow('Invalid state-based selection');
    expect(() =>
      answerStateBasedChoice(
        room,
        baseChoice({ ...batch, decisions: [{ ...batch.decisions[0], selected: 'player2' }] }, 'protector-1'),
        answer('player2'),
      ),
    ).toThrow('Invalid state-based selection');
  });

  it('applies a protector answer and resumes the batch', () => {
    const battle = cardOf('protector-battle', {
      cardTypes: ['Battle'],
      subTypes: ['Battle'],
      state: { counters: { defense: 2 } },
    });
    const room = roomOf([battle]);
    const batch: StateBasedBatch = {
      mutations: [],
      decisions: [
        {
          id: 'protector-2',
          kind: 'protector',
          playerId: 'player1',
          prompt: 'Choose a protector',
          options: [{ id: 'player2', label: 'player2', value: 'player2' }],
          card: { cardUuid: 'protector-battle', zoneRevision: 0 },
        },
      ],
      references: [{ cardUuid: 'protector-battle', zoneRevision: 0 }],
      resumePriority: 'player1',
    };

    const plan = answerStateBasedChoice(room, baseChoice(batch, 'protector-2'), answer('player2'));
    expect(plan.mutations).toContainEqual({ type: 'SET_BATTLE_PROTECTOR', cardUuid: 'protector-battle', playerId: 'player2' });
  });

  it('deduplicates repeated destruction and ignores decisions without a card', () => {
    const batch: StateBasedBatch = {
      mutations: [
        { type: 'DESTROY_CARD', cardUuid: 'same-permanent', zoneRevision: 0 },
        { type: 'DESTROY_CARD', cardUuid: 'same-permanent', zoneRevision: 0 },
      ],
      decisions: [
        {
          id: 'protector-no-card',
          kind: 'protector',
          playerId: 'player1',
          prompt: 'Choose a protector',
          options: [{ id: 'player2', label: 'player2', value: 'player2' }],
        },
      ],
      references: [],
      resumePriority: 'player1',
    };

    const plan = answerStateBasedChoice(roomOf([]), baseChoice(batch, 'protector-no-card'), answer('player2'));
    expect(plan.mutations).toEqual([{ type: 'DESTROY_CARD', cardUuid: 'same-permanent', zoneRevision: 0 }]);
  });

  it('defers END_GAME mutations until after the other state-based changes', () => {
    const batch: StateBasedBatch = {
      mutations: [
        { type: 'END_GAME', outcome: { type: 'draw', losses: [] } },
        { type: 'TAP_CARD', cardUuid: 'anything' },
      ],
      decisions: [
        {
          id: 'legend-answered',
          kind: 'legend',
          playerId: 'player1',
          prompt: 'Choose a legend',
          options: [{ id: 'legend-x', label: 'legend-x', value: { cardUuid: 'legend-x', zoneRevision: 0 } }],
        },
      ],
      references: [],
      resumePriority: 'player1',
    };

    const plan = answerStateBasedChoice(roomOf([]), baseChoice(batch, 'legend-answered'), answer({ cardUuid: 'legend-x', zoneRevision: 0 }));
    expect(plan.mutations).toEqual([{ type: 'TAP_CARD', cardUuid: 'anything' }, { type: 'END_GAME', outcome: { type: 'draw', losses: [] } }]);
  });
});
