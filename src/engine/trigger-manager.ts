// src/engine/trigger-manager.ts
import { EventBus } from './event-bus';
import { v4 as uuidv4 } from 'uuid';
import type { GameRoom } from '../types/game.room.types';
import type { CardInstance } from '../types/card.types';
import type { StackObject, StackEffect, EffectDefinition, TargetPointer } from '../types/effect.types';

function buildStackEffects(definitions: EffectDefinition[]): StackEffect[] {
  return definitions.map(def => {
    const targets: TargetPointer[] = [];
    if (def.targeting.type === 'self') {
      // Auto-target the controller — will be filled by TriggerManager
      targets.push({ targetType: 'player', playerId: '' }); // placeholder, filled below
    }
    return {
      action: def.action,
      params: def.params,
      tags: def.tags || [],
      targets,
    };
  });
}

function fillSelfTargets(effects: StackEffect[], controllerId: string): void {
  for (const effect of effects) {
    for (const target of effect.targets) {
      if (target.targetType === 'player' && target.playerId === '') {
        target.playerId = controllerId;
      }
    }
  }
}

export class TriggerManager {
  constructor(eventBus: EventBus, room: GameRoom) {
    // ETB triggers
    eventBus.on('PERMANENT_ENTERED', (event) => {
      const card = event.payload.card as CardInstance;
      const onEnterEffects = (card as any).onEnterEffects as EffectDefinition[] | undefined;
      if (!onEnterEffects?.length) return;

      const effects = buildStackEffects(onEnterEffects);
      const controllerId = (card.state.controllerId || event.payload.controllerId) as string;
      fillSelfTargets(effects, controllerId);

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