import type { CardInstance } from '@shared/card.types';
import type { GameRoom } from '@shared/game.room.types';
import type { GameEngine } from '@engine/game-engine';
import type { GameMutation } from '@shared/game-mutation.types';

export function creature(uuid: string, controllerId: string, power = 2, toughness = 4, keywords: string[] = []): CardInstance {
  return { uuid, blueprint: { id: uuid, name: uuid, cardTypes: ['Creature'], keywords, power, toughness,
    castRequirements: { allowedZones: ['hand'], cost: {} }, rulesText: '', abilities: [] },
    state: { zone: 'battlefield', zoneRevision: 0, ownerId: controllerId, controllerId, isTapped: false,
      damageTaken: 0, summoningSickness: false, attackedThisTurn: false, counters: {} } };
}

/** Fixture convenience only for forced one-recipient decisions; never picks a split. */
export function answerSingleRecipientCombat(engine: GameEngine): GameMutation[] {
  const mutations: GameMutation[] = [];
  while (engine.roomState.pendingChoice?.continuation.type === 'combat') {
    const choice = engine.roomState.pendingChoice;
    if (choice.options.length !== 1) throw new Error('Test must explicitly select a multi-recipient allocation');
    const result = engine.executePlayerAction(choice.playerId, 'choose', { choiceId: choice.id, allocations: { [choice.options[0].id]: choice.total } });
    if (!result.success) throw new Error(result.reason);
    mutations.push(...result.mutations ?? []);
  }
  return mutations;
}

export function combatRoom(room: GameRoom, attacker: CardInstance, blockers: CardInstance[] = []): GameRoom {
  return { ...room, battlefield: [attacker, ...blockers], combatDeclarations: { attackers: true, blockers: true },
    combat: [{ uuid: attacker.uuid, attacker: structuredClone(attacker), attackerPower: attacker.blueprint.power ?? 0,
      blockers: structuredClone(blockers), blocked: blockers.length > 0 }] };
}
