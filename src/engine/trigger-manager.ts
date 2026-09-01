// src/engine/trigger-manager.ts
import { EventBus } from './event-bus';
import { buildStackEffects } from './effect-resolver';
import type { GameMutation } from '../types/game-mutation.types';
import type { GameRoom } from '../types/game.room.types';
import type { CardInstance, TriggeredAbility } from '../types/card.types';
import type { StackObject, StackEffect } from '../types/effect.types';

/** Convert a TriggeredAbility's EffectPayload into a StackEffect (self-target). */
function triggeredEffectToStackEffect(ability: TriggeredAbility, controllerId: string): StackEffect {
  return {
    action: ability.effect.effectId,
    params: ability.effect.params ?? {},
    tags: [],
    targets: [{ targetType: 'player', playerId: controllerId }],
  };
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

    // Death / leave triggers: when a permanent leaves the battlefield
    // (destroyed, sacrificed, lethal damage), fire its ON_DIE / ON_LEAVE_BATTLEFIELD
    // triggered abilities by pushing a triggered StackObject.
    eventBus.on('PERMANENT_LEFT', (event) => {
      const card = event.payload.card as CardInstance;
      const controllerId = (card.state.controllerId || event.payload.controllerId) as string;
      const deathAbilities = (card.blueprint.abilities as TriggeredAbility[])
        .filter(a => a.type === 'triggered'
          && (a.triggerCondition === 'ON_DIE' || a.triggerCondition === 'ON_LEAVE_BATTLEFIELD'))
        .map(a => triggeredEffectToStackEffect(a, controllerId));
      if (deathAbilities.length === 0) return;

      const stackObj: StackObject = {
        uuid: this.generateUuid(),
        type: 'triggered',
        controllerId,
        source: card,
        effects: deathAbilities,
        countered: false,
      };

      this.collector.push({ type: 'PUSH_STACK', stackObject: stackObj });

      eventBus.emit({
        eventId: 'ACTION_PROPOSED',
        roomId: event.roomId,
        payload: { actionType: 'triggered-death', playerId: controllerId, stackObj },
      });
    });

    // Upkeep triggers: when the turn passes to a new player, every permanent
    // they control with a BEGIN_UPKEEP triggered ability fires.
    eventBus.on('TURN_SWITCHED', (event) => {
      const nextPlayerId = event.payload.newPlayer as string;
      const battlefield = (event.payload.battlefield as CardInstance[]) ?? [];
      const triggered: StackEffect[] = [];
      for (const card of battlefield) {
        if (card.state.controllerId !== nextPlayerId) continue;
        const controllerId = card.state.controllerId || '';
        const upkeepAbilities = (card.blueprint.abilities as TriggeredAbility[])
          .filter(a => a.type === 'triggered' && a.triggerCondition === 'BEGIN_UPKEEP')
          .map(a => triggeredEffectToStackEffect(a, controllerId));
        triggered.push(...upkeepAbilities);
      }
      if (triggered.length === 0) return;

      const stackObj: StackObject = {
        uuid: this.generateUuid(),
        type: 'triggered',
        controllerId: nextPlayerId,
        source: { uuid: 'upkeep-trigger', blueprint: { id: 'upkeep-trigger', name: 'Upkeep Trigger', cardTypes: [], castRequirements: { allowedZones: ['stack'], speed: 'instant' }, rulesText: '', abilities: [] }, state: { zone: 'stack', ownerId: nextPlayerId, controllerId: nextPlayerId, isTapped: false, summoningSickness: false, damageTaken: 0, counters: {} } },
        effects: triggered,
        countered: false,
      };

      this.collector.push({ type: 'PUSH_STACK', stackObject: stackObj });

      eventBus.emit({
        eventId: 'ACTION_PROPOSED',
        roomId: event.roomId,
        payload: { actionType: 'triggered-upkeep', playerId: nextPlayerId, stackObj },
      });
    });

    // End-of-turn triggers: when the current player's turn is ending
    // (TURN_ENDING, fired just before the switch), every permanent they control
    // with an END_OF_TURN triggered ability fires at the end of their turn.
    eventBus.on('TURN_ENDING', (event) => {
      const currentPlayer = event.payload.currentPlayer as string;
      const battlefield = (event.payload.battlefield as CardInstance[]) ?? [];
      const triggered: StackEffect[] = [];
      for (const card of battlefield) {
        if (card.state.controllerId !== currentPlayer) continue;
        const controllerId = card.state.controllerId || '';
        const endTurnAbilities = (card.blueprint.abilities as TriggeredAbility[])
          .filter(a => a.type === 'triggered' && a.triggerCondition === 'END_OF_TURN')
          .map(a => triggeredEffectToStackEffect(a, controllerId));
        triggered.push(...endTurnAbilities);
      }
      if (triggered.length === 0) return;

      const stackObj: StackObject = {
        uuid: this.generateUuid(),
        type: 'triggered',
        controllerId: currentPlayer,
        source: { uuid: 'end-turn-trigger', blueprint: { id: 'end-turn-trigger', name: 'End of Turn Trigger', cardTypes: [], castRequirements: { allowedZones: ['stack'], speed: 'instant' }, rulesText: '', abilities: [] }, state: { zone: 'stack', ownerId: currentPlayer, controllerId: currentPlayer, isTapped: false, summoningSickness: false, damageTaken: 0, counters: {} } },
        effects: triggered,
        countered: false,
      };

      this.collector.push({ type: 'PUSH_STACK', stackObject: stackObj });

      eventBus.emit({
        eventId: 'ACTION_PROPOSED',
        roomId: event.roomId,
        payload: { actionType: 'triggered-end-turn', playerId: currentPlayer, stackObj },
      });
    });

    // Life-gain triggers: when a player gains life (LIFE_CHANGED; engine emits it
    // after any mutation batch that raised a player's life total), every
    // permanent they control with an ON_LIFE_GAIN triggered ability fires.
    eventBus.on('LIFE_CHANGED', (event) => {
      const playerId = event.payload.playerId as string;
      const battlefield = (event.payload.battlefield as CardInstance[]) ?? [];
      const triggered: StackEffect[] = [];
      for (const card of battlefield) {
        if (card.state.controllerId !== playerId) continue;
        const gainAbilities = (card.blueprint.abilities as TriggeredAbility[])
          .filter(a => a.type === 'triggered' && a.triggerCondition === 'ON_LIFE_GAIN')
          .map(a => triggeredEffectToStackEffect(a, playerId));
        triggered.push(...gainAbilities);
      }
      if (triggered.length === 0) return;

      const stackObj: StackObject = {
        uuid: this.generateUuid(),
        type: 'triggered',
        controllerId: playerId,
        source: { uuid: 'life-gain-trigger', blueprint: { id: 'life-gain-trigger', name: 'Life Gain Trigger', cardTypes: [], castRequirements: { allowedZones: ['stack'], speed: 'instant' }, rulesText: '', abilities: [] }, state: { zone: 'stack', ownerId: playerId, controllerId: playerId, isTapped: false, summoningSickness: false, damageTaken: 0, counters: {} } },
        effects: triggered,
        countered: false,
      };

      this.collector.push({ type: 'PUSH_STACK', stackObject: stackObj });

      eventBus.emit({
        eventId: 'ACTION_PROPOSED',
        roomId: event.roomId,
        payload: { actionType: 'triggered-life-gain', playerId, stackObj },
      });
    });

    // Future:
    // PHASE_CHANGED → beginning-of-combat triggers
  }
}