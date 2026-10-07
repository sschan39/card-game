// src/engine/option-service.ts
import { ActionValidator } from './action-validator';
import { isManaAbility, manaAbilities, manaOutput } from './mana-abilities';
import { tapForManaHandler } from './handlers/tap-for-mana-handler';
import { ACTION_IDS, type ActionIdOrAbility } from '../types/action.ids';
import type { GameRoom, PlayerId } from '../types/game.room.types';
import type { CardInstance, ActionCost } from '../types/card.types';

const describeCost = (cost: ActionCost) => [
  ...Object.entries(cost.mana ?? {}).filter(([, amount]) => amount).map(([color, amount]) => amount + ' ' + color),
  ...(cost.life ? [cost.life + ' life'] : []), ...(cost.tap ? ['Tap source'] : []),
  ...(cost.untap ? ['Untap source'] : []), ...(cost.discard ? ['Discard ' + cost.discard] : []),
  ...(cost.sacrifice ? ['Sacrifice source'] : []),
].join(', ') || 'No additional cost';

export interface ActionOption {
  actionId: ActionIdOrAbility;
  label: string;
  description?: string;
  disabled?: boolean;
  disabledReason?: string;
  /** Marked true when the option should not be rendered (e.g. redundant with left-click). */
  hidden?: boolean;
  /** Handler-specific selection, forwarded with the chosen option. */
  data?: Record<string, unknown>;
}

export class OptionService {
  getOptions(room: GameRoom, playerId: PlayerId, cardUuid: string, zone: 'hand' | 'battlefield'): ActionOption[] {
    if (room.status === 'gameOver' || room.outcome || room.pendingChoice || room.engineState !== 'waiting_for_player' ||
        (playerId !== room.player1Id && playerId !== room.player2Id) ||
        !Object.prototype.hasOwnProperty.call(room.players, playerId) || !room.players[playerId] ||
        typeof cardUuid !== 'string' || !cardUuid.trim() || (zone !== 'hand' && zone !== 'battlefield')) return [];
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
      // Left-click already plays a hand card directly, so this option is
      // redundant. Flag it hidden so the client does not render it (kept for
      // future re-enabling, e.g. a "why can't I play this?" affordance).
      hidden: true,
    });

    return options;
  }

  private getBattlefieldOptions(room: GameRoom, playerId: PlayerId, card: CardInstance): ActionOption[] {
    const options: ActionOption[] = [];

    for (const { abilityIndex, ability } of manaAbilities(card)) {
      const output = manaOutput(ability);
      for (const manaColor of output?.colors ?? []) {
        const data = { abilityId: ability.id, abilityIndex, manaColor };
        // Preview a possible discard selection for affordability; the command
        // still asks the player to choose the actual cards before paying.
        const discardUuids = room.players[playerId].hand.filter(candidate => candidate.uuid !== card.uuid).slice(0, ability.cost.discard ?? 0).map(candidate => candidate.uuid);
        const validation = tapForManaHandler.validate(room, playerId, { cardUuid: card.uuid, ...data, discardUuids });
        options.push({ actionId: ACTION_IDS.tapForMana, data,
          label: (ability.cost.tap ? 'Tap' : ability.cost.untap ? 'Untap' : 'Activate') + ': add ' + output!.amount + ' ' + manaColor + ' mana',
          description: describeCost(ability.cost),
          disabled: !validation.success, disabledReason: validation.success ? undefined : validation.reason });
      }
    }

    // Attack option removed — attacks are now declared as a batch via
    // declareAttackersHandler during declareAttackersStep (MTG CR 508).
    // The PhaseBar provides the "Declare Attackers" button instead.

    // Activated abilities from card definition (non-mana abilities only —
    // mana abilities are already covered by the "Tap for Mana" option above).
    for (const ability of card.blueprint.abilities) {
      if (ability.type === 'activated' && !isManaAbility(ability)) {
        const canActivate = ActionValidator.canActivate(room, playerId, card, {
          allowedZones: ['battlefield'],
          speed: ability.castSpeed,
          cost: ability.cost,
        });
        options.push({
          actionId: ACTION_IDS.activateAbility,
          data: { abilityId: ability.id },
          label: `Activate: ${ability.id}`,
          description: describeCost(ability.cost),
          disabled: !canActivate.valid,
          disabledReason: canActivate.valid ? undefined : canActivate.reason,
        });
      }
    }

    return options;
  }
}
