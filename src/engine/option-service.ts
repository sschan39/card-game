// src/engine/option-service.ts
import { ActionValidator } from './action-validator';
import type { GameRoom, PlayerId } from '../types/game.room.types';
import type { CardInstance } from '../types/card.types';

export interface ActionOption {
  actionId: string;
  label: string;
  description?: string;
  disabled?: boolean;
  disabledReason?: string;
}

export class OptionService {
  getOptions(room: GameRoom, playerId: PlayerId, cardUuid: string, zone: 'hand' | 'battlefield'): ActionOption[] {
    const card = this.findCard(room, playerId, cardUuid, zone);
    if (!card) return [];

    if (zone === 'hand') {
      return this.getHandOptions(room, playerId, card);
    }

    return this.getBattlefieldOptions(room, playerId, card);
  }

  private findCard(room: GameRoom, playerId: PlayerId, cardUuid: string, zone: 'hand' | 'battlefield'): CardInstance | undefined {
    if (zone === 'hand') {
      return room.players[playerId].hand.find(c => c.uuid === cardUuid);
    }
    return room.battlefield.find(c => c.uuid === cardUuid && c.state.controllerId === playerId);
  }

  private getHandOptions(room: GameRoom, playerId: PlayerId, card: CardInstance): ActionOption[] {
    const options: ActionOption[] = [];

    const canPlay = ActionValidator.canActivate(room, playerId, card, card.blueprint.castRequirements);
    options.push({
      actionId: 'playCardAction',
      label: 'Play Card',
      disabled: !canPlay.valid,
      disabledReason: canPlay.valid ? undefined : canPlay.reason,
    });

    return options;
  }

  private getBattlefieldOptions(room: GameRoom, playerId: PlayerId, card: CardInstance): ActionOption[] {
    const options: ActionOption[] = [];

    // Tap for mana (lands)
    if (card.blueprint.cardTypes.includes('Land')) {
      const canTap = !card.state.isTapped && !card.state.summoningSickness;
      options.push({
        actionId: 'tapForManaAction',
        label: 'Tap for Mana',
        disabled: !canTap,
        disabledReason: card.state.isTapped ? 'Already tapped' : undefined,
      });
    }

    // Activated abilities from card definition
    for (const ability of card.blueprint.abilities) {
      if (ability.type === 'activated') {
        const canActivate = ActionValidator.canActivate(room, playerId, card, {
          allowedZones: ['battlefield'],
          speed: ability.castSpeed,
          cost: ability.cost,
        });
        options.push({
          actionId: `activateAbility_${ability.effect.effectId}`,
          label: `Activate: ${ability.effect.effectId}`,
          disabled: !canActivate.valid,
          disabledReason: canActivate.valid ? undefined : canActivate.reason,
        });
      }
    }

    return options;
  }
}