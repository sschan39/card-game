import { attributedLethalMoves, killMove, attributeDamage, replacementCause } from './change-cause';
import type { GameRoom } from '../types/game.room.types';
import type { GameMutation } from '../types/game-mutation.types';
import type { ChoiceAnswer, PendingChoice } from '../types/choice.types';
import type {
  ProposedEvent,
  ProposedTransaction,
  ReplacementDefinition,
  ReplacementResult,
  TrackedProposedEvent,
} from '../types/proposed-event.types';
import { gameReducer, reduceDamageBatch } from './game-reducer';
import {
  affectedPlayer,
  applicableReplacement,
  applyReplacement,
  builtinReplacements,
  effectEventProhibited,
  eventProhibited,
} from './replacement-rules';
import { DamageRuleRegistry, validDamageAssignments } from './damage-service';
import { getCardInZone, moveDestinationPlayer, validateCardMove } from './zone-transitions';
import { captureSourceInformation } from './source-information';
import { planDamageResults } from './damage-keywords';
import { recordRuleUse } from '../rules/runtime/active-rules';

export interface ProposedPlan {
  mutations: GameMutation[];
  pendingChoice?: PendingChoice;
  paymentFailed?: true;
}

/** A proposed transaction could not perform every required payment. */
export class UnpaidMaterialCost extends Error {
  constructor() {
    super('The selected material payment could not be completed');
  }
}
export type ProposedPlanOptions = Pick<
  ProposedTransaction,
  'simultaneous' | 'cause' | 'resolution' | 'killCheckCauseId'
>;

/** Turn a primitive mutation into the proposed events a replacement effect can act on. */
function propose(room: GameRoom, mutation: GameMutation): ProposedEvent[] | undefined {
  return proposeBody(room, mutation)?.map((event) => {
    if ('move' in event && event.move) {
      const move = { ...event.move, cause: mutation.cause, kill: mutation.kill };
      if (move.kill?.causes.some((c) => c.killDestination === 'exile')) move.to = 'exile';
      const causes = mutation.cause ? [mutation.cause] : undefined;
      let proposedMove = move;
      if (event.kind === 'destroy' && !move.kill) {
        proposedMove = killMove(room, move, 'destroy', causes) as typeof move;
      }
      return { ...event, cause: mutation.cause, move: proposedMove };
    }
    return { ...event, cause: mutation.cause };
  });
}
function proposeBody(room: GameRoom, mutation: GameMutation): ProposedEvent[] | undefined {
  // Guard: an already-replaced mutation must not be proposed again.
  if ('replacementProcessed' in mutation && mutation.replacementProcessed) return;

  if (mutation.type === 'APPLY_DAMAGE_BATCH')
    return validDamageAssignments(room, mutation.assignments).map((assignment) => ({ kind: 'damage', assignment }));

  if (mutation.type === 'DESTROY_CARD' || mutation.type === 'SACRIFICE_CARD') {
    const card = room.battlefield.find(
      (c) => c.uuid === mutation.cardUuid && (c.state.zoneRevision ?? 0) === mutation.zoneRevision,
    );

    return card
      ? [
          {
            kind: mutation.type === 'DESTROY_CARD' ? 'destroy' : 'sacrifice',
            move: {
              type: 'MOVE_CARD',
              cardUuid: card.uuid,
              playerId: card.state.ownerId,
              from: 'battlefield',
              to: 'graveyard',
              reason: mutation.type === 'DESTROY_CARD' ? 'destroy' : 'sacrifice',
              sourceSnapshot: captureSourceInformation(room, card),
              zoneRevision: mutation.zoneRevision,
            },
          },
        ]
      : [];
  }

  if (mutation.type === 'DRAW_CARDS')
    return room.players[mutation.playerId] && Number.isSafeInteger(mutation.amount) && mutation.amount > 0
      ? Array.from({ length: mutation.amount }, () => ({
          kind: 'draw' as const, playerId: mutation.playerId,
          ...(mutation.position ? { position: mutation.position } : {}),
        }))
      : [];

  if (mutation.type === 'CHANGE_LIFE')
    return [
      {
        kind: 'life_change',
        playerId: mutation.playerId,
        amount: mutation.amount,
        ...(mutation.healing ? { healing: true as const } : {}),
      },
    ];

  if (mutation.type === 'ADD_COUNTER' || mutation.type === 'REMOVE_COUNTER') {
    const card = room.battlefield.find((c) => c.uuid === mutation.cardUuid);

    return card
      ? [
          {
            kind: 'counter_change',
            card: { cardUuid: card.uuid, zoneRevision: card.state.zoneRevision ?? 0 },
            counterType: mutation.counterType,
            amount: mutation.amount * (mutation.type === 'REMOVE_COUNTER' ? -1 : 1),
            sourceControllerId: mutation.sourceControllerId,
            sourceInfo: mutation.sourceInfo,
          },
        ]
      : [];
  }

  if (mutation.type === 'MOVE_CARD') {
    if (!validateCardMove(room, mutation)) return [];

    const card = getCardInZone(room, mutation.cardUuid, mutation.playerId, mutation.from);

    // Guard: the card must exist in the source zone and actually change zone.
    if (!card || mutation.from === mutation.to) return [];

    let kind: 'destroy' | 'sacrifice' | 'discard' | 'zone_transfer' = 'zone_transfer';
    if (mutation.reason === 'destroy') kind = 'destroy';
    if (mutation.reason === 'sacrifice') kind = 'sacrifice';
    if (mutation.reason === 'discard') kind = 'discard';
    const move = { ...mutation, sourceSnapshot: mutation.sourceSnapshot ?? captureSourceInformation(room, card) };

    return mutation.reason === 'draw' ? [{ kind: 'draw', playerId: moveDestinationPlayer(card, move), move }] : [{ kind, move }];
  }

  if (mutation.type === 'SET_LIFE' && room.players[mutation.playerId])
    return [
      {
        kind: 'life_change',
        playerId: mutation.playerId,
        amount: mutation.amount - room.players[mutation.playerId].life,
        ...(mutation.healing ? { healing: true as const } : {}),
        damageSource: mutation.damageSource,
        combat: mutation.combat,
        damageSourceInfo: mutation.damageSourceInfo,
      },
    ];
}

