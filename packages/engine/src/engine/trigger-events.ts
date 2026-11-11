import type { TriggerEvent } from '../types/card.types';

/** Event semantics shared by discovery, subject snapshots and filter defaults. */
export interface TriggerEventDefinition {
  triggerEvent: TriggerEvent;
  watcherState: 'before' | 'after';
  subject: 'arrival' | 'departure' | 'current' | 'observation' | 'none';
  /** Admission adapter for old saved/in-memory abilities without a listener. */
  implicit: 'battlefield' | 'battlefield_and_subject' | 'subject';
  personal?: boolean;
  entryEffects?: boolean;
}

/** One table owns event windows; adding a trigger no longer requires parallel event-name lists. */
export const TRIGGER_EVENTS: Readonly<Record<string, TriggerEventDefinition>> = {
  CREATURE_KILLED: { triggerEvent: 'ON_KILL', watcherState: 'before', subject: 'departure', implicit: 'battlefield' },
  CHARACTERISTICS_CHANGED: {
    triggerEvent: 'ON_CHARACTERISTICS_CHANGED',
    watcherState: 'after',
    subject: 'current',
    implicit: 'battlefield_and_subject',
  },
  CARD_REVEALED: { triggerEvent: 'ON_REVEAL', watcherState: 'after', subject: 'observation', implicit: 'subject' },
  PERMANENT_ENTERED: {
    triggerEvent: 'ON_ENTER_BATTLEFIELD',
    watcherState: 'after',
    subject: 'arrival',
    implicit: 'battlefield_and_subject',
    entryEffects: true,
  },
  PERMANENT_LEFT: {
    triggerEvent: 'ON_LEAVE_BATTLEFIELD',
    watcherState: 'before',
    subject: 'departure',
    implicit: 'battlefield_and_subject',
  },
  PERMANENT_DIED: {
    triggerEvent: 'ON_DIE',
    watcherState: 'before',
    subject: 'departure',
    implicit: 'battlefield_and_subject',
  },
  PERMANENT_DESTROYED: {
    triggerEvent: 'ON_DESTROY',
    watcherState: 'before',
    subject: 'departure',
    implicit: 'battlefield_and_subject',
  },
  ATTACK_DECLARED: {
    triggerEvent: 'ON_ATTACK',
    watcherState: 'after',
    subject: 'current',
    implicit: 'battlefield_and_subject',
  },
  DAMAGE_TAKEN: {
    triggerEvent: 'ON_DAMAGE_TAKEN',
    watcherState: 'after',
    subject: 'current',
    implicit: 'battlefield_and_subject',
  },
  PERMANENT_TARGETED: { triggerEvent: 'ON_EFFECT_TARGETED', watcherState: 'after', subject: 'current', implicit: 'battlefield' },
  DAMAGE_DEALT: { triggerEvent: 'ON_DAMAGE_DEALT', watcherState: 'after', subject: 'current', implicit: 'battlefield' },
  DRAW_STEP_STARTED: { triggerEvent: 'BEGIN_DRAW_STEP', watcherState: 'after', subject: 'none', implicit: 'battlefield' },
  PERMANENT_TAPPED: { triggerEvent: 'ON_TAP', watcherState: 'after', subject: 'current', implicit: 'battlefield_and_subject' },
  UPKEEP_STARTED: { triggerEvent: 'BEGIN_UPKEEP', watcherState: 'after', subject: 'none', implicit: 'battlefield' },
  END_STEP_STARTED: { triggerEvent: 'END_OF_TURN', watcherState: 'after', subject: 'none', implicit: 'battlefield' },
  LIFE_GAINED: { triggerEvent: 'ON_LIFE_GAIN', watcherState: 'after', subject: 'none', implicit: 'battlefield' },
  LIFE_LOST: { triggerEvent: 'ON_LIFE_LOSS', watcherState: 'after', subject: 'none', implicit: 'battlefield' },
  CARD_DRAWN: {
    triggerEvent: 'ON_DRAW',
    watcherState: 'after',
    subject: 'arrival',
    implicit: 'battlefield',
    personal: true,
  },
  LIBRARY_SHUFFLED: { triggerEvent: 'ON_SHUFFLE', watcherState: 'after', subject: 'none', implicit: 'battlefield' },
  CARD_DISCARDED_FROM_HAND: {
    triggerEvent: 'ON_DISCARD_FROM_HAND',
    watcherState: 'after',
    subject: 'departure',
    implicit: 'battlefield',
    personal: true,
  },
  CARD_DISCARDED_FROM_LIBRARY: {
    triggerEvent: 'ON_DISCARD_FROM_LIBRARY',
    watcherState: 'after',
    subject: 'departure',
    implicit: 'battlefield',
    personal: true,
  },
  COUNTER_CHANGED: {
    triggerEvent: 'ON_COUNTER_CHANGED',
    watcherState: 'after',
    subject: 'current',
    implicit: 'battlefield',
  },
  SPELL_CAST: {
    triggerEvent: 'ON_SPELL_CAST',
    watcherState: 'after',
    subject: 'arrival',
    implicit: 'battlefield',
    personal: true,
  },
  BLOCK_DECLARED: {
    triggerEvent: 'ON_BLOCK',
    watcherState: 'after',
    subject: 'current',
    implicit: 'battlefield_and_subject',
  },
  COMBAT_DAMAGE_RESOLVED: {
    triggerEvent: 'COMBAT_DAMAGE',
    watcherState: 'after',
    subject: 'none',
    implicit: 'battlefield',
  },
};
