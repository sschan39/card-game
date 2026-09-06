// src/engine/trigger-manager.ts
import { EventBus } from './event-bus';
import { buildStackEffects } from './effect-resolver';
import type { GameMutation } from '../types/game-mutation.types';
import type { GameRoom } from '../types/game.room.types';
import type { CardInstance, TriggeredAbility, TriggerEvent } from '../types/card.types';
import type { StackObject, StackEffect } from '../types/effect.types';

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
 * Scan a card's abilities for triggered abilities matching the given event.
 * Returns StackEffects for each matching ability.
 */
function getMatchingTriggers(card: CardInstance, event: TriggerEvent, controllerId: string): StackEffect[] {
  const effects: StackEffect[] = [];
  for (const ability of card.blueprint.abilities) {
    if (ability.type === 'triggered' && ability.triggerCondition === event) {
      effects.push(...buildTriggeredEffects(ability, controllerId));
    }
  }
  return effects;
}

/**
 * TriggerManager listens for game events (PERMANENT_ENTERED, etc.) and
 * produces triggered StackObjects. Instead of mutating room.stack directly,
 * it pushes PUSH_STACK mutations into a shared mutation collector array.
 *
 * The engine drains the collector after event dispatch and sequences
 * those mutations through the pure reducer.
 *
 * UUID generation is injected via the generateUuid callback — the engine
 * provides this at the boundary so TriggerManager stays pure.
 */
export class TriggerManager {
  private collector: GameMutation[];
  private generateUuid: () => string;
  /** Registered (eventId, listener) pairs so dispose() can unregister them. */
  private registered: Array<{ eventId: string; listener: (event: import('./event-bus').GameEvent) => void }> = [];

  constructor(eventBus: EventBus, collector: GameMutation[], generateUuid: () => string) {
    this.collector = collector;
    this.generateUuid = generateUuid;

    // Helper: register a trigger listener for a given event
    const onTrigger = (eventId: string, triggerEvent: TriggerEvent) => {
      const listener = (event: import('./event-bus').GameEvent) => {
        const card = event.payload.card as CardInstance | undefined;
        // Events without a card (e.g. LIFE_CHANGED, TURN_STARTED) carry no
        // source permanent to scan for triggers — skip them.
        if (!card) return;
        const controllerId = (card.state.controllerId || event.payload.controllerId) as string;
        const effects = getMatchingTriggers(card, triggerEvent, controllerId);

        // Also check legacy onEnterEffects for PERMANENT_ENTERED
        if (triggerEvent === 'ON_ENTER_BATTLEFIELD' && card.blueprint.onEnterEffects?.length) {
          effects.push(...buildStackEffects(card.blueprint.onEnterEffects, controllerId));
        }

        if (effects.length === 0) return;

        const stackObj: StackObject = {
          uuid: this.generateUuid(),
          type: 'triggered',
          controllerId,
          source: card,
          effects,
          countered: false,
        };

        this.collector.push({ type: 'PUSH_STACK', stackObject: stackObj });

        eventBus.emit({
          eventId: 'ACTION_PROPOSED',
          roomId: event.roomId,
          payload: { actionType: 'triggered', playerId: controllerId, stackObj },
        });
      };
      eventBus.on(eventId, listener);
      this.registered.push({ eventId, listener });
    };

    // Register all trigger event listeners
    onTrigger('PERMANENT_ENTERED', 'ON_ENTER_BATTLEFIELD');
    onTrigger('PERMANENT_LEFT', 'ON_LEAVE_BATTLEFIELD');
    onTrigger('ATTACK_DECLARED', 'ON_ATTACK');
    onTrigger('TURN_STARTED', 'BEGIN_UPKEEP');
    onTrigger('LIFE_CHANGED', 'ON_LIFE_GAIN');
    onTrigger('PERMANENT_DIED', 'ON_DIE');
    onTrigger('DAMAGE_TAKEN', 'ON_DAMAGE_TAKEN');
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