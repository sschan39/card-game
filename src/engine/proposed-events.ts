import type { GameRoom } from '../types/game.room.types';
import type { GameMutation } from '../types/game-mutation.types';
import type { ChoiceAnswer, PendingChoice } from '../types/choice.types';
import type { ProposedEvent, ProposedTransaction, ReplacementDefinition, TrackedProposedEvent } from '../types/proposed-event.types';
import { gameReducer, reduceDamageBatch } from './game-reducer';
import { affectedPlayer, applicableReplacement, applyReplacement, builtinReplacements, eventProhibited } from './replacement-rules';
import { DamageRuleRegistry, validDamageAssignments } from './damage-service';
import { getCardInZone, validateCardMove } from './zone-transitions';
import { captureSourceInformation } from './source-information';
import { planDamageResults } from './damage-keywords';

export interface ProposedPlan { mutations: GameMutation[]; pendingChoice?: PendingChoice }
export type ProposedPlanOptions = Pick<ProposedTransaction, 'simultaneous' | 'cause' | 'resolution'>;

function propose(room: GameRoom, mutation: GameMutation): ProposedEvent[] | undefined {
  if ('replacementProcessed' in mutation && mutation.replacementProcessed) return;
  if (mutation.type === 'APPLY_DAMAGE_BATCH') return validDamageAssignments(room, mutation.assignments).map(assignment => ({ kind: 'damage', assignment }));
  if (mutation.type === 'DESTROY_CARD' || mutation.type === 'SACRIFICE_CARD') {
    const card = room.battlefield.find(c => c.uuid === mutation.cardUuid && (c.state.zoneRevision ?? 0) === mutation.zoneRevision);
    return card ? [{ kind: mutation.type === 'DESTROY_CARD' ? 'destroy' : 'sacrifice', move: { type: 'MOVE_CARD', cardUuid: card.uuid, playerId: card.state.ownerId, from: 'battlefield', to: 'graveyard',
      reason: mutation.type === 'DESTROY_CARD' ? 'destroy' : 'sacrifice', sourceSnapshot: captureSourceInformation(room, card) } }] : [];
  }
  if (mutation.type === 'DRAW_CARDS') return room.players[mutation.playerId] && Number.isSafeInteger(mutation.amount) && mutation.amount > 0
    ? Array.from({ length: mutation.amount }, () => ({ kind: 'draw' as const, playerId: mutation.playerId })) : [];
  if (mutation.type === 'CHANGE_LIFE') return [{ kind: 'life_change', playerId: mutation.playerId, amount: mutation.amount }];
  if (mutation.type === 'ADD_POISON') return [{ kind: 'poison', playerId: mutation.playerId, amount: mutation.amount }];
  if (mutation.type === 'ADD_COUNTER' || mutation.type === 'REMOVE_COUNTER') {
    const card = room.battlefield.find(c => c.uuid === mutation.cardUuid);
    return card ? [{ kind: 'counter_change', card: { cardUuid: card.uuid, zoneRevision: card.state.zoneRevision ?? 0 }, counterType: mutation.counterType, amount: mutation.amount * (mutation.type === 'REMOVE_COUNTER' ? -1 : 1), sourceControllerId: mutation.sourceControllerId, sourceInfo: mutation.sourceInfo }] : [];
  }
  if (mutation.type === 'MOVE_CARD') {
    if (!validateCardMove(room, mutation)) return [];
    const card = getCardInZone(room, mutation.cardUuid, mutation.playerId, mutation.from);
    if (!card || mutation.from === mutation.to) return [];
    const kind = mutation.reason === 'destroy' ? 'destroy' : mutation.reason === 'sacrifice' ? 'sacrifice' : mutation.reason === 'discard' ? 'discard' : 'zone_transfer';
    const move = { ...mutation, sourceSnapshot: mutation.sourceSnapshot ?? captureSourceInformation(room, card) };
    return mutation.reason === 'draw' ? [{ kind: 'draw', playerId: mutation.playerId, move }] : [{ kind, move }];
  }
  if (mutation.type === 'SET_LIFE' && room.players[mutation.playerId]) return [{ kind: 'life_change', playerId: mutation.playerId, amount: mutation.amount - room.players[mutation.playerId].life,
    damageSource: mutation.damageSource, combat: mutation.combat, damageSourceInfo: mutation.damageSourceInfo }];
}

