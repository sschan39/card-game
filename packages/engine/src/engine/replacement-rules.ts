import { effectCanAffect } from '../shared/action-permissions';
import { damageCause } from './change-cause';
import { cardZonePlayer } from '../shared/card-visibility';
import type { GameRoom } from '../types/game.room.types';
import type { GameMutation } from '../types/game-mutation.types';
import type { ProposedEvent, ReplacementDefinition, ReplacementOperationMap } from '../types/proposed-event.types';
import { CardCharacteristicService } from './card-characteristic-service';
import { roomCards } from './continuous-effect-state';
import { protectionApplies } from '../shared/protection';
import { staticEventReplacements } from '../rules/runtime/event-replacements';
import { isCombatPhase } from '../shared/turn-utils';
import { ruleUseAvailable } from '../rules/runtime/active-rules';

export interface ReplacementResult { events: ProposedEvent[]; mutations?: GameMutation[]; prevented?: number }

export interface ReplacementOperationHandler<K extends keyof ReplacementOperationMap = keyof ReplacementOperationMap> {
  applies: (room: GameRoom, event: ProposedEvent, rule: ReplacementDefinition & { operation: ReplacementOperationMap[K] }) => boolean;
  replace: (room: GameRoom, event: ProposedEvent, rule: ReplacementDefinition & { operation: ReplacementOperationMap[K] }) => ReplacementResult;
}

const handlers = new Map<string, ReplacementOperationHandler>();

/** Handler code belongs to the engine; room snapshots retain only operation data. */
export function registerReplacementOperation<K extends keyof ReplacementOperationMap>(type: K, handler: ReplacementOperationHandler<K>): () => void {
  if (handlers.has(type)) throw new Error(`Replacement operation already registered: ${type}`);

  handlers.set(type, handler as ReplacementOperationHandler);

  return () => {
    if (handlers.get(type) === handler) handlers.delete(type);
  };
}

/** A rule is inactive once it is exhausted, expired, or its source has left. */
export function replacementIsActive(room: GameRoom, rule: ReplacementDefinition): boolean {
  // Guard: the rule's shared use budget must still allow another use.
  if (!ruleUseAvailable(room, rule.ruleUse)) return false;

  // Guard: exhausted uses.
  if (rule.uses !== undefined && rule.uses <= 0 || rule.remaining !== undefined && rule.remaining <= 0) return false;

  // Guard: expired by turn number.
  if (rule.expiresTurn !== undefined && (room.turnNumber ?? 1) > rule.expiresTurn) return false;

  if (rule.duration === 'end_of_combat' && !isCombatPhase(room.phase)) return false;

  // A while-source rule needs its source still on the battlefield at the same revision.
  return rule.duration !== 'while_source' ||
    !!rule.source && room.battlefield.some((card) => card.uuid === rule.source!.cardUuid && (card.state.zoneRevision ?? 0) === rule.source!.zoneRevision);
}

/** The card an event acts on, if the event names one. */
export function eventCard(room: GameRoom, event: ProposedEvent) {
  const uuid = event.kind === 'damage'
    ? event.assignment.recipient.kind === 'permanent' ? event.assignment.recipient.cardUuid : undefined
    : 'move' in event
      ? event.move?.cardUuid
      : event.kind === 'counter_change'
        ? event.card.cardUuid
        : undefined;

  return uuid ? roomCards(room).find((card) => card.uuid === uuid) : undefined;
}

/** The player an event is attributed to, falling back to the active player. */
export function affectedPlayer(room: GameRoom, event: ProposedEvent): string {
  if ('playerId' in event) return event.playerId;

  if (event.kind === 'damage' && event.assignment.recipient.kind === 'player') return event.assignment.recipient.playerId;

  const card = eventCard(room, event);

  return card
    ? card.state.zone === 'battlefield' ? CardCharacteristicService.resolveController(room, card) : cardZonePlayer(card)
    : room.activeTurnPlayerId;
}

