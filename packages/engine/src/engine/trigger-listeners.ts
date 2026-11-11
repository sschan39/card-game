import { CARD_ZONES } from '../types/card.types';
import { counterRulesFor } from '../rules/runtime/counter-rules';
import type {
  CardInstance,
  CardSnapshot,
  CardZone,
  TriggerEvent,
  TriggeredAbility,
  TriggerFilter,
} from '../types/card.types';
import type { EffectDefinition } from '../types/effect.types';
import type { DelayedTrigger } from '../types/trigger.types';
import type { GameMutation } from '../types/game-mutation.types';
import type { GameEvent } from './event-bus';
import type { TriggerEventDefinition } from './trigger-events';
import type { TriggerRooms, TriggerEventContext } from './trigger-event-context';
import { roomCards } from './continuous-effect-state';
import { withCharacteristicCache } from './card-characteristic-service';
import { captureSourceInformation, resolveSourceInformation } from './source-information';
import { sameCardObject, cardObjectKey } from '../shared/card-identity';

/** Discovery records source ownership; filtering, usage and queueing happen downstream. */
export interface TriggerCandidate {
  source: CardInstance;
  sourceInfo?: CardSnapshot;
  ability?: TriggeredAbility;
  controllerId: string;
  filter?: TriggerFilter;
  /** An event-card listener compares against its selected subject snapshot. */
  subjectInfo?: CardSnapshot;
  effects?: EffectDefinition[];
  registration?: DelayedTrigger;
}

interface ListenerHints {
  zones: Set<CardZone>;
  eventCard: boolean;
}
// Cache immutable definition metadata only; no room instances or subscriptions.
const definitionHints = new WeakMap<object, Map<string, ListenerHints>>();
/** Inspect nested grants/copies conservatively; this cache never authorizes an ability by itself. */
function listenerHints(value: unknown, triggerEvent: TriggerEvent): ListenerHints {
  const hints: ListenerHints = { zones: new Set(), eventCard: false };
  if (!value || typeof value !== 'object') return hints;
  const cached = definitionHints.get(value)?.get(triggerEvent);
  if (cached) return cached;
  const record = value as Record<string, unknown>;
  hints.eventCard = record.kind === 'event_card';
  if (record.kind === 'watcher' && Array.isArray(record.activeZones))
    for (const zone of record.activeZones) hints.zones.add(zone as CardZone);
  // Text effects can change authored zone words before discovery. Conservative
  // hints only select candidates; effective abilities still decide eligibility.
  if (record.type === 'TEXT') {
    hints.eventCard = true;
    for (const zone of CARD_ZONES)
      hints.zones.add(zone);
  }
  for (const [key, child] of Object.entries(record)) {
    // Another event's listener cannot expand this scan, but its effects may
    // contain grants for this event and must still be inspected.
    if (key === 'trigger' && record.triggerCondition !== triggerEvent) continue;
    const nested = listenerHints(child, triggerEvent);
    hints.eventCard ||= nested.eventCard;
    for (const zone of nested.zones) hints.zones.add(zone);
  }
  const byEvent = definitionHints.get(value) ?? new Map<string, ListenerHints>();
  byEvent.set(triggerEvent, hints);
  definitionHints.set(value, byEvent);
  return hints;
}
/** Over-approximate only candidate zones; effective abilities decide actual admission. */
function discoveryHints(rooms: TriggerRooms, context: TriggerEventContext, triggerEvent: TriggerEvent): ListenerHints {
  const definitions = new Set<object>();
  for (const room of new Set([rooms.room, rooms.before, rooms.after])) {
    if (!room) continue;
    for (const card of roomCards(room)) {
      definitions.add(card.blueprint);
      for (const counter of counterRulesFor(card)) definitions.add(counter.effects);
    }
    for (const entry of room.continuousEffectPool) definitions.add(entry);
  }
  for (const info of [context.snapshots.before, context.snapshots.after]) if (info) definitions.add(info.card);
  const hints: ListenerHints = { zones: new Set(), eventCard: false };
  for (const definition of definitions) {
    const nested = listenerHints(definition, triggerEvent);
    hints.eventCard ||= nested.eventCard;
    for (const zone of nested.zones) hints.zones.add(zone);
  }
  return hints;
}

/** Share one ability loop for live watchers, retained event cards and older in-memory definitions. */
function cardCandidates(
  info: CardSnapshot,
  definition: TriggerEventDefinition,
  admits: (ability: TriggeredAbility) => boolean,
  subjectInfo?: CardSnapshot,
): TriggerCandidate[] {
  const abilities = info.card.lastKnownCharacteristics?.abilities ?? info.card.blueprint.abilities;
  return abilities.flatMap((ability) => {
    if (ability.type !== 'triggered' || ability.triggerCondition !== definition.triggerEvent || !admits(ability))
      return [];
    return [
      {
        source: info.card,
        sourceInfo: info,
        ability,
        filter: ability.trigger,
        controllerId: info.card.state.controllerId,
        ...(subjectInfo ? { subjectInfo } : {}),
      },
    ];
  });
}