function lower(room: GameRoom, events: ProposedEvent[]): GameMutation[] {
  const result: GameMutation[] = [];
  let working = room;
  for (const event of events) {
    let mutation: GameMutation | undefined;
    if ('move' in event && event.move) mutation = { ...event.move, replacementProcessed: true };
    else if (event.kind === 'draw') {
      const card = working.players[event.playerId]?.deck.slice(-1)[0];
      mutation = card ? { type: 'MOVE_CARD', cardUuid: card.uuid, playerId: event.playerId, from: 'library', to: 'hand', reason: 'draw', replacementProcessed: true }
        : { type: 'SET_FAILED_DRAW', playerId: event.playerId, value: true };
    }
    if (event.kind === 'life_change' && event.amount !== 0) mutation = { type: 'SET_LIFE', playerId: event.playerId, amount: working.players[event.playerId].life + event.amount,
      damageSource: event.damageSource, combat: event.combat, damageSourceInfo: event.damageSourceInfo, replacementProcessed: true };
    if (event.kind === 'poison' && event.amount !== 0) mutation = { type: 'ADD_POISON', playerId: event.playerId, amount: event.amount, replacementProcessed: true };
    if (event.kind === 'counter_change' && event.amount !== 0) mutation = { type: event.amount > 0 ? 'ADD_COUNTER' : 'REMOVE_COUNTER', cardUuid: event.card.cardUuid, counterType: event.counterType, amount: Math.abs(event.amount), sourceControllerId: event.sourceControllerId, sourceInfo: event.sourceInfo, replacementProcessed: true };
    if (mutation) { result.push(mutation); working = gameReducer(working, mutation); }
  }
  return result;
}

function preview(room: GameRoom, transaction: ProposedTransaction): GameRoom {
  return transaction.completed.reduce(gameReducer, room);
}

function settledPreview(room: GameRoom, transaction: ProposedTransaction): GameRoom {
  const working = preview(room, transaction);
  const current = transaction.current!;
  const results = [...lower(working, current.final.map(frame => frame.event)), ...current.resultPrimitives ?? []];
  return current.damage?.length ? reduceDamageBatch(working, current.damage, results) : results.reduce(gameReducer, working);
}

function candidates(room: GameRoom, frame: TrackedProposedEvent): ReplacementDefinition[] {
  if (frame.event.kind === 'damage' && frame.event.assignment.amount <= 0) return [];
  const prohibited = eventProhibited(room, frame.event);
  const applicable = [...room.replacementEffects ?? [], ...builtinReplacements(room, frame.event)].filter(rule =>
    (!prohibited || rule.selfReplacement) && !frame.applied.includes(rule.id) && applicableReplacement(room, frame.event, rule));
  const self = applicable.filter(rule => rule.selfReplacement);
  return self.length ? self : applicable;
}

function choose(room: GameRoom, transaction: ProposedTransaction, rules: ReplacementDefinition[]): PendingChoice {
  const event = transaction.current!.frames[0].event;
  return { id: '', playerId: affectedPlayer(room, event), kind: 'options', prompt: `Choose a replacement for ${event.kind.replace(/_/g, ' ')}`,
    min: 1, max: 1, options: rules.flatMap(rule => [{ id: rule.id, label: rule.label, value: rule.id },
      ...rule.optional ? [{ id: `skip:${rule.id}`, label: `Decline ${rule.label}`, value: `skip:${rule.id}` }] : []]),
    continuation: { type: 'replacement', transaction } };
}

function shieldChoice(room: GameRoom, transaction: ProposedTransaction, rule: ReplacementDefinition): PendingChoice | undefined {
  if (rule.operation.type !== 'prevent_damage' || rule.remaining === undefined) return;
  const frames = transaction.current!.frames;
  const first = frames[0].event;
  if (first.kind !== 'damage' || first.assignment.preventable === false) return;
  const recipient = JSON.stringify(first.assignment.recipient);
  const indices = frames.flatMap((frame, index) => frame.event.kind === 'damage' && frame.event.assignment.preventable !== false && JSON.stringify(frame.event.assignment.recipient) === recipient &&
    !frame.applied.includes(rule.id) && applicableReplacement(room, frame.event, rule) ? [index] : []);
  const options = indices.map(index => {
    const event = frames[index].event as Extract<ProposedEvent, { kind: 'damage' }>;
    return { id: `damage:${index}`, label: `Damage from ${event.assignment.source.card.blueprint.name}`, value: index,
      limit: Math.min(event.assignment.amount, rule.operation.type === 'prevent_damage' ? rule.operation.amount ?? Infinity : Infinity) };
  });
  if (indices.length < 2 || options.reduce((sum, option) => sum + option.limit, 0) <= rule.remaining) return;
  return { id: '', playerId: affectedPlayer(room, first), kind: 'distribution', prompt: `Allocate ${rule.label}`, min: 0, max: options.length,
    total: rule.remaining, minimumPerOption: 0, options, continuation: { type: 'replacement', transaction, shieldAllocation: { ruleId: rule.id, indices } } };
}

