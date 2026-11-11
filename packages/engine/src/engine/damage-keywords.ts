import { damageCause } from './change-cause';
import type { DamageAssignment } from '../types/damage.types';
import type { GameRoom } from '../types/game.room.types';
import type { GameMutation } from '../types/game-mutation.types';
import { CardCharacteristicService } from './card-characteristic-service';

/** Generic damage results, distinct from replacement selection and from SBAs. */
export function planDamageResults(room: GameRoom, assignments: readonly DamageAssignment[]): GameMutation[] {
  const results: GameMutation[] = [];

  for (const assignment of assignments) {
    const { amount, recipient, source } = assignment;
    const start = results.length;
    const characteristics = CardCharacteristicService.resolve(room, source.card);
    const keywords = characteristics.keywords.map((k) => k.toLowerCase());

    // --- player recipients: life loss ---
    if (recipient.kind === 'player') {
      results.push({ type: 'CHANGE_LIFE', playerId: recipient.playerId, amount: -amount });
    } else {
      // --- permanent recipients: the exact incarnation must still be on the battlefield ---
      const card = room.battlefield.find((c) =>
        c.uuid === recipient.cardUuid && (c.state.zoneRevision ?? 0) === recipient.zoneRevision);

      // Guard: the permanent left the battlefield before damage landed.
      if (!card) continue;

      const types = CardCharacteristicService.resolveTypes(room, card);

      // Planeswalkers lose loyalty; battles lose defense.
      if (types.includes('Planeswalker')) {
        results.push({
          type: 'REMOVE_COUNTER',
          cardUuid: card.uuid,
          counterType: 'loyalty',
          amount,
          sourceInfo: source,
          sourceControllerId: characteristics.controllerId,
        });
      }

      if (types.includes('Battle')) {
        results.push({
          type: 'REMOVE_COUNTER',
          cardUuid: card.uuid,
          counterType: 'defense',
          amount,
          sourceInfo: source,
          sourceControllerId: characteristics.controllerId,
        });
      }

      // Creatures take -1/-1 counters from wither, otherwise marked damage.
      if (types.includes('Creature')) {
        if (keywords.includes('wither')) {
          results.push({
            type: 'ADD_COUNTER',
            cardUuid: card.uuid,
            counterType: '-1/-1',
            amount,
            sourceInfo: source,
            sourceControllerId: characteristics.controllerId,
          });
        } else {
          results.push({ type: 'MARK_DAMAGE', cardUuid: card.uuid, zoneRevision: recipient.zoneRevision, amount });
        }

        // Deathtouch is recorded so the SBA pass can destroy the creature.
        if (keywords.includes('deathtouch')) {
          results.push({ type: 'SET_DEATHTOUCH_DAMAGE', cardUuid: card.uuid, value: true });
        }
      }
    }

    // Lifelink gains life for the damage source's controller, if still present.
    if (keywords.includes('lifelink') && room.players[characteristics.controllerId]) {
      results.push({ type: 'CHANGE_LIFE', playerId: characteristics.controllerId, amount, healing: true });
    }
    for (let i = start; i < results.length; i++) results[i] = { ...results[i], cause: damageCause(assignment) };
  }

  return results;
}