/** Lower settled proposed events back into primitive mutations. */
function lower(room: GameRoom, events: ProposedEvent[]): GameMutation[] {
  const result: GameMutation[] = [];
  let working = room;

  for (const event of events) {
    let mutation: GameMutation | undefined;

    if ('move' in event && event.move) mutation = { ...event.move, replacementProcessed: true };
    else if (event.kind === 'draw') {
      const deck = working.players[event.playerId]?.deck;
      const card = deck?.[event.position === 'bottom' ? 0 : deck.length - 1];

      mutation = card
        ? {
            type: 'MOVE_CARD',
            cardUuid: card.uuid,
            playerId: event.playerId,
            from: 'library',
            to: 'hand',
            reason: 'draw',
            replacementProcessed: true,
          }
        : { type: 'SET_FAILED_DRAW', playerId: event.playerId, value: true };
    }
    if (event.kind === 'life_change' && event.amount !== 0)
      mutation = {
        type: 'SET_LIFE',
        playerId: event.playerId,
        amount: working.players[event.playerId].life + event.amount,
        damageSource: event.damageSource,
        combat: event.combat,
        damageSourceInfo: event.damageSourceInfo,
        replacementProcessed: true,
      };

    if (event.kind === 'counter_change' && event.amount !== 0)
      mutation = {
        type: event.amount > 0 ? 'ADD_COUNTER' : 'REMOVE_COUNTER',
        cardUuid: event.card.cardUuid,
        counterType: event.counterType,
        amount: Math.abs(event.amount),
        sourceControllerId: event.sourceControllerId,
        sourceInfo: event.sourceInfo,
        replacementProcessed: true,
      };

    if (mutation) {
      mutation = { ...mutation, cause: mutation.cause ?? event.cause };
      result.push(mutation);
      working = gameReducer(working, mutation);
    }
  }

  return result;
}

/** Replay the transaction's committed prefix. */
function preview(room: GameRoom, transaction: ProposedTransaction): GameRoom {
  return transaction.completed.reduce(gameReducer, room);
}

/** Freeze the simultaneous board while carrying forward provisional consumable limits. */
function simultaneousPreview(base: GameRoom, working: GameRoom): GameRoom {
  return {
    ...base,
    replacementEffects: working.replacementEffects,
    gameRuleUses: working.gameRuleUses,
    turnHistory: base.turnHistory
      ? { ...base.turnHistory, uses: working.turnHistory?.uses ?? base.turnHistory.uses }
      : working.turnHistory,
  };
}