/** Explicit policy is authoritative. Omitted listeners are an admission adapter for old saved/test data only. */
function admitsWatcher(
  card: CardInstance,
  ability: TriggeredAbility,
  definition: TriggerEventDefinition,
  battlefield: CardInstance[],
  eventCard?: CardInstance,
): boolean {
  const listener = ability.trigger?.listener;
  if (listener) return listener.kind === 'watcher' && listener.activeZones.includes(card.state.zone);
  const onBoard = battlefield.some((live) => sameCardObject(live, card));
  const isSubject = !!eventCard && sameCardObject(card, eventCard);
  return (definition.implicit !== 'subject' && onBoard) || (definition.implicit !== 'battlefield' && isSubject);
}

/** Enumerate source families only; every result uses the same event facts and evaluator. */
export function collectTriggerCandidates(
  event: GameEvent,
  definition: TriggerEventDefinition,
  context: TriggerEventContext,
  rooms: TriggerRooms & { battlefield: CardInstance[] },
  reserved: GameMutation[] = [],
): TriggerCandidate[] {
  const candidates: TriggerCandidate[] = [];
  const hints = discoveryHints(rooms, context, definition.triggerEvent);
  const room = context.watcherRoom;
  const battlefield = room?.battlefield ?? rooms.battlefield;
  const eventCard = event.payload.card as CardInstance | undefined;
  const collectWatchers = (): void => {
    const inventory = new Map<string, CardInstance>();
    const cards = room ? roomCards(room) : battlefield;
    for (const card of cards)
      if (card.state.zone === 'battlefield' || hints.zones.has(card.state.zone))
        inventory.set(cardObjectKey(card), card);
    // Old synthetic departure fixtures may retain the only copy in the payload.
    // A live newer incarnation must never be replaced by that stale copy, so the
    // guard compares against the candidate inventory rather than every room card:
    // a payload card that no zone hint admitted is still the only copy we have.
    if (
      definition.implicit !== 'battlefield' &&
      eventCard &&
      ![...inventory.values()].some((card) => card.uuid === eventCard.uuid)
    )
      inventory.set(cardObjectKey(eventCard), eventCard);
    for (const card of inventory.values()) {
      const info = room
        ? captureSourceInformation(room, card)
        : {
            card,
            power: card.blueprint.power ?? 0,
            toughness: card.blueprint.toughness ?? 0,
          };
      candidates.push(
        ...cardCandidates(
          info,
          definition,
          (ability) =>
            (cards.some((live) => sameCardObject(live, card)) || !ability.trigger?.listener) &&
            admitsWatcher(card, ability, definition, battlefield, eventCard),
        ),
      );
      // Entry shorthand is a candidate adapter, so it shares eligibility and accounting.
      const entry = info.card.lastKnownCharacteristics?.onEnterEffects ?? card.blueprint.onEnterEffects;
      if (definition.entryEffects && eventCard && sameCardObject(card, eventCard) && entry?.length)
        candidates.push({
          source: info.card,
          sourceInfo: info,
          controllerId: info.card.state.controllerId,
          filter: { subject: 'self' },
          effects: entry,
        });
    }
  };
  if (room) withCharacteristicCache(room, collectWatchers);
  else collectWatchers();

  for (const state of hints.eventCard ? (['before', 'after'] as const) : []) {
    const info = context.snapshots[state];
    if (!info) continue;
    candidates.push(
      ...cardCandidates(
        info,
        definition,
        (ability) => {
          const listener = ability.trigger?.listener;
          return (
            listener?.kind === 'event_card' && listener.state === state && listener.zones.includes(info.card.state.zone)
          );
        },
        info,
      ),
    );
  }

  // A delayed registration survives source departure; its own identity/lifetime
  // must not be substituted with a live card's active-zone rule.
  for (const registration of room?.delayedTriggers ?? []) {
    if (
      registration.ability.triggerCondition !== definition.triggerEvent ||
      reserved.some((m) => m.type === 'REMOVE_DELAYED_TRIGGER' && m.id === registration.id)
    )
      continue;
    const info = resolveSourceInformation(room!, {
      type: 'triggered',
      uuid: registration.id,
      source: registration.source,
      sourceInfo: registration.sourceInfo,
      controllerId: registration.controllerId,
      effects: [],
      countered: false,
    });
    candidates.push({
      source: registration.source,
      sourceInfo: info,
      ability: registration.ability,
      filter: registration.ability.trigger,
      controllerId: registration.controllerId,
      registration,
    });
  }
  return candidates;
}
