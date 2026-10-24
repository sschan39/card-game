import type { GameRoom } from '../types/game.room.types';
import type { GameMutation } from '../types/game-mutation.types';
import type { ProposedEvent, ReplacementDefinition, ReplacementOperationMap } from '../types/proposed-event.types';
import { CardCharacteristicService } from './card-characteristic-service';
import { roomCards } from './continuous-effect-state';
import { protectionApplies } from '../shared/protection';

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
  return () => { if (handlers.get(type) === handler) handlers.delete(type); };
}

export function replacementIsActive(room: GameRoom, rule: ReplacementDefinition): boolean {
  if (rule.uses !== undefined && rule.uses <= 0 || rule.remaining !== undefined && rule.remaining <= 0) return false;
  if (rule.expiresTurn !== undefined && (room.turnNumber ?? 1) > rule.expiresTurn) return false;
  return rule.duration !== 'while_source' || !!rule.source && room.battlefield.some(card => card.uuid === rule.source!.cardUuid && (card.state.zoneRevision ?? 0) === rule.source!.zoneRevision);
}

export function eventCard(room: GameRoom, event: ProposedEvent) {
  const uuid = event.kind === 'damage' ? event.assignment.recipient.kind === 'permanent' ? event.assignment.recipient.cardUuid : undefined
    : 'move' in event ? event.move?.cardUuid : event.kind === 'counter_change' ? event.card.cardUuid : undefined;
  return uuid ? roomCards(room).find(card => card.uuid === uuid) : undefined;
}

export function affectedPlayer(room: GameRoom, event: ProposedEvent): string {
  if ('playerId' in event) return event.playerId;
  if (event.kind === 'damage' && event.assignment.recipient.kind === 'player') return event.assignment.recipient.playerId;
  const card = eventCard(room, event);
  return card ? card.state.zone === 'battlefield' ? CardCharacteristicService.resolveController(room, card) : card.state.ownerId : room.activeTurnPlayerId;
}

export function applicableReplacement(room: GameRoom, event: ProposedEvent, rule: ReplacementDefinition): boolean {
  if (!replacementIsActive(room, rule)) return false;
  const match = rule.match;
  if (match?.kinds && !match.kinds.includes(event.kind)) return false;
  if (match?.playerId && match.playerId !== affectedPlayer(room, event)) return false;
  const card = eventCard(room, event);
  if (match?.card && (!card || card.uuid !== match.card.cardUuid || (card.state.zoneRevision ?? 0) !== match.card.zoneRevision)) return false;
  if (match?.cardTypes && (!card || !match.cardTypes.some(type => CardCharacteristicService.resolveTypes(room, card).includes(type)))) return false;
  if (match?.controllerId && (!card || CardCharacteristicService.resolveController(room, card) !== match.controllerId)) return false;
  if (match?.source && (event.kind !== 'damage' || event.assignment.source.card.uuid !== match.source.cardUuid || (event.assignment.source.card.state.zoneRevision ?? 0) !== match.source.zoneRevision)) return false;
  if (match?.combat !== undefined && (event.kind !== 'damage' || event.assignment.combat !== match.combat)) return false;
  if (match?.from && (!('move' in event) || event.move?.from !== match.from)) return false;
  if (match?.to && (!('move' in event) || event.move?.to !== match.to)) return false;
  const handler = handlers.get(rule.operation.type);
  if (!handler) throw new Error(`No handler for replacement operation: ${rule.operation.type}`);
  return handler.applies(room, event, rule);
}

export function applyReplacement(room: GameRoom, event: ProposedEvent, rule: ReplacementDefinition): ReplacementResult {
  const handler = handlers.get(rule.operation.type);
  if (!handler) throw new Error(`No handler for replacement operation: ${rule.operation.type}`);
  return handler.replace(room, event, rule);
}

registerReplacementOperation('damage_scale', {
  applies: (_room, event, rule) => event.kind === 'damage' && event.assignment.amount > 0 && Number.isSafeInteger(rule.operation.factor) && rule.operation.factor >= 0 && rule.operation.factor !== 1 && Number.isSafeInteger(event.assignment.amount * rule.operation.factor),
  replace: (_room, event, rule) => ({ events: event.kind === 'damage' ? [{ ...event, assignment: { ...event.assignment, amount: event.assignment.amount * rule.operation.factor } }] : [event] }),
});
registerReplacementOperation('prevent_damage', {
  applies: (_room, event, rule) => event.kind === 'damage' && event.assignment.amount > 0 && (rule.operation.amount === undefined || Number.isSafeInteger(rule.operation.amount) && rule.operation.amount > 0),
  replace: (_room, event, rule) => {
    if (event.kind !== 'damage') return { events: [event] };
    if (event.assignment.preventable === false) return { events: [event], prevented: 0 };
    const prevented = Math.min(event.assignment.amount, rule.operation.amount ?? Infinity, rule.remaining ?? Infinity);
    return { events: [{ ...event, assignment: { ...event.assignment, amount: event.assignment.amount - prevented } }], prevented };
  },
});
registerReplacementOperation('redirect_damage', {
  applies: (room, event, rule) => event.kind === 'damage' && event.assignment.amount > 0 && JSON.stringify(event.assignment.recipient) !== JSON.stringify(rule.operation.recipient) &&
    (rule.operation.recipient.kind === 'player' ? !!room.players[rule.operation.recipient.playerId] : room.battlefield.some(card => card.uuid === (rule.operation.recipient as { cardUuid: string }).cardUuid && (card.state.zoneRevision ?? 0) === (rule.operation.recipient as { zoneRevision: number }).zoneRevision)),
  replace: (_room, event, rule) => ({ events: event.kind === 'damage' ? [{ ...event, assignment: { ...event.assignment, recipient: rule.operation.recipient } }] : [event] }),
});
registerReplacementOperation('move_destination', {
  applies: (_room, event, rule) => 'move' in event && !!event.move && event.move.to !== rule.operation.to && event.move.from !== rule.operation.to,
  replace: (_room, event, rule) => ({ events: 'move' in event && event.move ? [{ kind: 'zone_transfer', move: { ...event.move, to: rule.operation.to } }] : [event] }),
});
registerReplacementOperation('cancel_event', { applies: () => true, replace: () => ({ events: [] }) });
registerReplacementOperation('regenerate', {
  applies: (_room, event) => event.kind === 'destroy',
  replace: (room, event) => {
    const card = eventCard(room, event);
    return { events: [], mutations: card ? [{ type: 'REGENERATE_CARD', cardUuid: card.uuid, zoneRevision: card.state.zoneRevision ?? 0 }] : [] };
  },
});

export function builtinReplacements(room: GameRoom, event: ProposedEvent): ReplacementDefinition[] {
  if (event.kind !== 'damage' || event.assignment.recipient.kind !== 'permanent') return [];
  const card = eventCard(room, event);
  return card && protectionApplies(room, card, event.assignment.source.card) ? [{ id: `protection:${card.uuid}:${card.state.zoneRevision ?? 0}`, label: 'Protection', operation: { type: 'prevent_damage' } }] : [];
}

export function eventProhibited(room: GameRoom, event: ProposedEvent): boolean {
  const card = event.kind === 'destroy' ? eventCard(room, event) : undefined;
  return !!card && CardCharacteristicService.resolveKeywords(room, card).some(k => k.toLowerCase() === 'indestructible');
}