/** Replay the committed prefix plus the current frame's settled results. */
function settledPreview(room: GameRoom, transaction: ProposedTransaction): GameRoom {
  const working = preview(room, transaction);
  const current = transaction.current!;
  const results = [
    ...lower(
      working,
      current.final.map((frame) => frame.event),
    ),
    ...(current.resultPrimitives ?? []),
  ];

  return current.damage?.length
    ? reduceDamageBatch(working, current.damage, results)
    : results.reduce(gameReducer, working);
}

// Life results in one damage batch settle in order, even though the damage was simultaneous.
function withSettledLife(room: GameRoom, frame: TrackedProposedEvent, settled: readonly TrackedProposedEvent[]): GameRoom {
  if (frame.event.kind !== 'life_change') return room;
  const playerId = frame.event.playerId;
  const player = room.players[playerId];
  if (!player) return room;

  const delta = settled.reduce((total, { event }) =>
    total + (event.kind === 'life_change' && event.playerId === playerId ? event.amount : 0), 0);
  return delta ? { ...room, players: { ...room.players, [playerId]: { ...player, life: player.life + delta } } } : room;
}

/** The replacement effects that may apply to a frame, self-replacements first. */
function candidates(room: GameRoom, frame: TrackedProposedEvent, working = room): ReplacementDefinition[] {
  // Guard: a damage event of zero or less has nothing to replace.
  if (frame.event.kind === 'damage' && frame.event.assignment.amount <= 0) return [];

  const prohibited = eventProhibited(room, frame.event);
  const applicable = [...(room.replacementEffects ?? []), ...builtinReplacements(room, frame.event)].filter(
    (rule) =>
      (!prohibited || rule.selfReplacement) &&
      !frame.applied.includes(rule.id) &&
      applicableReplacement(room, frame.event, rule, working),
  );
  const self = applicable.filter((rule) => rule.selfReplacement);

  // A self-replacement effect always wins over ordinary replacements.
  return self.length ? self : applicable;
}

/** Ask the affected player which replacement effect to use. */
function choose(room: GameRoom, transaction: ProposedTransaction, rules: ReplacementDefinition[]): PendingChoice {
  const event = transaction.current!.frames[0].event;

  return {
    id: '',
    playerId: affectedPlayer(room, event),
    kind: 'options',
    prompt: `Choose a replacement for ${event.kind.replace(/_/g, ' ')}`,
    min: 1,
    max: 1,
    options: rules.flatMap((rule) => [
      { id: rule.id, label: rule.label, value: rule.id },
      ...(rule.optional ? [{ id: `skip:${rule.id}`, label: `Decline ${rule.label}`, value: `skip:${rule.id}` }] : []),
    ]),
    continuation: { type: 'replacement', transaction },
  };
}

/** Ask how a partial shield should be split across simultaneous damage events. */
function shieldChoice(
  room: GameRoom,
  transaction: ProposedTransaction,
  rule: ReplacementDefinition,
): PendingChoice | undefined {
  // Guard: only a partial damage-prevention shield needs an allocation.
  if (rule.operation.type !== 'prevent_damage' || rule.remaining === undefined) return;

  const frames = transaction.current!.frames;
  const first = frames[0].event;

  // Guard: the first frame must be preventable damage.
  if (first.kind !== 'damage' || first.assignment.preventable === false) return;

  const recipient = JSON.stringify(first.assignment.recipient);
  const indices = frames.flatMap((frame, index) =>
    frame.event.kind === 'damage' &&
    frame.event.assignment.preventable !== false &&
    JSON.stringify(frame.event.assignment.recipient) === recipient &&
    !frame.applied.includes(rule.id) &&
    applicableReplacement(room, frame.event, rule)
      ? [index]
      : [],
  );
  const options = indices.map((index) => {
    const event = frames[index].event as Extract<ProposedEvent, { kind: 'damage' }>;

    return {
      id: `damage:${index}`,
      label: `Damage from ${event.assignment.source.card.blueprint.name}`,
      value: index,
      limit: Math.min(
        event.assignment.amount,
        rule.operation.type === 'prevent_damage' ? (rule.operation.amount ?? Infinity) : Infinity,
      ),
    };
  });

  // Guard: a shield that covers everything needs no allocation.
  if (indices.length < 2 || options.reduce((sum, option) => sum + option.limit, 0) <= rule.remaining) return;

  return {
    id: '',
    playerId: affectedPlayer(room, first),
    kind: 'distribution',
    prompt: `Allocate ${rule.label}`,
    min: 0,
    max: options.length,
    total: rule.remaining,
    minimumPerOption: 0,
    options,
    continuation: { type: 'replacement', transaction, shieldAllocation: { ruleId: rule.id, indices } },
  };
}

