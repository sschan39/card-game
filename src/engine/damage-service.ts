import type { DamageAssignment } from '../types/damage.types';
import type { GameMutation } from '../types/game-mutation.types';
import type { GameRoom } from '../types/game.room.types';
import { CardCharacteristicService } from './card-characteristic-service';

export interface DamageRule {
  modify?: (room: GameRoom, assignment: DamageAssignment) => DamageAssignment | null;
  /** Receives the fully damaged board, before SBAs. Returns consequences, never checkpoint/priority work. */
  consequences?: (damagedRoom: GameRoom, assignments: readonly DamageAssignment[]) => GameMutation[];
}

export class DamageRuleRegistry {
  private static rules = new Set<DamageRule>();
  static register(rule: DamageRule): () => void {
    this.rules.add(rule); return () => { this.rules.delete(rule); };
  }
  static modify(room: GameRoom, original: DamageAssignment): DamageAssignment | null {
    let assignment: DamageAssignment | null = original;
    for (const rule of this.rules) {
      if (!assignment) break;
      if (rule.modify) assignment = rule.modify(room, assignment);
    }
    return assignment;
  }
  static consequences(room: GameRoom, assignments: readonly DamageAssignment[]): GameMutation[] {
    return [...this.rules].flatMap(rule => rule.consequences?.(room, assignments) ?? []);
  }
}

export function validDamageAssignments(room: GameRoom, assignments: readonly DamageAssignment[]): DamageAssignment[] {
  return assignments.filter(({ amount, recipient }) => Number.isSafeInteger(amount) && amount > 0 &&
    (recipient.kind === 'player' ? !!room.players[recipient.playerId] : room.battlefield.some(card =>
      card.uuid === recipient.cardUuid && (card.state.zoneRevision ?? 0) === recipient.zoneRevision &&
      CardCharacteristicService.resolveTypes(room, card).some(type => ['Creature', 'Planeswalker', 'Battle'].includes(type)))));
}

/** Shared by combat and effect damage. Pure proposal hooks precede one atomic commit. */
export function planDamage(room: GameRoom, proposed: readonly DamageAssignment[]): GameMutation[] {
  const modified = proposed.filter(assignment => Number.isSafeInteger(assignment.amount) && assignment.amount > 0)
    .flatMap(assignment => { const result = DamageRuleRegistry.modify(room, structuredClone(assignment)); return result ? [result] : []; });
  const assignments = validDamageAssignments(room, modified);
  if (!assignments.length) return [];
  return [{ type: 'APPLY_DAMAGE_BATCH', assignments }];
}
