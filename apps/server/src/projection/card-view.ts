import type { CardInstance } from '@card-game/engine/types/card.types';
import type { GameRoom } from '@card-game/engine/types/game.room.types';
import { CardCharacteristicService } from '@card-game/engine/engine/card-characteristic-service';
import { OptionService } from '@card-game/engine/engine/option-service';
import { CombatRuleRegistry } from '@card-game/engine/engine/combat-rules';
import { battlefieldCardLabel } from '@card-game/engine/shared/card-label';
import type { CardView } from '@card-game/protocol';
import { buildTargetGroups } from './target-groups';
import { isPublicPermanent } from './reveal-policy';
import { projectActionOptions } from './action-options';

const options = new OptionService();
export function buildCardView(room: GameRoom, viewerId: string, card: CardInstance, interactive = false): CardView {
  const effective = CardCharacteristicService.resolve(room, card);
  const state = card.state;
  const cost = effective.castRequirements.cost?.mana;
  const symbols: string[] = [];
  if (cost?.generic !== undefined) symbols.push('{' + (typeof cost.generic === 'number' ? cost.generic : cost.generic.numeric.kind === 'binding' ? cost.generic.numeric.name : 'Variable') + '}');
  for (const [color, glyph] of [['white','W'],['blue','U'],['black','B'],['red','R'],['green','G'],['yellow','Y']] as const)
    for (let count = 0; count < (cost?.[color] ?? 0); count++) symbols.push('{' + glyph + '}');
  const owned = effective.controllerId === viewerId;
  interactive = interactive && (state.zone === 'hand' ? state.ownerId === viewerId : owned);
  const creature = effective.cardTypes.includes('Creature');
  const onBoard = state.zone === 'battlefield';
  const canAttack = onBoard && creature && owned && !state.isTapped && !state.attackedThisTurn &&
    (!state.summoningSickness || CombatRuleRegistry.canAttackWhileSummoningSick({ room, playerId: viewerId, attackers: [card] }, card));
  return {
    uuid: card.uuid, definitionId: card.blueprint.id, name: effective.name,
    label: onBoard ? battlefieldCardLabel(room, card) : effective.name,
    cardTypes: [...effective.cardTypes], subTypes: [...effective.subTypes ?? []], keywords: [...effective.keywords],
    rulesText: effective.rulesText, manaCost: symbols.join(''),
    ...(creature ? { power: effective.power, toughness: effective.toughness } : {}),
    ...(card.isToken ? { isToken: true } : {}),
    state: {
      zone: state.zone, ownerId: state.ownerId, controllerId: effective.controllerId,
      zoneRevision: state.zoneRevision ?? 0, isTapped: state.isTapped, damageTaken: state.damageTaken,
      summoningSickness: state.summoningSickness, attackedThisTurn: state.attackedThisTurn,
      counters: Object.fromEntries(Object.entries(state.counters).filter(([, value]) => typeof value === 'number')),
      ...(state.attachedTo && isPublicPermanent(room, state.attachedTo) ? { attachedTo: state.attachedTo, attachedToRevision: state.attachedToRevision } : {}),
      ...(state.attachedToPlayerId ? { attachedToPlayerId: state.attachedToPlayerId } : {}),
      ...(state.protectorId && isPublicPermanent(room, state.protectorId) ? { protectorId: state.protectorId } : {}),
    },
    ...(interactive && state.zone === 'hand' ? { defaultActionId: room.status === 'RPS' ? 'rpsPlay' : effective.cardTypes.includes('Land') ? 'play_land' : 'cast_spell' } : {}),
    actions: interactive && (state.zone === 'hand' || onBoard) ? projectActionOptions(options.getOptions(room, viewerId, card.uuid, state.zone === 'hand' ? 'hand' : 'battlefield'), room.roomId, viewerId) : [],
    targetGroups: interactive ? buildTargetGroups(room, viewerId, card) : {},
    canAttack, canBlock: onBoard && creature && owned && !state.isTapped,
  };
}