function applyShieldAllocation(room: GameRoom, choice: PendingChoice, transaction: ProposedTransaction, answer: ChoiceAnswer): void {
  if (choice.kind === 'number') throw new Error('Invalid shield allocation');
  if (choice.continuation.type !== 'replacement' || !choice.continuation.shieldAllocation || !answer.allocations) throw new Error('Invalid shield allocation');
  const selection = choice.continuation.shieldAllocation;
  const rule = room.replacementEffects?.find(rule => rule.id === selection.ruleId);
  const allocations = answer.allocations;
  if (!rule || Object.entries(allocations).some(([id, amount]) => !Number.isSafeInteger(amount) || amount < 0 || !choice.options.some(option => option.id === id && amount <= option.limit!)) ||
    Object.values(allocations).reduce((sum, amount) => sum + amount, 0) !== choice.total) throw new Error('Invalid shield allocation');
  for (const index of selection.indices) {
    const frame = transaction.current!.frames[index];
    if (frame.event.kind !== 'damage' || !applicableReplacement(room, frame.event, rule)) throw new Error('Shield allocation is stale');
    frame.event.assignment.amount -= allocations[`damage:${index}`] ?? 0;
    frame.applied.push(rule.id);
  }
  const remaining = rule.remaining! - choice.total!;
  transaction.completed.push({ type: 'SET_REPLACEMENT_EFFECTS', effects: (room.replacementEffects ?? []).flatMap(candidate => candidate.id !== rule.id ? [candidate]
    : remaining <= 0 ? [] : [{ ...candidate, remaining }]) });
}

function applyRule(room: GameRoom, transaction: ProposedTransaction, rule: ReplacementDefinition, decline = false): void {
  const frame = transaction.current!.frames.shift()!;
  const applied = [...frame.applied, rule.id];
  if (decline) { transaction.current!.frames.unshift({ ...frame, applied }); return; }
  const result = applyReplacement(room, frame.event, rule);
  if (result.mutations?.length) transaction.completed.push(...result.mutations);
  const changed = !!result.mutations?.length || JSON.stringify(result.events) !== JSON.stringify([frame.event]);
  if (changed && (rule.remaining !== undefined || rule.uses !== undefined)) {
    const remaining = rule.remaining === undefined ? undefined : rule.remaining - (result.prevented ?? 0);
    const uses = rule.uses === undefined ? undefined : rule.uses - 1;
    const effects = (room.replacementEffects ?? []).flatMap(candidate => candidate.id !== rule.id ? [candidate]
      : remaining !== undefined && remaining <= 0 || uses !== undefined && uses <= 0 ? [] : [{ ...candidate, remaining, uses }]);
    transaction.completed.push({ type: 'SET_REPLACEMENT_EFFECTS', effects });
  }
  transaction.current!.frames.unshift(...result.events.map(event => ({ event, applied: [...applied] })));
}

function run(room: GameRoom, transaction: ProposedTransaction): ProposedPlan {
  let working = room;
  let previewed = 0;
  while (transaction.current || transaction.remaining.length) {
    // Completed primitives only append. Carry the local preview forward rather
    // than replaying the entire prefix for every untap/choice planning step.
    while (previewed < transaction.completed.length) working = gameReducer(working, transaction.completed[previewed++]);
    // Simultaneous events use one board's characteristics, with only provisional
    // consumable registrations carried forward between events.
    const matchingRoom = transaction.simultaneous ? { ...room, replacementEffects: working.replacementEffects } : working;
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
      if (events === undefined) { transaction.completed.push(mutation); continue; }
      transaction.current = { frames: events.map(event => ({ event, applied: [] })), final: [] };
      if (events.some(event => event.kind === 'damage')) transaction.current.frames.sort((a, b) => Number(affectedPlayer(matchingRoom, a.event) !== room.activeTurnPlayerId) - Number(affectedPlayer(matchingRoom, b.event) !== room.activeTurnPlayerId));
    }
    const current = transaction.current;
    if (!current.frames.length) {
      if (current.damage === undefined && current.final.some(frame => frame.event.kind === 'damage')) {
        const damageFrames = current.final.filter(frame => frame.event.kind === 'damage');
        current.damage = validDamageAssignments(matchingRoom, damageFrames.flatMap(frame => frame.event.kind === 'damage' ? [frame.event.assignment] : []));
        current.final = current.final.filter(frame => frame.event.kind !== 'damage');
        current.resultPrimitives = [];
        for (const frame of damageFrames) if (frame.event.kind === 'damage' && current.damage.includes(frame.event.assignment))
          for (const mutation of planDamageResults(matchingRoom, [frame.event.assignment])) {
            const events = propose(matchingRoom, mutation);
            if (events === undefined) current.resultPrimitives.push(mutation);
            else current.frames.push(...events.map(event => ({ event, applied: [...frame.applied] })));
          }
        continue;
      }
      const createdDamage = current.final.filter(frame => frame.event.kind === 'damage');
      if (createdDamage.length) {
        current.final = current.final.filter(frame => frame.event.kind !== 'damage');
        const nested = run(settledPreview(room, transaction), { completed: [], remaining: [], current: { frames: [], final: createdDamage } });
        if (nested.pendingChoice?.continuation.type === 'replacement') {
          nested.pendingChoice.continuation.parents = [...nested.pendingChoice.continuation.parents ?? [], transaction];
          return { mutations: [], pendingChoice: nested.pendingChoice };
        }
        current.resultPrimitives = [...current.resultPrimitives ?? [], ...nested.mutations];
      }
      const final = [...lower(working, current.final.map(frame => frame.event)), ...current.resultPrimitives ?? []];
      if (current.damage?.length) {
        transaction.completed.push({ type: 'APPLY_DAMAGE_BATCH', assignments: current.damage, results: final, replacementProcessed: true });
        transaction.remaining.unshift(...DamageRuleRegistry.consequences(reduceDamageBatch(working, current.damage, final), current.damage));
      } else transaction.completed.push(...final);
      transaction.current = undefined;
      continue;
    }
    const frame = current.frames[0];
    const rules = candidates(matchingRoom, frame);
    if (!rules.length) {
      const settled = current.frames.shift()!;
      if (!eventProhibited(matchingRoom, frame.event)) current.final.push(settled);
      continue;
    }
    if (rules.length > 1 || rules[0].optional) return { mutations: [], pendingChoice: choose(matchingRoom, transaction, rules) };
    const allocation = shieldChoice(matchingRoom, transaction, rules[0]);
    if (allocation) return { mutations: [], pendingChoice: allocation };
    applyRule(matchingRoom, transaction, rules[0]);
  }
  return { mutations: transaction.completed };
}

