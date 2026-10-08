// src/engine/trigger-manager.ts
import { EventBus, type GameEvent, type EventContext } from './event-bus';
import { buildStackEffects } from './effect-resolver';
import type { GameMutation } from '../types/game-mutation.types';
import type { GameRoom } from '../types/game.room.types';
import type { CardInstance, TriggeredAbility, TriggerEvent } from '../types/card.types';
import type { StackObject, StackEffect, TriggeringEvent } from '../types/effect.types';
import { captureSourceInformation, resolveSourceInformation } from './source-information';
import { triggerMatches } from './trigger-matching';
import { conditionMatches, createRuleContext } from './rule-conditions';
import { abilityUseKey, newTurnHistory } from './turn-history';
import type { CardSnapshot } from '../types/card.types';

// ============================================================================
// Trigger discovery — read-only
// ============================================================================

/**
 * A pending trigger: the result of trigger discovery. It records WHICH ability
 * triggered, on WHICH source object, controlled by WHOM, with the effects to
 * put on the stack. It does NOT choose targets, resolve effects, or touch the
 * stack — that is the coordinator's job.
 *
 * `ability` is undefined for the legacy `onEnterEffects` path, which has no
 * TriggeredAbility wrapper.
 */
export interface PendingTrigger {
  ability?: TriggeredAbility;
  /** The permanent whose ability triggered (the trigger source). */
  source: CardInstance;
  /** Controller of the triggered ability at the moment it triggered. */
  controllerId: string;
  /** Effects to place on the stack when this trigger is put there. */
  effects: StackEffect[];
  /**
   * The event that caused this trigger. Carried so effects can reference
   * last-known info (the entering card, damage amount, etc.) at resolve time,
   * even after the event's card has changed zones.
   */
  event: TriggeringEvent;
}

/**
 * Narrow, read-only view of game state that trigger discovery needs.
 * Deliberately not the whole GameRoom — discovery only enumerates the
 * battlefield and needs the room id for event emission downstream.
 */
export interface TriggerContext {
  room?: GameRoom;
  roomId: string;
  battlefield: CardInstance[];
}

/**
 * Maps a game event id to the TriggerEvent it corresponds to, plus how to
 * build the set of objects to scan for that event.
 *
 * - `scanBattlefield`: always scan all battlefield permanents (watchers).
 * - `includeEventCard`: also scan the card named in the event payload, even if
 *   it has left the battlefield. This is required for
 *   PERMANENT_LEFT / PERMANENT_DIED; entry events use committed after-state.
 * - `legacyEnter`: also check the legacy `onEnterEffects` field.
 */
interface EventMapping {
  triggerEvent: TriggerEvent;
  scanBattlefield: boolean;
  includeEventCard: boolean;
  legacyEnter?: boolean;
}

const EVENT_MAP: Record<string, EventMapping> = {
  PERMANENT_ENTERED: { triggerEvent: 'ON_ENTER_BATTLEFIELD', scanBattlefield: true, includeEventCard: true, legacyEnter: true },
  PERMANENT_LEFT: { triggerEvent: 'ON_LEAVE_BATTLEFIELD', scanBattlefield: true, includeEventCard: true },
  PERMANENT_DIED: { triggerEvent: 'ON_DIE', scanBattlefield: true, includeEventCard: true },
  ATTACK_DECLARED: { triggerEvent: 'ON_ATTACK', scanBattlefield: true, includeEventCard: true },
  DAMAGE_TAKEN: { triggerEvent: 'ON_DAMAGE_TAKEN', scanBattlefield: true, includeEventCard: true },
  DAMAGE_DEALT: { triggerEvent: 'ON_DAMAGE_DEALT', scanBattlefield: true, includeEventCard: false },
  UPKEEP_STARTED: { triggerEvent: 'BEGIN_UPKEEP', scanBattlefield: true, includeEventCard: false },
  END_STEP_STARTED: { triggerEvent: 'END_OF_TURN', scanBattlefield: true, includeEventCard: false },
  LIFE_GAINED: { triggerEvent: 'ON_LIFE_GAIN', scanBattlefield: true, includeEventCard: false },
  LIFE_LOST: { triggerEvent: 'ON_LIFE_LOSS', scanBattlefield: true, includeEventCard: false },
  CARD_DRAWN: { triggerEvent: 'ON_DRAW', scanBattlefield: true, includeEventCard: false },
  CARD_DISCARDED: { triggerEvent: 'ON_DISCARD', scanBattlefield: true, includeEventCard: false },
  SPELL_CAST: { triggerEvent: 'ON_SPELL_CAST', scanBattlefield: true, includeEventCard: false },
  BLOCK_DECLARED: { triggerEvent: 'ON_BLOCK', scanBattlefield: true, includeEventCard: true },
  COMBAT_DAMAGE_RESOLVED: { triggerEvent: 'COMBAT_DAMAGE', scanBattlefield: true, includeEventCard: false },
};