/** True when the rule's match criteria and operation both accept the event. */
export function applicableReplacement(room: GameRoom, event: ProposedEvent, rule: ReplacementDefinition): boolean {
  if (!replacementIsActive(room, rule)) return false;

  const match = rule.match;

  if (match?.kinds && !match.kinds.includes(event.kind)) return false;
  if (match?.playerId && match.playerId !== affectedPlayer(room, event)) return false;

  const card = eventCard(room, event);

  if (match?.card && (!card || card.uuid !== match.card.cardUuid || (card.state.zoneRevision ?? 0) !== match.card.zoneRevision)) return false;
  if (match?.cardTypes && (!card || !match.cardTypes.some((type) => CardCharacteristicService.resolveTypes(room, card).includes(type)))) return false;
  if (match?.controllerId && (!card || CardCharacteristicService.resolveController(room, card) !== match.controllerId)) return false;

  if (
    match?.source &&
    (event.kind !== 'damage' || event.assignment.source.card.uuid !== match.source.cardUuid || (event.assignment.source.card.state.zoneRevision ?? 0) !== match.source.zoneRevision)
  ) {
    return false;
  }

  if (match?.combat !== undefined && (event.kind !== 'damage' || event.assignment.combat !== match.combat)) return false;
  if (match?.from && (!('move' in event) || event.move?.from !== match.from)) return false;
  if (match?.to && (!('move' in event) || event.move?.to !== match.to)) return false;

  const handler = handlers.get(rule.operation.type);

  if (!handler) throw new Error(`No handler for replacement operation: ${rule.operation.type}`);

  return handler.applies(room, event, rule);
}

/** Delegate the actual rewrite to the registered operation handler. */
export function applyReplacement(room: GameRoom, event: ProposedEvent, rule: ReplacementDefinition): ReplacementResult {
  const handler = handlers.get(rule.operation.type);

  if (!handler) throw new Error(`No handler for replacement operation: ${rule.operation.type}`);

  return handler.replace(room, event, rule);
}

registerReplacementOperation('damage_scale', {
  applies: (_room, event, rule) => event.kind === 'damage' &&
    event.assignment.amount > 0 &&
    Number.isSafeInteger(rule.operation.factor) &&
    rule.operation.factor >= 0 &&
    rule.operation.factor !== 1 &&
    Number.isSafeInteger(event.assignment.amount * rule.operation.factor),
  replace: (_room, event, rule) => ({
    events: event.kind === 'damage'
      ? [{ ...event, assignment: { ...event.assignment, amount: event.assignment.amount * rule.operation.factor } }]
      : [event],
  }),
});

registerReplacementOperation('heal_bonus', {
  applies: (_room, event, rule) => event.kind === 'life_change' && event.healing === true &&
    event.amount > 0 && Number.isSafeInteger(event.amount + rule.operation.amount),
  replace: (_room, event, rule) => ({
    events: event.kind === 'life_change' ? [{ ...event, amount: event.amount + rule.operation.amount }] : [event],
  }),
});

function lifeLossLimit(room: GameRoom, playerId: string, floor: number | undefined): number {
  const life = room.players[playerId]?.life;
  return floor === undefined || life === undefined ? 0 : Math.max(0, life - floor);
}

registerReplacementOperation('limit_life_loss', {
  applies: (room, event, rule) => event.kind === 'life_change' &&
    -event.amount > lifeLossLimit(room, event.playerId, rule.operation.floor),
  replace: (room, event, rule) => ({
    events: event.kind === 'life_change'
      ? [{ ...event, amount: -lifeLossLimit(room, event.playerId, rule.operation.floor) }]
      : [event],
  }),
});

/** A life payment must be payable in full under every mandatory life-loss limit. */
export function canPayLife(room: GameRoom, playerId: string, amount: number): boolean {
  const player = room.players[playerId];
  if (!player || player.life < amount) return false;
  if (amount === 0) return true;
  const event: ProposedEvent = { kind: 'life_change', playerId, amount: -amount };
  return ![...room.replacementEffects ?? [], ...builtinReplacements(room, event)].some(rule =>
    rule.operation.type === 'limit_life_loss' && !rule.optional && applicableReplacement(room, event, rule));
}

registerReplacementOperation('reduce_damage', {
  applies: (_room, event, rule) => event.kind === 'damage' && event.assignment.amount > 0 && rule.operation.amount > 0,
  replace: (_room, event, rule) => ({
    events: event.kind === 'damage' ? [{
      ...event, assignment: { ...event.assignment, amount: Math.max(0, event.assignment.amount - rule.operation.amount) },
    }] : [event],
  }),
});