/** Pure transaction planner. No completed prefix is committed while a decision remains. */
export function planProposedMutations(room: GameRoom, mutations: readonly GameMutation[], options: ProposedPlanOptions = {}): ProposedPlan {
  return run(room, { completed: [], remaining: structuredClone([...mutations]), resumePriority: room.priorityPlayerId, ...options });
}

/** The choice's data is sufficient after JSON serialization and engine reconstruction. */
export function resumeProposedChoice(room: GameRoom, choice: PendingChoice, answer: ChoiceAnswer): ProposedPlan {
  if (choice.continuation.type !== 'replacement') throw new Error('Expected a replacement choice');
  const transaction = structuredClone(choice.continuation.transaction);
  const parents = structuredClone(choice.continuation.parents ?? []);
  const baseRoom = parents.slice().reverse().reduce(settledPreview, room);
  const finish = (initial: ProposedPlan): ProposedPlan => {
    let plan = initial;
    while (!plan.pendingChoice && parents.length) {
      const parent = parents.shift()!;
      parent.current!.resultPrimitives = [...parent.current!.resultPrimitives ?? [], ...plan.mutations];
      plan = run(parents.slice().reverse().reduce(settledPreview, room), parent);
    }
    if (plan.pendingChoice?.continuation.type === 'replacement') {
      plan.pendingChoice.continuation.parents = [...plan.pendingChoice.continuation.parents ?? [], ...parents];
      plan.pendingChoice.continuation.afterResolution = choice.continuation.type === 'replacement' ? choice.continuation.afterResolution : undefined;
    }
    return plan;
  };
  if (choice.continuation.shieldAllocation) {
    const working = preview(baseRoom, transaction);
    applyShieldAllocation(working, choice, transaction, answer);
    return finish(run(baseRoom, transaction));
  }
  const frame = transaction.current?.frames[0];
  if (!frame || answer.values.length !== 1 || typeof answer.values[0] !== 'string') throw new Error('Invalid replacement decision');
  const working = preview(baseRoom, transaction);
  const matchingRoom = transaction.simultaneous ? { ...baseRoom, replacementEffects: working.replacementEffects } : working;
  const value = answer.values[0];
  const decline = value.startsWith('skip:');
  const id = decline ? value.slice(5) : value;
  const rule = candidates(matchingRoom, frame).find(candidate => candidate.id === id && (!decline || candidate.optional));
  if (!rule) throw new Error('Replacement decision is no longer applicable');
  const allocation = decline ? undefined : shieldChoice(matchingRoom, transaction, rule);
  if (allocation) {
    if (allocation.continuation.type === 'replacement') allocation.continuation.afterResolution = choice.continuation.afterResolution;
    return finish({ mutations: [], pendingChoice: allocation });
  }
  applyRule(matchingRoom, transaction, rule, decline);
  return finish(run(baseRoom, transaction));
}
