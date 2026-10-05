// src/engine/trigger-manager.ts
import { EventBus, type GameEvent } from './event-bus';
import { buildStackEffects } from './effect-resolver';
import type { GameMutation } from '../types/game-mutation.types';
import type { GameRoom } from '../types/game.room.types';
import type { CardInstance, TriggeredAbility, TriggerEvent } from '../types/card.types';
import type { StackObject, StackEffect } from '../types/effect.types';

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
}

/**
 * Narrow, read-only view of game state that trigger discovery needs.
 * Deliberately not the whole GameRoom — discovery only enumerates the
 * battlefield and needs the room id for event emission downstream.
 */
export interface TriggerContext {
  roomId: string;
  battlefield: CardInstance[];
}

/**
 * Maps a game event id to the TriggerEvent it corresponds to, plus how to
 * build the set of objects to scan for that event.
 *
 * - `scanBattlefield`: always scan all battlefield permanents (watchers).
 * - `includeEventCard`: also scan the card named in the event payload, even if
 *   it is not (yet) on the battlefield. This is required for PERMANENT_ENTERED
 *   (the card enters before the MOVE_CARD mutation is applied) and for
 *   PERMANENT_LEFT / PERMANENT_DIED (the card has already left the battlefield).
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
  TURN_STARTED: { triggerEvent: 'BEGIN_UPKEEP', scanBattlefield: true, includeEventCard: false },
  LIFE_CHANGED: { triggerEvent: 'ON_LIFE_GAIN', scanBattlefield: true, includeEventCard: false },
};

/**
 * Build StackEffects from a TriggeredAbility's effect payload.
 * Converts the legacy EffectPayload format to StackEffect[].
 */
function buildTriggeredEffects(ability: TriggeredAbility, controllerId: string): StackEffect[] {
  return [{
    action: ability.effect.effectId,
    params: ability.effect.params || {},
    tags: [],
    targets: [{ targetType: 'player', playerId: controllerId }],
  }];
}

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

  for (const card of scanSet) {
    const controllerId = card.state.controllerId;

    // Triggered abilities matching the event.
    for (const ability of matchingAbilities(card, mapping.triggerEvent)) {
      pending.push({
        ability,
        source: card,
        controllerId,
        effects: buildTriggeredEffects(ability, controllerId),
      });
    }

    // Legacy onEnterEffects path (PERMANENT_ENTERED only). No TriggeredAbility
    // wrapper, so `ability` is left undefined.
    if (mapping.legacyEnter && card.blueprint.onEnterEffects?.length) {
      const legacyEffects = buildStackEffects(card.blueprint.onEnterEffects, controllerId);
      if (legacyEffects.length > 0) {
        pending.push({ source: card, controllerId, effects: legacyEffects });
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
      const listener = (event: GameEvent) => this.onEvent(eventBus, event);
      eventBus.on(eventId, listener);
      this.registered.push({ eventId, listener });
    }
  }

  /**
   * Handle a game event: discover triggers, then push each onto the stack via
   * the mutation collector.
   */
  private onEvent(eventBus: EventBus, event: GameEvent): void {
    const room = this.getRoom();
    const context: TriggerContext = { roomId: room.roomId, battlefield: room.battlefield };

    const pending = discoverTriggers(event, context);
    for (const trigger of pending) {
      this.pushTrigger(eventBus, room.roomId, trigger);
    }
  }

  /**
   * Convert a pending trigger into a PUSH_STACK mutation and emit the
   * ACTION_PROPOSED event for observers.
   */
  private pushTrigger(eventBus: EventBus, roomId: string, trigger: PendingTrigger): void {
    const stackObj: StackObject = {
      uuid: this.generateUuid(),
      type: 'triggered',
      controllerId: trigger.controllerId,
      source: trigger.source,
      ability: trigger.ability,
      effects: trigger.effects,
      countered: false,
    };

    this.collector.push({ type: 'PUSH_STACK', stackObject: stackObj });

    eventBus.emit({
      eventId: 'ACTION_PROPOSED',
      roomId,
      payload: { actionType: 'triggered', playerId: trigger.controllerId, stackObj },
    });
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