/**
 * Collect the triggered abilities on a single card that match `triggerEvent`.
 */
function matchingAbilities(
  card: CardInstance,
  triggerEvent: TriggerEvent,
): TriggeredAbility[] {
  const matches: TriggeredAbility[] = [];
  for (const ability of card.blueprint.abilities) {
    if (ability.type === 'triggered' && ability.triggerCondition === triggerEvent) {
      matches.push(ability);
    }
  }
  return matches;
}

/**
 * Build the deduplicated set of objects to scan for a given event.
 * Battlefield permanents (watchers) plus, when required, the event's own card
 * (which may not be on the battlefield at the moment the event fires).
 */
function buildScanSet(event: GameEvent, context: TriggerContext, mapping: EventMapping): CardInstance[] {
  const cards: CardInstance[] = mapping.scanBattlefield ? [...context.battlefield] : [];

  if (mapping.includeEventCard) {
    const eventCard = event.payload.card as CardInstance | undefined;
    if (eventCard && !cards.some(c => c.uuid === eventCard.uuid)) {
      cards.push(eventCard);
    }
  }

  return cards;
}

/**
 * Discover all triggers that fire in response to `event`, given the current
 * game state in `context`.
 *
 * This is a pure, read-only operation: it inspects abilities and returns
 * pending-trigger records. It does not mutate state, choose targets, resolve
 * effects, or push anything onto the stack.
 *
 * Discovery is intentionally a simple scan of the relevant objects rather than
 * a subscription/index registry — correctness first, optimize later.
 */
export function discoverTriggers(event: GameEvent, context: TriggerContext): PendingTrigger[] {
  const mapping = EVENT_MAP[event.eventId];
  if (!mapping) return [];

  const pending: PendingTrigger[] = [];
  const scanSet = buildScanSet(event, context, mapping);
  const triggeringEvent: TriggeringEvent = { eventId: event.eventId, payload: event.payload,
    eventUuid: event.eventUuid, batchId: event.batchId, commandId: event.commandId };

  for (const card of scanSet) {
    const controllerId = card.state.controllerId;

    // Triggered abilities matching the event.
    for (const ability of matchingAbilities(card, mapping.triggerEvent)) {
      if (!triggerMatches(event, card, ability.trigger)) continue;
      if (ability.trigger?.condition || ability.interveningIf) {
        const rules = createRuleContext(context.room, card, controllerId, triggeringEvent);
        if (!conditionMatches(ability.trigger?.condition, rules) || !conditionMatches(ability.interveningIf, rules)) continue;
      }
      pending.push({
        ability,
        source: card,
        controllerId,
        effects: buildStackEffects([ability.effect], controllerId, card),
        event: triggeringEvent,
      });
    }

    // Legacy onEnterEffects path (PERMANENT_ENTERED only). No TriggeredAbility
    // wrapper, so `ability` is left undefined.
    if (mapping.legacyEnter && card.blueprint.onEnterEffects?.length && triggerMatches(event, card, { subject: 'self' })) {
      const legacyEffects = buildStackEffects(card.blueprint.onEnterEffects, controllerId, card);
      if (legacyEffects.length > 0) {
        pending.push({ source: card, controllerId, effects: legacyEffects, event: triggeringEvent });
      }
    }
  }

  return pending;
}

// ============================================================================
// TriggerManager — coordinator
// ============================================================================

/**
 * TriggerManager listens for game events (PERMANENT_ENTERED, etc.), runs
 * read-only trigger discovery against the current game state, and turns each
 * discovered trigger into a PUSH_STACK mutation in a shared collector.
 *
 * Responsibilities (per the trigger/stack separation):
 * - Detection: delegates to `discoverTriggers` (read-only).
 * - Coordination: converts pending triggers into stack mutations and hands
 *   them to the engine via the collector. It does NOT resolve effects or
 *   manage priority — the engine drains the collector and sequences the
 *   mutations through the pure reducer.
 *
 * UUID generation is injected via `generateUuid` so TriggerManager stays pure.
 *
 * `getRoom` is a getter (not a direct reference) because the engine reassigns
 * its `room` after each mutation application.
 */
export class TriggerManager {
  private collector: GameMutation[];
  private generateUuid: () => string;
  private getRoom: () => GameRoom;
  /** Registered (eventId, listener) pairs so dispose() can unregister them. */
  private registered: Array<{ eventId: string; listener: (event: GameEvent) => void }> = [];