/** Apply the player's shield allocation to the pending damage frames. */
function applyShieldAllocation(
  room: GameRoom,
  choice: PendingChoice,
  transaction: ProposedTransaction,
  answer: ChoiceAnswer,
): void {
  if (choice.kind === 'number') throw new Error('Invalid shield allocation');
  if (choice.continuation.type !== 'replacement' || !choice.continuation.shieldAllocation || !answer.allocations)
    throw new Error('Invalid shield allocation');

  const selection = choice.continuation.shieldAllocation;
  const rule = room.replacementEffects?.find((rule) => rule.id === selection.ruleId);
  const allocations = answer.allocations;

  // Guard: every allocation must be a non-negative integer within its option's limit,
  // and the allocations must add up to the shield's total.
  if (
    !rule ||
    Object.entries(allocations).some(
      ([id, amount]) =>
        !Number.isSafeInteger(amount) ||
        amount < 0 ||
        !choice.options.some((option) => option.id === id && amount <= option.limit!),
    ) ||
    Object.values(allocations).reduce((sum, amount) => sum + amount, 0) !== choice.total
  )
    throw new Error('Invalid shield allocation');

  for (const index of selection.indices) {
    const frame = transaction.current!.frames[index];

    // Guard: the frame must still be replaceable by this rule.
    if (frame.event.kind !== 'damage' || !applicableReplacement(room, frame.event, rule))
      throw new Error('Shield allocation is stale');

    const amount = allocations[`damage:${index}`] ?? 0;
    frame.event.assignment.amount -= amount;
    if (amount > 0) {
      frame.event.cause = replacementCause(room, frame.event.cause ?? frame.event.assignment.cause, rule);
      if (frame.event.cause)
        frame.event.assignment = attributeDamage({ ...frame.event.assignment, cause: undefined }, frame.event.cause);
    }
    frame.applied.push(rule.id);
  }

  const remaining = rule.remaining! - choice.total!;

  transaction.completed.push({
    type: 'SET_REPLACEMENT_EFFECTS',
    effects: (room.replacementEffects ?? []).flatMap((candidate) => {
      if (candidate.id !== rule.id) return [candidate];
      if (remaining <= 0) return [];
      return [{ ...candidate, remaining }];
    }),
  });
}

/** Commit a rewrite only after its payment, if any, succeeded. */
function settleRule(
  room: GameRoom,
  transaction: ProposedTransaction,
  rule: ReplacementDefinition,
  result?: ReplacementResult,
  paid: GameMutation[] = [],
): void {
  const frame = transaction.current!.frames.shift()!;
  const applied = [...frame.applied, rule.id];

  // Declined or unpaid replacements leave the event in place.
  if (!result) {
    transaction.current!.frames.unshift({ ...frame, applied });

    return;
  }

  transaction.completed.push(...paid);
  const changed = !!result.mutations?.length || JSON.stringify(result.events) !== JSON.stringify([frame.event]);

  const cause = changed ? replacementCause(room, frame.event.cause, rule) : frame.event.cause;
  if (result.mutations?.length)
    transaction.completed.push(
      ...result.mutations.map((m) => ({
        ...m,
        cause: m.cause ?? cause,
      })),
    );

  // A consumable rule records its use when it actually changed the event.
  if (changed && rule.ruleUse) transaction.completed.push(recordRuleUse(room, rule.ruleUse));

  // A consumable rule loses its remaining amount or one use when it actually changed the event.
  if (changed && (rule.remaining !== undefined || rule.uses !== undefined)) {
    const remaining = rule.remaining === undefined ? undefined : rule.remaining - (result.prevented ?? 0);
    const uses = rule.uses === undefined ? undefined : rule.uses - 1;
    const afterPayment = paid.reduce(gameReducer, room);
    const effects = (afterPayment.replacementEffects ?? []).flatMap((candidate) => {
      if (candidate.id !== rule.id) return [candidate];
      const exhausted = (remaining !== undefined && remaining <= 0) || (uses !== undefined && uses <= 0);
      if (exhausted) return [];
      return [{ ...candidate, remaining, uses }];
    });

    transaction.completed.push({ type: 'SET_REPLACEMENT_EFFECTS', effects });
  }

  transaction.current!.frames.unshift(
    ...result.events.map((event) => ({
      event: {
        ...event,
        cause: cause ?? event.cause,
        ...(event.kind === 'damage' && cause
          ? {
              assignment: attributeDamage({ ...event.assignment, cause: undefined }, cause),
            }
          : {}),
      },
      applied: [...applied],
    })),
  );
}

