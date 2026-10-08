import type { CardInstance } from '../types/card.types';
import type { GameRoom, PlayerId } from '../types/game.room.types';
import type { GameMutation } from '../types/game-mutation.types';
import { CardCharacteristicService } from './card-characteristic-service';
import type { CombatDeclaration } from '../types/effect.types';
import type { DamageAssignment, DamageRecipient } from '../types/damage.types';
import { lethalDamageFor } from './card-utils';

export interface CombatDamageContext {
  room: GameRoom; declaration: CombatDeclaration; source: CardInstance;
  role: 'attacker' | 'blocker'; pass: string;
}

export interface AttackerContext { room: GameRoom; playerId: PlayerId; attackers: readonly CardInstance[] }
export interface BlockerContext { room: GameRoom; playerId: PlayerId; assignments: readonly { attacker: CardInstance; blockers: readonly CardInstance[] }[] }

/** Pure engine extensions. Whole declarations allow group constraints without special handler branches. */
export interface CombatRule {
  canAttackWhileSummoningSick?: (context: AttackerContext, attacker: CardInstance) => boolean | undefined;
  /** Last explicit opinion supplies pairwise permission; whole-declaration restrictions still apply. */
  canBlockPair?: (context: BlockerContext, attacker: CardInstance, blocker: CardInstance) => boolean | undefined;
  validateAttackers?: (context: AttackerContext) => string | undefined;
  validateBlockers?: (context: BlockerContext) => string | undefined;
  attackerMutations?: (context: AttackerContext, proposed: readonly GameMutation[]) => GameMutation[];
  blockerMutations?: (context: BlockerContext, proposed: readonly GameMutation[]) => GameMutation[];
  damagePasses?: (room: GameRoom, proposed: readonly string[]) => string[];
  dealsDamage?: (context: CombatDamageContext) => boolean;
  damageRecipients?: (context: CombatDamageContext, proposed: readonly DamageRecipient[]) => DamageRecipient[];
  lethalDamage?: (context: CombatDamageContext, recipient: CardInstance, proposed: number) => number;
  validateAllocation?: (context: CombatDamageContext, assignments: readonly DamageAssignment[]) => string | undefined;
}

const flying: CombatRule = {
  canBlockPair: ({ room }, attacker, blocker) => CardCharacteristicService.resolveKeywords(room, attacker).includes('Flying') &&
    !CardCharacteristicService.resolveKeywords(room, blocker).includes('Flying') ? false : undefined,
};

const trample: CombatRule = {
  damageRecipients: (context, proposed) => {
    const { room, source, role, declaration } = context;
    if (role !== 'attacker' || !declaration.blocked || !CardCharacteristicService.resolveKeywords(room, source).includes('Trample')) return [...proposed];
    const playerId = room.activeTurnPlayerId === room.player1Id ? room.player2Id : room.player1Id;
    return playerId ? [...proposed, { kind: 'player', playerId }] : [...proposed];
  },
  validateAllocation: (context, assignments) => {
    const { room, source, role, declaration } = context;
    if (role !== 'attacker' || !declaration.blocked || !CardCharacteristicService.resolveKeywords(room, source).includes('Trample') ||
        !assignments.some(assignment => assignment.recipient.kind === 'player' && assignment.amount > 0)) return;
    for (const snapshot of declaration.blockers) {
      const blocker = room.battlefield.find(card => card.uuid === snapshot.uuid)!;
      const total = assignments.filter(assignment => assignment.recipient.kind === 'permanent' && assignment.recipient.cardUuid === blocker.uuid)
        .reduce((sum, assignment) => sum + assignment.amount, 0);
      if (total < CombatRuleRegistry.lethalDamage(context, blocker)) return 'Trample requires lethal damage assigned to each blocker before player damage';
    }
  },
};

export class CombatRuleRegistry {
  private static rules = new Set<CombatRule>([flying, trample]);
  static register(rule: CombatRule): () => void {
    this.rules.add(rule);
    return () => { this.rules.delete(rule); };
  }
  static validateAttackers(context: AttackerContext): string | undefined {
    for (const rule of this.rules) { const reason = rule.validateAttackers?.(context); if (reason) return reason; }
  }
  static canAttackWhileSummoningSick(context: AttackerContext, attacker: CardInstance): boolean {
    return [...this.rules].reduce((allowed, rule) => rule.canAttackWhileSummoningSick?.(context, attacker) ?? allowed, false);
  }
  static validateBlockers(context: BlockerContext): string | undefined {
    for (const { attacker, blockers } of context.assignments) for (const blocker of blockers) {
      const allowed = [...this.rules].reduce((allowed, rule) => rule.canBlockPair?.(context, attacker, blocker) ?? allowed, true);
      if (!allowed) return `Creature ${blocker.uuid} cannot block ${attacker.uuid} (Flying or another combat restriction)`;
    }
    for (const rule of this.rules) { const reason = rule.validateBlockers?.(context); if (reason) return reason; }
  }
  static attackerMutations(context: AttackerContext, proposed: GameMutation[]): GameMutation[] {
    return [...this.rules].reduce((mutations, rule) => rule.attackerMutations?.(context, mutations) ?? mutations, proposed);
  }
  static blockerMutations(context: BlockerContext, proposed: GameMutation[]): GameMutation[] {
    return [...this.rules].reduce((mutations, rule) => rule.blockerMutations?.(context, mutations) ?? mutations, proposed);
  }
  static damagePasses(room: GameRoom): string[] {
    const passes = [...this.rules].reduce((result, rule) => rule.damagePasses?.(room, result) ?? result, ['normal']);
    if (!passes.length || passes.some(pass => !pass.trim()) || new Set(passes).size !== passes.length) throw new Error('Combat damage passes must be nonempty unique identifiers');
    return passes;
  }
  static dealsDamage(context: CombatDamageContext): boolean {
    return [...this.rules].every(rule => rule.dealsDamage?.(context) ?? true);
  }
  static damageRecipients(context: CombatDamageContext, proposed: DamageRecipient[]): DamageRecipient[] {
    return [...this.rules].reduce((result, rule) => rule.damageRecipients?.(context, result) ?? result, proposed);
  }
  static lethalDamage(context: CombatDamageContext, recipient: CardInstance): number {
    return [...this.rules].reduce((result, rule) => rule.lethalDamage?.(context, recipient, result) ?? result, lethalDamageFor(context.room, recipient));
  }
  static validateAllocation(context: CombatDamageContext, assignments: DamageAssignment[]): string | undefined {
    for (const rule of this.rules) { const reason = rule.validateAllocation?.(context, assignments); if (reason) return reason; }
  }
}