  constructor(
    eventBus: EventBus,
    collector: GameMutation[],
    generateUuid: () => string,
    getRoom: () => GameRoom,
  ) {
    this.collector = collector;
    this.generateUuid = generateUuid;
    this.getRoom = getRoom;

    // Register a listener for every event that can produce triggers.
    for (const eventId of Object.keys(EVENT_MAP)) {
      const listener = (event: GameEvent, context?: EventContext) => this.onEvent(event, context);
      eventBus.on(eventId, listener);
      this.registered.push({ eventId, listener });
    }
  }

  /**
   * Handle a game event: discover triggers, then push each onto the stack via
   * the mutation collector.
   */
  private onEvent(event: GameEvent, batch?: EventContext): void {
    const departure = event.eventId === 'PERMANENT_LEFT' || event.eventId === 'PERMANENT_DIED';
    const room = batch ? (departure ? { ...batch.before, turnHistory: batch.after.turnHistory } : batch.after) : this.getRoom();
    // Discovery is read-only. Uses queued by earlier events become visible to
    // this event's predicates, before any ability on this event is discovered.
    const history = room.turnHistory ?? newTurnHistory(room.turnNumber ?? 1), uses = { ...history.uses };
    for (const mutation of this.collector) {
      if (mutation.type === 'RECORD_ABILITY_USE' && (mutation.turnNumber ?? history.turnNumber) === history.turnNumber) uses[mutation.key] = (uses[mutation.key] ?? 0) + 1;
    }
    const ruleRoom = { ...room, turnHistory: { ...history, uses } };
    const context: TriggerContext = { room: ruleRoom, roomId: room.roomId, battlefield: room.battlefield };

    const pending = discoverTriggers(event, context);
    for (const trigger of pending) {
      this.pushTrigger(trigger, room);
    }
    // Registrations exist independently of whether their original source remains
    // on the battlefield. Use the event's state, never a later registration.
    for (const registration of room.delayedTriggers ?? []) {
      if (registration.ability.triggerCondition !== EVENT_MAP[event.eventId]?.triggerEvent ||
          this.collector.some(mutation => mutation.type === 'REMOVE_DELAYED_TRIGGER' && mutation.id === registration.id)) continue;
      if (!triggerMatches(event, registration.source, registration.ability.trigger, registration.controllerId)) continue;
      const info = resolveSourceInformation(room, { type: 'triggered', uuid: registration.id, source: registration.source, sourceInfo: registration.sourceInfo,
        controllerId: registration.controllerId, effects: [], countered: false });
      const triggeringEvent: TriggeringEvent = { eventId: event.eventId, payload: event.payload, eventUuid: event.eventUuid, batchId: event.batchId, commandId: event.commandId };
      const rules = createRuleContext(ruleRoom, info.card, registration.controllerId, triggeringEvent, info);
      if (!conditionMatches(registration.ability.trigger?.condition, rules) || !conditionMatches(registration.ability.interveningIf, rules)) continue;
      if (this.pushTrigger({ ability: registration.ability, source: registration.source, controllerId: registration.controllerId,
        effects: buildStackEffects([registration.ability.effect], registration.controllerId, registration.source), event: triggeringEvent }, room, info, 'delayed:' + registration.id) && registration.lifetime === 'once') {
        this.collector.push({ type: 'REMOVE_DELAYED_TRIGGER', id: registration.id });
      }
    }
  }

  /**
   * Queue a PUSH_STACK mutation. The engine publishes its event after application.
   */
  private pushTrigger(trigger: PendingTrigger, room: GameRoom, sourceInfo?: CardSnapshot, useKey = abilityUseKey(trigger.source, trigger.ability?.id ?? 'legacy')): boolean {
    const limit = trigger.ability?.limitPerTurn;
    const turnNumber = room.turnNumber ?? 1;
    const reserved = this.collector.filter(mutation => mutation.type === 'RECORD_ABILITY_USE' && mutation.key === useKey && (mutation.turnNumber ?? turnNumber) === turnNumber).length;
    if (limit !== undefined && (!Number.isSafeInteger(limit) || limit < 1 || (room.turnHistory?.uses[useKey] ?? 0) + reserved >= limit)) return false;
    const stackObj: StackObject = {
      uuid: this.generateUuid(),
      type: 'triggered',
      controllerId: trigger.controllerId,
      source: trigger.source,
      sourceInfo: sourceInfo ?? captureSourceInformation(room, trigger.source),
      ability: trigger.ability,
      effects: trigger.effects,
      triggeringEvent: trigger.event,
      countered: false,
    };

    this.collector.push({ type: 'PUSH_STACK', stackObject: stackObj });
    this.collector.push({ type: 'RECORD_ABILITY_USE', key: useKey, turnNumber });
    return true;
  }

  /**
   * Unregister all listeners from the EventBus. Call when the room is
   * destroyed to prevent listener leaks.
   */
  dispose(eventBus: EventBus): void {
    for (const { eventId, listener } of this.registered) {
      eventBus.off(eventId, listener);
    }
    this.registered = [];
  }
}
