import { CardCharacteristicService } from './card-characteristic-service';
// src/engine/option-service.ts
import { ActionValidator } from './action-validator';
import { isManaAbility, manaAbilities, manaOutput } from './mana-abilities';
import { tapForManaHandler } from './handlers/tap-for-mana-handler';
import { validateLandPlay } from './handlers/play-land-handler';
import { landPlayLimit } from '../config';
import { describeActionCost as describeCost } from '../shared/action-cost-description';
import { ACTION_IDS, type ActionIdOrAbility } from '../types/action.ids';
import type { GameRoom, PlayerId } from '../types/game.room.types';
import type { CardInstance } from '../types/card.types';
import type { AuthoredActionCost } from '../types/effect.types';
import { prepareAnnouncement, spellAnnouncementDefinition, abilityAnnouncementDefinition, type AnnouncementDefinition } from './announcement-values';

/** Only unresolved alternatives/numbers defer affordability; fixed extras have a known total. */
function optionPaymentCost(card: CardInstance, definition: AnnouncementDefinition): { cost?: AuthoredActionCost; error?: string } {
  if (definition.numericDeclarations?.length || definition.alternativeCosts?.length) return {};
  if (definition.additionalCost === undefined) return { cost: definition.cost };
  const announcement = prepareAnnouncement(card, definition, {});
  return announcement.success ? { cost: announcement.cost } : { error: announcement.reason };
}

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
    return room.battlefield.find(c => c.uuid === cardUuid && CardCharacteristicService.resolveController(room, c) === playerId);
  }

  private getHandOptions(room: GameRoom, playerId: PlayerId, card: CardInstance): ActionOption[] {
    const options: ActionOption[] = [];

    const blueprint = CardCharacteristicService.resolveBlueprint(room, card);
    if (blueprint.cardTypes.includes('Land')) {
      const data = { cardUuid: card.uuid, zoneRevision: card.state.zoneRevision ?? 0 };
      const validation = validateLandPlay(room, playerId, data);
      const limit = landPlayLimit(room.setup);
      return [{ actionId: ACTION_IDS.playLand, label: 'Play land', data: { zoneRevision: data.zoneRevision },
        description: `${Math.max(0, limit - (room.turnHistory?.landPlays?.[playerId] ?? 0))} of ${limit} land plays remaining this turn`,
        disabled: !validation.success, disabledReason: validation.success ? undefined : validation.reason }];
    }
    const announced = !!blueprint.numericDeclarations?.length || !!blueprint.castRequirements.alternativeCosts?.length;
    const payment = optionPaymentCost(card, spellAnnouncementDefinition(blueprint));
    const canPlay = payment.error ? { valid: false, reason: payment.error } : ActionValidator.canActivate(room, playerId, card, { ...blueprint.castRequirements, cost: payment.cost });
    options.push({
      actionId: ACTION_IDS.castSpell,
      label: 'Cast spell',
      description: announced ? blueprint.castRequirements.alternativeCosts?.length ? 'Choose how to pay' : 'Announce and pay the complete cost'
        : [payment.cost ? describeCost(payment.cost) : 'No additional cost', blueprint.rulesText].filter(Boolean).join(' · '),
      disabled: !canPlay.valid,
      disabledReason: canPlay.valid ? undefined : canPlay.reason,
    });

    return options;
  }

  private getBattlefieldOptions(room: GameRoom, playerId: PlayerId, card: CardInstance): ActionOption[] {
    const options: ActionOption[] = [];

    for (const { abilityIndex, ability } of manaAbilities(card, room)) {
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
    for (const ability of CardCharacteristicService.resolveAbilities(room, card)) {
      if (ability.type === 'activated' && !isManaAbility(ability)) {
        const payment = optionPaymentCost(card, abilityAnnouncementDefinition(ability));
        const canActivate = payment.error ? { valid: false, reason: payment.error } : ActionValidator.canActivate(room, playerId, card, {
          allowedZones: ['battlefield'],
          speed: ability.castSpeed,
          cost: payment.cost,
        }, 'activate', ability.id);
        options.push({
          actionId: ACTION_IDS.activateAbility,
          data: { abilityId: ability.id },
          label: `Activate: ${ability.id}`,
          description: ability.alternativeCosts?.length ? 'Choose how to pay' : [describeCost(ability.cost), ...(ability.additionalCost ? [describeCost(ability.additionalCost)] : [])].join(', '),
          disabled: !canActivate.valid,
          disabledReason: canActivate.valid ? undefined : canActivate.reason,
        });
      }
    }

    return options;
  }
}
