// src/engine/trigger-manager.ts
import { EventBus } from './event-bus';
import { v4 as uuidv4 } from 'uuid';
import { buildStackEffects } from './effect-resolver';
import type { GameRoom } from '../types/game.room.types';
import type { CardInstance } from '../types/card.types';
import type { StackObject, StackEffect } from '../types/effect.types';

export class TriggerManager {
  constructor(eventBus: EventBus, room: GameRoom) {
    // ETB triggers
    eventBus.on('PERMANENT_ENTERED', (event) => {
      const card = event.payload.card as CardInstance;
      const onEnterEffects = card.onEnterEffects;
      if (!onEnterEffects?.length) return;

      const controllerId = (card.state.controllerId || event.payload.controllerId) as string;
      const effects = buildStackEffects(onEnterEffects, controllerId);

      const stackObj: StackObject = {
        uuid: uuidv4(),
        type: 'triggered',
        controllerId,
        source: card,
        effects,
        timestamp: Date.now(),
        countered: false,
      };

      room.stack.push(stackObj);

      eventBus.emit({
        eventId: 'ACTION_PROPOSED',
        roomId: room.roomId,
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