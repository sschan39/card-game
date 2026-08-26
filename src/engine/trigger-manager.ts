// src/engine/trigger-manager.ts
import { EventBus } from './event-bus';
import { buildStackEffects } from './effect-resolver';
import type { GameMutation } from '../types/game-mutation.types';
import type { GameRoom } from '../types/game.room.types';
import type { CardInstance } from '../types/card.types';
import type { StackObject } from '../types/effect.types';

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

  constructor(eventBus: EventBus, collector: GameMutation[], generateUuid: () => string) {
    this.collector = collector;
    this.generateUuid = generateUuid;

    // ETB triggers
    eventBus.on('PERMANENT_ENTERED', (event) => {
      const card = event.payload.card as CardInstance;
      const onEnterEffects = card.blueprint.onEnterEffects;
      if (!onEnterEffects?.length) return;

      const controllerId = (card.state.controllerId || event.payload.controllerId) as string;
      const effects = buildStackEffects(onEnterEffects, controllerId);

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
    });

    // Future:
    // PERMANENT_LEFT → death triggers
    // LIFE_CHANGED → life-gain triggers
    // TURN_STARTED → upkeep triggers
    // PHASE_CHANGED → beginning-of-combat triggers
  }
}