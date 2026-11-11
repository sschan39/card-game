import { abilityEffects } from './ability-effects';
import { EventBus, type GameEvent, type EventContext } from './event-bus';
import { buildStackEffects } from './resolution-planning';
import type { GameMutation } from '../types/game-mutation.types';
import type { GameRoom } from '../types/game.room.types';
import type { CardInstance, CardSnapshot, TriggeredAbility } from '../types/card.types';
import type { StackObject, StackEffect, TriggeringEvent } from '../types/effect.types';
import type { DelayedTrigger } from '../types/trigger.types';
import { captureSourceInformation } from './source-information';
import { triggerMatches } from './trigger-matching';
import { conditionMatches, createRuleContext } from './rule-conditions';
import { abilityUsageAvailable, recordAbilityCommit, withReservedAbilityUses } from './ability-usage';
import { abilityUseKey, newTurnHistory } from './turn-history';
import { collectTriggerCandidates } from './trigger-listeners';
import { createTriggerEventContext, type TriggerRooms } from './trigger-event-context';
import { TRIGGER_EVENTS } from './trigger-events';
import { canPrepareTrigger } from './trigger-preparation';
import { cardObjectKey } from '../shared/card-identity';
import { gameConfig } from '../config';
import { engineLogger } from '../shared/game-logger';

/** A matched, target-eligible ability; discovery never chooses targets or spends uses. */
export interface PendingTrigger {
  ability?: TriggeredAbility;
  source: CardInstance;
  sourceInfo?: CardSnapshot;
  controllerId: string;
  effects: StackEffect[];
  event: TriggeringEvent;
  /** Registration ownership survives source departure and is independent of card discovery zones. */
  registration?: DelayedTrigger;
}

/** Read-only event windows. Battlefield-only inputs remain supported for small discovery fixtures. */
export interface TriggerContext extends TriggerRooms {
  roomId: string;
  battlefield: CardInstance[];
}

/** All source families share matching, after-event predicates, deduplication and target eligibility. */
export function discoverTriggers(
  event: GameEvent,
  context: TriggerContext,
  reserved: GameMutation[] = [],
): PendingTrigger[] {
  const definition = TRIGGER_EVENTS[event.eventId];
  if (!definition) return [];
  const facts = createTriggerEventContext(event, context);
  const pending: PendingTrigger[] = [];
  const discovered = new Set<string>(),
    shared = new Set<string>();
  for (const candidate of collectTriggerCandidates(event, definition, facts, context, reserved)) {
    const { source, sourceInfo, ability, controllerId, subjectInfo, registration } = candidate;
    let identity: (string | undefined)[] = ['entry'];
    if (ability) identity = ['ability', ability.id];
    if (registration) identity = ['delayed', registration.id];
    const key = JSON.stringify([cardObjectKey(source), identity]);
    if ((!ability || ability.id !== undefined || registration) && discovered.has(key)) continue;
    const filter = subjectInfo ? { ...candidate.filter, subject: 'self' as const } : candidate.filter;
    if (!triggerMatches(event, source, filter, controllerId, facts.watcherRoom, subjectInfo)) continue;
    if (ability?.trigger?.condition || ability?.interveningIf) {
      // Only source characteristics come from the listener snapshot. Board,
      // player and history predicates observe the committed after-event state.
      const rules = createRuleContext(
        facts.conditionRoom,
        sourceInfo!.card,
        controllerId,
        facts.event,
        sourceInfo,
      );
      if (!conditionMatches(ability.trigger?.condition, rules) || !conditionMatches(ability.interveningIf, rules))
        continue;
    }
    const effects = buildStackEffects(ability ? abilityEffects(ability) : candidate.effects, controllerId, source);
    const trigger: PendingTrigger = {
      ability,
      source,
      sourceInfo,
      controllerId,
      effects,
      event: facts.event,
      ...(registration ? { registration } : {}),
    };
    if (
      facts.conditionRoom &&
      !canPrepareTrigger(facts.conditionRoom, {
        ...trigger,
        type: 'triggered',
        uuid: '',
        triggeringEvent: facts.event,
        countered: false,
      })
    )
      continue;
    const sharedKey = JSON.stringify([controllerId, source.blueprint.id, ability?.id]);
    if (ability?.sharedPerEvent && shared.has(sharedKey)) continue;
    if (ability?.sharedPerEvent) shared.add(sharedKey);
    discovered.add(key);
    pending.push(trigger);
  }
  return pending;
}

