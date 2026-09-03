// src/engine/option-service.ts
import { ActionValidator } from './action-validator';
import { ManaPool } from './mana-pool';
import { ACTION_IDS, type ActionIdOrAbility } from '../types/action.ids';
import type { GameRoom, PlayerId } from '../types/game.room.types';
import type { CardInstance } from '../types/card.types';

export interface ActionOption {
  actionId: ActionIdOrAbility;
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
      actionId: ACTION_IDS.castSpell,
      label: 'Play Card',
      disabled: !canPlay.valid,
      disabledReason: canPlay.valid ? undefined : canPlay.reason,
    });

    return options;
  }

  private getBattlefieldOptions(room: GameRoom, playerId: PlayerId, card: CardInstance): ActionOption[] {
    const options: ActionOption[] = [];

    // Tap for mana (lands or any permanent with a pure mana ability)
    const hasManaAbility = card.blueprint.abilities.some(
      a => a.type === 'activated' && ManaPool.isPureAbility(a.effect.effectId)
    );
    const isLand = card.blueprint.cardTypes.includes('Land');

    if (isLand || hasManaAbility) {
      const canTap = !card.state.isTapped && !card.state.summoningSickness;
      options.push({
        actionId: ACTION_IDS.tapForMana,
        label: 'Tap for Mana',
        disabled: !canTap,
        disabledReason: card.state.isTapped ? 'Already tapped'
          : card.state.summoningSickness ? 'Summoning sickness'
          : undefined,
      });
    }

    // Attack option (creatures only)
    if (card.blueprint.cardTypes.includes('Creature')) {
      const canAttack = !card.state.isTapped && !card.state.summoningSickness
        && room.activeTurnPlayerId === playerId;
      options.push({
        actionId: ACTION_IDS.attack,
        label: 'Attack',
        disabled: !canAttack,
        disabledReason: card.state.isTapped ? 'Already tapped'
          : card.state.summoningSickness ? 'Summoning sickness'
          : room.activeTurnPlayerId !== playerId ? 'Not your turn'
          : undefined,
      });
    }

    // Activated abilities from card definition (non-mana abilities only —
    // mana abilities are already covered by the "Tap for Mana" option above).
    for (const ability of card.blueprint.abilities) {
      if (ability.type === 'activated' && !ManaPool.isPureAbility(ability.effect.effectId)) {
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