registerReplacementOperation('prevent_damage', {
  applies: (_room, event, rule) => event.kind === 'damage' &&
    event.assignment.preventable !== false &&
    event.assignment.amount > 0 &&
    (rule.operation.amount === undefined || Number.isSafeInteger(rule.operation.amount) && rule.operation.amount > 0),
  replace: (_room, event, rule) => {
    if (event.kind !== 'damage') return { events: [event] };

    // Guard: unpreventable damage passes through untouched.
    if (event.assignment.preventable === false) return { events: [event], prevented: 0 };

    const prevented = Math.min(event.assignment.amount, rule.operation.amount ?? Infinity, rule.remaining ?? Infinity);

    return { events: [{ ...event, assignment: { ...event.assignment, amount: event.assignment.amount - prevented } }], prevented };
  },
});

registerReplacementOperation('redirect_damage', {
  applies: (room, event, rule) => event.kind === 'damage' &&
    event.assignment.amount > 0 &&
    JSON.stringify(event.assignment.recipient) !== JSON.stringify(rule.operation.recipient) &&
    (rule.operation.recipient.kind === 'player'
      ? !!room.players[rule.operation.recipient.playerId]
      : room.battlefield.some((card) =>
        card.uuid === (rule.operation.recipient as { cardUuid: string }).cardUuid &&
        (card.state.zoneRevision ?? 0) === (rule.operation.recipient as { zoneRevision: number }).zoneRevision)),
  replace: (_room, event, rule) => ({
    events: event.kind === 'damage'
      ? [{ ...event, assignment: { ...event.assignment, recipient: rule.operation.recipient } }]
      : [event],
  }),
});

registerReplacementOperation('move_destination', {
  applies: (_room, event, rule) => 'move' in event && !!event.move && event.move.to !== rule.operation.to && event.move.from !== rule.operation.to,
  replace: (_room, event, rule) => ({
    events: 'move' in event && event.move ? [{ kind: 'zone_transfer', move: { ...event.move, to: rule.operation.to, handRecipientId: undefined, toHost: undefined } }] : [event],
  }),
});

registerReplacementOperation('cancel_event', { applies: () => true, replace: () => ({ events: [] }) });

registerReplacementOperation('regenerate', {
  applies: (_room, event) => event.kind === 'destroy',
  replace: (room, event) => {
    const card = eventCard(room, event);

    return {
      events: [],
      mutations: card ? [{ type: 'REGENERATE_CARD', cardUuid: card.uuid, zoneRevision: card.state.zoneRevision ?? 0 }] : [],
    };
  },
});

/** Protection is a built-in replacement, not a registered card rule. */
export function builtinReplacements(room: GameRoom, event: ProposedEvent): ReplacementDefinition[] {
  const statics = staticEventReplacements(room, event, eventCard(room, event), affectedPlayer(room, event));

  // Guard: only permanent damage can be prevented by protection.
  if (event.kind !== 'damage' || event.assignment.recipient.kind !== 'permanent') return statics;

  const card = eventCard(room, event);

  return [
    ...statics,
    ...card && protectionApplies(room, card, event.assignment.source.card)
      ? [{ id: `protection:${card.uuid}:${card.state.zoneRevision ?? 0}`, label: 'Protection', operation: { type: 'prevent_damage' as const } }]
      : [],
  ];
}

/** An immune recipient cannot receive the event or spend a replacement on it. */
export function effectEventProhibited(room: GameRoom, event: ProposedEvent): boolean {
  const cause = event.kind === 'damage' ? damageCause(event.assignment) : event.cause;
  if (cause?.kind !== 'effect' || !cause.controllerId) return false;

  const card = eventCard(room, event);
  return !!card && !effectCanAffect(room, cause.controllerId, card, cause.source?.card);
}

/** Check destroy restrictions after replacements have been considered. */
export function eventProhibited(room: GameRoom, event: ProposedEvent): boolean {
  const card = event.kind === 'destroy' ? eventCard(room, event) : undefined;
  return !!card && CardCharacteristicService.resolveKeywords(room, card).some((k) => k.toLowerCase() === 'indestructible');
}
