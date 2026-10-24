import type { GameRoom } from '../../types/game.room.types';
import type { GameMutation } from '../../types/game-mutation.types';
import { CardCharacteristicService } from '../card-characteristic-service';
import { structuralTargetLegal, targetPermissionsAllow } from '../../shared/target-legality';

/** Both the resolving effect and reducer enforce exact battlefield incarnations. */
export function legalEquipmentAttachment(room: GameRoom, operation: Extract<GameMutation, { type: 'ATTACH_CARD' }>): boolean {
  const source = room.battlefield.find(card => card.uuid === operation.cardUuid && (card.state.zoneRevision ?? 0) === operation.zoneRevision);
  const host = room.battlefield.find(card => card.uuid === operation.hostUuid && (card.state.zoneRevision ?? 0) === operation.hostRevision);
  if (!source || !host || source.uuid === host.uuid) return false;
  const value = CardCharacteristicService.resolve(room, source);
  if (!value.subTypes.includes('Equipment') || value.controllerId !== operation.controllerId) return false;
  const target = { targetType: 'permanent' as const, cardUuid: host.uuid, zoneRevision: operation.hostRevision };
  return CardCharacteristicService.resolveTypes(room, host).includes('Creature')
    && (!value.attachmentRequirements || structuralTargetLegal(room, operation.controllerId, target, value.attachmentRequirements))
    && targetPermissionsAllow(room, operation.controllerId, source, target);
}