/** Plan any payment as a child transaction, with no committed parent prefix. */
function applyRule(
  room: GameRoom,
  baseRoom: GameRoom,
  working: GameRoom,
  transaction: ProposedTransaction,
  rule: ReplacementDefinition,
  decline = false,
): ProposedPlan | undefined {
  const current = transaction.current!;
  const result = decline ? undefined : applyReplacement(room, current.frames[0].event, rule, working);
  if (!result?.payment?.length) {
    settleRule(room, transaction, rule, result);
    return;
  }

  const payment = planProposedMutations(settledPreview(baseRoom, transaction), result.payment);
  const continuation = payment.pendingChoice?.continuation;
  if (continuation?.type === 'replacement') {
    current.pendingReplacementPayment = { rule, result };
    continuation.parents = [...continuation.parents ?? [], transaction];
    return payment;
  }

  settleRule(room, transaction, rule, payment.paymentFailed ? undefined : result, payment.mutations);
}

/** Drive the transaction until it settles or needs a player decision. */
function run(room: GameRoom, transaction: ProposedTransaction): ProposedPlan {
  let working = room;
  let previewed = 0;

  while (transaction.current || transaction.remaining.length) {
    // Completed primitives only append. Carry the local preview forward rather
    // than replaying the entire prefix for every untap/choice planning step.
    while (previewed < transaction.completed.length) working = gameReducer(working, transaction.completed[previewed++]);

    // Simultaneous events use one board's characteristics, with only provisional
    // consumable registrations carried forward between events.
    const matchingRoom = transaction.simultaneous ? simultaneousPreview(room, working) : working;

    if (!transaction.current) {
      let mutation = transaction.remaining.shift()!;

      // Validate the final primitive too: no transaction prefix may commit before
      // continuous numeric creation/normalization has successfully planned.
      if (mutation.type === 'ADD_CONTINUOUS_EFFECT') gameReducer(working, mutation);

      // Drawing several cards is a sequence of individual draw events.
      if (mutation.type === 'DRAW_CARDS' && Number.isSafeInteger(mutation.amount) && mutation.amount > 1) {
        transaction.remaining.unshift({ ...mutation, amount: mutation.amount - 1 });
        mutation = { ...mutation, amount: 1 };
      }

      const events = propose(matchingRoom, mutation);

      // Guard: a mutation with no proposed events commits directly.
      if (events === undefined) {
        transaction.completed.push(mutation);

        continue;
      }

      transaction.current = { frames: events.map((event) => ({ event, applied: [] })), final: [] };

      // Damage is applied to the non-active player first.
      if (events.some((event) => event.kind === 'damage'))
        transaction.current.frames.sort(
          (a, b) =>
            Number(affectedPlayer(matchingRoom, a.event) !== room.activeTurnPlayerId) -
            Number(affectedPlayer(matchingRoom, b.event) !== room.activeTurnPlayerId),
        );
    }

    const current = transaction.current;

    // Every frame is settled: lower them, then close the transaction.
    if (!current.frames.length) {
      // Damage frames are batched so simultaneous damage is applied at once.
      if (current.damage === undefined && current.final.some((frame) => frame.event.kind === 'damage')) {
        const damageFrames = current.final.filter((frame) => frame.event.kind === 'damage');

        current.damage = validDamageAssignments(
          matchingRoom,
          damageFrames.flatMap((frame) => (frame.event.kind === 'damage' ? [frame.event.assignment] : [])),
        );
        current.final = current.final.filter((frame) => frame.event.kind !== 'damage');
        current.resultPrimitives = [];

        for (const frame of damageFrames)
          if (frame.event.kind === 'damage' && current.damage.includes(frame.event.assignment))
            for (const mutation of planDamageResults(matchingRoom, [frame.event.assignment])) {
              const events = propose(matchingRoom, mutation);

              if (events === undefined) current.resultPrimitives.push(mutation);
              else current.frames.push(...events.map((event) => ({ event, applied: [...frame.applied] })));
            }

        continue;
      }

      // Damage created by a replacement effect is planned as a nested transaction.
      const createdDamage = current.final.filter((frame) => frame.event.kind === 'damage');

      if (createdDamage.length) {
        current.final = current.final.filter((frame) => frame.event.kind !== 'damage');

        const nested = run(settledPreview(room, transaction), {
          completed: [],
          remaining: [],
          current: {
            frames: [],
            final: createdDamage,
          },
        });

        // A nested decision suspends the parent transaction until it is answered.
        if (nested.pendingChoice?.continuation.type === 'replacement') {
          nested.pendingChoice.continuation.parents = [
            ...(nested.pendingChoice.continuation.parents ?? []),
            transaction,
          ];

          return { mutations: [], pendingChoice: nested.pendingChoice };
        }

        current.resultPrimitives = [...(current.resultPrimitives ?? []), ...nested.mutations];
      }

      const final = [
        ...lower(
          working,
          current.final.map((frame) => frame.event),
        ),
        ...(current.resultPrimitives ?? []),
      ];

      if (current.damage?.length) {
        transaction.completed.push({
          type: 'APPLY_DAMAGE_BATCH',
          assignments: current.damage,
          results: final,
          replacementProcessed: true,
        });
        transaction.remaining.unshift(
          ...DamageRuleRegistry.consequences(reduceDamageBatch(working, current.damage, final), current.damage),
        );
      } else transaction.completed.push(...final);

      transaction.current = undefined;

      continue;
    }

    const frame = current.frames[0];
    if (effectEventProhibited(matchingRoom, frame.event)) {
      current.frames.shift();
      continue;
    }
    const eventRoom = withSettledLife(matchingRoom, frame, current.final);
    const rules = candidates(eventRoom, frame, working);

    // No replacement applies: the frame settles as-is.
    if (!rules.length) {
      const settled = current.frames.shift()!;

      if (!eventProhibited(matchingRoom, frame.event)) current.final.push(settled);

      continue;
    }

    // A choice is needed when several rules apply or the only rule is optional.
    if (rules.length > 1 || rules[0].optional)
      return {
        mutations: [],
        pendingChoice: choose(matchingRoom, transaction, rules),
      };

    const allocation = shieldChoice(matchingRoom, transaction, rules[0]);

    if (allocation) return { mutations: [], pendingChoice: allocation };

    const pending = applyRule(eventRoom, room, working, transaction, rules[0]);
    if (pending) return pending;
  }

  if (transaction.killCheckCauseId) {
    const causeId = transaction.killCheckCauseId;
    transaction.killCheckCauseId = undefined;
    const moves = attributedLethalMoves(preview(room, transaction), causeId);
    if (moves.length) return run(room, { ...transaction, remaining: moves });
  }
  const requiredMoves = [
    ...(transaction.requiredMoves ?? []),
    ...(transaction.requiredDestructions ?? []).map(reference => ({
      ...reference, to: 'graveyard' as const, reason: 'destroy' as const,
    })),
  ];
  if (requiredMoves.length) {
    const after = preview(room, transaction);
    const unpaid = requiredMoves.some(reference =>
      after.battlefield.some(card =>
        card.uuid === reference.cardUuid && (card.state.zoneRevision ?? 0) === reference.zoneRevision) ||
      !transaction.completed.some(mutation =>
        mutation.type === 'MOVE_CARD' && mutation.to === reference.to &&
        (reference.reason === undefined || mutation.reason === reference.reason) &&
        mutation.cardUuid === reference.cardUuid && mutation.zoneRevision === reference.zoneRevision),
    );
    if (unpaid) return { mutations: [], paymentFailed: true };
  }
  return { mutations: transaction.completed };
}