/** Converts eligible discoveries into queue mutations; the existing scheduler owns player choices. */
export class TriggerManager {
  private collector: GameMutation[];
  private generateUuid: () => string;
  private getRoom: () => GameRoom;
  /** Registered (eventId, listener) pairs so dispose() can unregister them. */
  private registered: Array<{ eventId: string; listener: (event: GameEvent) => void }> = [];

  constructor(eventBus: EventBus, collector: GameMutation[], generateUuid: () => string, getRoom: () => GameRoom) {
    this.collector = collector;
    this.generateUuid = generateUuid;
    this.getRoom = getRoom;

    // Register a listener for every event that can produce triggers.
    for (const eventId of Object.keys(TRIGGER_EVENTS)) {
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
    const room = batch?.after ?? this.getRoom();
    const baseline = { ...room, turnHistory: room.turnHistory ?? newTurnHistory(room.turnNumber ?? 1) };
    const ruleRoom = withReservedAbilityUses(baseline, this.collector);
    const pending = discoverTriggers(
      event,
      {
        room: ruleRoom,
        roomId: room.roomId,
        battlefield: room.battlefield,
        before: batch?.before,
        after: ruleRoom,
      },
      this.collector,
    );

    if (gameConfig.logging.appliedEvents) {
      engineLogger
        .withContext({ roomId: room.roomId, commandId: event.commandId, batchId: event.batchId })
        .debug('trigger:received', event.eventId, { eventUuid: event.eventUuid, discovered: pending.length });
    }

    for (const trigger of pending) {
      const registration = trigger.registration;
      const useKey = registration ? 'delayed:' + registration.id : undefined;
      if (this.pushTrigger(trigger, room, useKey) && registration?.lifetime === 'once')
        this.collector.push({ type: 'REMOVE_DELAYED_TRIGGER', id: registration.id });
    }
  }

  /**
   * Queue a PUSH_STACK mutation. The engine publishes its event after application.
   */
  private pushTrigger(
    trigger: PendingTrigger,
    room: GameRoom,
    useKey = abilityUseKey(trigger.source, trigger.ability?.id ?? 'on-enter'),
  ): boolean {
    // Include registration identity: independent delayed listeners can share
    // one source and authored ability ID without suppressing one another.
    const identified = !trigger.ability || trigger.ability.id !== undefined || useKey.startsWith('delayed:');
    const triggerKey =
      trigger.event.eventUuid && identified
        ? JSON.stringify([
            trigger.event.eventUuid,
            trigger.source.uuid,
            trigger.source.state.zone,
            trigger.source.state.zoneRevision ?? 0,
            trigger.ability ? 'ability' : 'entry',
            useKey,
          ])
        : undefined;
    const sameTrigger = (object: StackObject): boolean =>
      object.type === 'triggered' && object.triggerKey === triggerKey;
    if (
      triggerKey &&
      (room.stack.some(sameTrigger) ||
        room.triggerQueue?.entries.some((entry) => sameTrigger(entry.object)) ||
        this.collector.some((mutation) => mutation.type === 'PUSH_STACK' && sameTrigger(mutation.stackObject)))
    )
      return false;
    if (
      trigger.ability &&
      !abilityUsageAvailable(room, trigger.source, trigger.ability, this.collector, trigger.controllerId, useKey)
    )
      return false;

    const stackObj: StackObject = {
      uuid: this.generateUuid(),
      type: 'triggered',
      ...(triggerKey ? { triggerKey } : {}),
      controllerId: trigger.controllerId,
      source: trigger.source,
      sourceInfo: trigger.sourceInfo ?? captureSourceInformation(room, trigger.source),
      ability: trigger.ability,
      effects: trigger.effects,
      triggeringEvent: trigger.event,
      countered: false,
    };

    this.collector.push({ type: 'PUSH_STACK', stackObject: stackObj });
    this.collector.push(...recordAbilityCommit(room, trigger.source, trigger.ability, trigger.controllerId, useKey));

    if (gameConfig.logging.appliedEvents) {
      engineLogger
        .withContext({ roomId: room.roomId, commandId: trigger.event.commandId, batchId: trigger.event.batchId })
        .debug('trigger:queued', trigger.event.eventId, {
          eventUuid: trigger.event.eventUuid,
          stackUuid: stackObj.uuid,
          abilityId: trigger.ability?.id ?? 'on-enter',
          sourceUuid: trigger.source.uuid,
          controllerId: trigger.controllerId,
        });
    }

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
