import type { DamageAssignment } from '../types/damage.types';
import type { GameRoom } from '../types/game.room.types';
import type { GameMutation } from '../types/game-mutation.types';
import { CardCharacteristicService } from './card-characteristic-service';

/** Generic damage results, distinct from replacement selection and from SBAs. */
export function planDamageResults(room: GameRoom, assignments: readonly DamageAssignment[]): GameMutation[] {
  const results: GameMutation[] = [];
  for (const { amount, recipient, source } of assignments) {
    const characteristics = CardCharacteristicService.resolve(room, source.card);
    const keywords = characteristics.keywords.map(k => k.toLowerCase());
    if (recipient.kind === 'player') {
      if (keywords.includes('infect')) results.push({ type: 'ADD_POISON', playerId: recipient.playerId, amount });
      else results.push({ type: 'CHANGE_LIFE', playerId: recipient.playerId, amount: -amount });
    } else {
      const card = room.battlefield.find(c => c.uuid === recipient.cardUuid && (c.state.zoneRevision ?? 0) === recipient.zoneRevision);
      if (!card) continue;
      const types = CardCharacteristicService.resolveTypes(room, card);
      if (types.includes('Planeswalker')) results.push({ type: 'REMOVE_COUNTER', cardUuid: card.uuid, counterType: 'loyalty', amount, sourceInfo: source, sourceControllerId: characteristics.controllerId });
      if (types.includes('Battle')) results.push({ type: 'REMOVE_COUNTER', cardUuid: card.uuid, counterType: 'defense', amount, sourceInfo: source, sourceControllerId: characteristics.controllerId });
      if (types.includes('Creature')) {
        if (keywords.includes('infect') || keywords.includes('wither')) results.push({ type: 'ADD_COUNTER', cardUuid: card.uuid, counterType: '-1/-1', amount, sourceInfo: source, sourceControllerId: characteristics.controllerId });
        else results.push({ type: 'MARK_DAMAGE', cardUuid: card.uuid, zoneRevision: recipient.zoneRevision, amount });
        if (keywords.includes('deathtouch')) results.push({ type: 'SET_DEATHTOUCH_DAMAGE', cardUuid: card.uuid, value: true });
      }
    }
    if (keywords.includes('lifelink') && room.players[characteristics.controllerId]) results.push({ type: 'CHANGE_LIFE', playerId: characteristics.controllerId, amount });
  }
  return results;
}