/** Pure transaction planner. No completed prefix is committed while a decision remains. */
export function planProposedMutations(
  room: GameRoom,
  mutations: readonly GameMutation[],
  options: ProposedPlanOptions = {},
): ProposedPlan {
  const requiredMoves: NonNullable<ProposedTransaction['requiredMoves']> = [];
  for (const mutation of mutations) {
    if (mutation.type === 'DESTROY_CARD' && mutation.requiredPayment)
      requiredMoves.push({ cardUuid: mutation.cardUuid, zoneRevision: mutation.zoneRevision, to: 'graveyard', reason: 'destroy' });
    if (mutation.type === 'MOVE_CARD' && mutation.requiredPayment && mutation.to === 'exile' &&
        mutation.zoneRevision !== undefined)
      requiredMoves.push({ cardUuid: mutation.cardUuid, zoneRevision: mutation.zoneRevision, to: 'exile' });
  }

  return run(room, {
    completed: [],
    remaining: structuredClone([...mutations]),
    resumePriority: room.priorityPlayerId,
    ...(requiredMoves.length ? { requiredMoves } : {}),
    ...options,
  });
}

/** The choice's data is sufficient after JSON serialization and engine reconstruction. */
export function resumeProposedChoice(room: GameRoom, choice: PendingChoice, answer: ChoiceAnswer): ProposedPlan {
  if (choice.continuation.type !== 'replacement') throw new Error('Expected a replacement choice');

  const transaction = structuredClone(choice.continuation.transaction);
  const parents = structuredClone(choice.continuation.parents ?? []);
  const baseRoom = parents.slice().reverse().reduce(settledPreview, room);

  // Resume each suspended parent transaction once the child has settled.
  const finish = (initial: ProposedPlan): ProposedPlan => {
    let plan = initial;

    while (!plan.pendingChoice && parents.length) {
      const parent = parents.shift()!;

      const parentRoom = parents.slice().reverse().reduce(settledPreview, room);
      const current = parent.current!;
      const pending = current.pendingReplacementPayment;
      if (pending) {
        delete current.pendingReplacementPayment;
        const working = preview(parentRoom, parent);
        const matching = parent.simultaneous ? simultaneousPreview(parentRoom, working) : working;
        const eventRoom = withSettledLife(matching, current.frames[0], current.final);
        settleRule(eventRoom, parent, pending.rule, plan.paymentFailed ? undefined : pending.result, plan.mutations);
      } else {
        current.resultPrimitives = [...(current.resultPrimitives ?? []), ...plan.mutations];
      }
      plan = run(parentRoom, parent);
    }

    if (plan.pendingChoice?.continuation.type === 'replacement') {
      plan.pendingChoice.continuation.parents = [...(plan.pendingChoice.continuation.parents ?? []), ...parents];
      plan.pendingChoice.continuation.afterResolution =
        choice.continuation.type === 'replacement' ? choice.continuation.afterResolution : undefined;
    }

    return plan;
  };

  // A shield allocation answer is applied directly to the pending frames.
  if (choice.continuation.shieldAllocation) {
    const working = preview(baseRoom, transaction);

    applyShieldAllocation(working, choice, transaction, answer);

    return finish(run(baseRoom, transaction));
  }

  const frame = transaction.current?.frames[0];

  // Guard: a replacement decision is exactly one string value.
  if (!frame || answer.values.length !== 1 || typeof answer.values[0] !== 'string')
    throw new Error('Invalid replacement decision');

  const working = preview(baseRoom, transaction);
  const matchingRoom = transaction.simultaneous ? simultaneousPreview(baseRoom, working) : working;
  const value = answer.values[0];
  const decline = value.startsWith('skip:');
  const id = decline ? value.slice(5) : value;
  const eventRoom = withSettledLife(matchingRoom, frame, transaction.current!.final);
  const rule = candidates(eventRoom, frame, working).find(
    (candidate) => candidate.id === id && (!decline || candidate.optional),
  );

  // Guard: the chosen rule must still apply to the frame.
  if (!rule) throw new Error('Replacement decision is no longer applicable');

  const allocation = decline ? undefined : shieldChoice(matchingRoom, transaction, rule);

  if (allocation) {
    if (allocation.continuation.type === 'replacement')
      allocation.continuation.afterResolution = choice.continuation.afterResolution;

    return finish({ mutations: [], pendingChoice: allocation });
  }

  const pending = applyRule(eventRoom, baseRoom, working, transaction, rule, decline);
  return finish(pending ?? run(baseRoom, transaction));
}
