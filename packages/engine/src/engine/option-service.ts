import { CardCharacteristicService, withCharacteristicCache } from './card-characteristic-service';
import { isManaAbility, manaAbilities, manaOutput } from './mana-abilities';
import { inspectPlayerAction } from './player-action-query';
import { landPlayLimit } from '../shared/match-rules';
import { describeActionCost as describeCost } from '../shared/action-cost-description';
import { ACTION_IDS, type ActionIdOrAbility } from '../types/action.ids';
import type { GameRoom, PlayerId } from '../types/game.room.types';
import type { CardInstance } from '../types/card.types';
import type { PendingChoice } from '../types/choice.types';
import { prepareAnnouncement, spellAnnouncementDefinition } from './announcement-values';

export interface ActionOption {
  actionId: ActionIdOrAbility;
  label: string;
  description?: string;
  disabled?: boolean;
  disabledReason?: string;
  nextInput?: PendingChoice['kind'];
  /** Marked true when the option should not be rendered (e.g. redundant with left-click). */
  hidden?: boolean;
  /** Handler-specific selection, forwarded with the chosen option. */
  data?: Record<string, unknown>;
}

function actionOption(room: GameRoom, playerId: PlayerId, card: CardInstance, option: ActionOption): ActionOption {
  const result = inspectPlayerAction(room, playerId, option.actionId, { ...option.data, cardUuid: card.uuid });
  if (result.kind === 'unavailable') return { ...option, disabled: true, disabledReason: result.reason };
  if (result.kind === 'input') return { ...option, disabled: false, nextInput: result.choice.kind };
  return { ...option, disabled: false };
}

export class OptionService {
  /** All legal options for one card, or an empty list when the request is invalid. */
  getOptions(room: GameRoom, playerId: PlayerId, cardUuid: string, zone: 'hand' | 'battlefield'): ActionOption[] {
    // Guard: the room must be idle and the request well-formed.
    if (
      room.status === 'gameOver' ||
      room.outcome ||
      room.pendingChoice ||
      room.engineState !== 'waiting_for_player' ||
      (playerId !== room.player1Id && playerId !== room.player2Id) ||
      !Object.prototype.hasOwnProperty.call(room.players, playerId) ||
      !room.players[playerId] ||
      typeof cardUuid !== 'string' ||
      !cardUuid.trim() ||
      (zone !== 'hand' && zone !== 'battlefield')
    ) {
      return [];
    }

    return withCharacteristicCache(room, () => {
      const card = this.findCard(room, playerId, cardUuid, zone);
      if (!card) return [];
      return zone === 'hand' ? this.getHandOptions(room, playerId, card) : this.getBattlefieldOptions(room, playerId, card);
    });
  }

  private findCard(
    room: GameRoom,
    playerId: PlayerId,
    cardUuid: string,
    zone: 'hand' | 'battlefield',
  ): CardInstance | undefined {
    if (zone === 'hand') {
      return room.players[playerId].hand.find((c) => c.uuid === cardUuid);
    }

    return room.battlefield.find(
      (c) => c.uuid === cardUuid && CardCharacteristicService.resolveController(room, c) === playerId,
    );
  }

  private getHandOptions(room: GameRoom, playerId: PlayerId, card: CardInstance): ActionOption[] {
    const options: ActionOption[] = [];

    const blueprint = CardCharacteristicService.resolveBlueprint(room, card);

    // Lands have their own action and never go on the stack.
    if (blueprint.cardTypes.includes('Land')) {
      const data = { cardUuid: card.uuid, zoneRevision: card.state.zoneRevision ?? 0 };
      const limit = landPlayLimit(room.setup);

      return [
        actionOption(room, playerId, card, {
          actionId: ACTION_IDS.playLand,
          label: 'Play land',
          data: { zoneRevision: data.zoneRevision },
          description: blueprint.landPlacement === 'paid'
            ? describeCost(blueprint.castRequirements.cost)
            : `${Math.max(
            0,
            limit - (room.turnHistory?.landPlays?.[playerId] ?? 0),
          )} of ${limit} land plays remaining this turn`,
        }),
        ...this.getActivatedOptions(room, playerId, card),
      ];
    }

    const announced = !!blueprint.numericDeclarations?.length || !!blueprint.castRequirements.alternativeCosts?.length;
    const payment = prepareAnnouncement(card, spellAnnouncementDefinition(blueprint), {}, { room, playerId });
    const substitution = CardCharacteristicService.castManaSubstitution(room, card, playerId);
    const price = payment.success && payment.cost ? describeCost(payment.cost) : 'No additional cost';
    const details = announced
      ? [blueprint.castRequirements.alternativeCosts?.length ? 'Choose how to pay' : 'Announce and pay the complete cost']
      : [price, blueprint.rulesText];
    if (substitution) details.push(`You can pay ${substitution.colors.join(' or ')} with ${substitution.from} this turn`);

    options.push(actionOption(room, playerId, card, {
      actionId: ACTION_IDS.castSpell,
      label: 'Cast spell',
      description: details.filter(Boolean).join(' · '),
    }));

    return [...options, ...this.getActivatedOptions(room, playerId, card)];
  }

  private getBattlefieldOptions(room: GameRoom, playerId: PlayerId, card: CardInstance): ActionOption[] {
    const options: ActionOption[] = [];

    for (const { abilityIndex, ability } of manaAbilities(card, room)) {
      const output = manaOutput(ability);
      if (!output) continue;
      for (const manaColor of output.colors) {
        const verb = ability.cost.tap ? 'Tap' : ability.cost.untap ? 'Untap' : 'Activate';
        options.push(actionOption(room, playerId, card, {
          actionId: ACTION_IDS.tapForMana,
          data: { abilityId: ability.id, abilityIndex, manaColor },
          label: verb + ': add ' + output.amount + ' ' + manaColor + ' mana',
          description: describeCost(ability.cost),
        }));
      }
    }

    // Activated abilities from card definition (non-mana abilities only —
    // mana abilities are already covered by the "Tap for Mana" option above).
    return [...options, ...this.getActivatedOptions(room, playerId, card)];
  }

  private getActivatedOptions(room: GameRoom, playerId: PlayerId, card: CardInstance): ActionOption[] {
    const options: ActionOption[] = [];

    for (const ability of CardCharacteristicService.resolveAbilities(room, card)) {
      // Mana abilities are surfaced separately, so skip them here.
      if (
        ability.type === 'activated' &&
        !isManaAbility(ability) &&
        (ability.allowedZones ?? ['battlefield']).includes(card.state.zone as 'hand' | 'battlefield')
      ) {
        options.push(actionOption(room, playerId, card, {
          actionId: ACTION_IDS.activateAbility,
          data: { abilityId: ability.id },
          label: `Activate: ${ability.id}`,
          description: ability.alternativeCosts?.length
            ? 'Choose how to pay'
            : [
                describeCost(ability.cost),
                ...(ability.additionalCost ? [describeCost(ability.additionalCost)] : []),
              ].join(', '),
        }));
      }
    }

    return options;
  }
}
