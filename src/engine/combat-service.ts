import type { CardInstance } from '../types/card.types';
import type { ChoiceAnswer, PendingChoice } from '../types/choice.types';
import type { CombatDamageRequest, CombatDamageState } from '../types/combat.types';
import type { DamageAssignment, DamageRecipient } from '../types/damage.types';
import type { GameMutation } from '../types/game-mutation.types';
import type { GameRoom } from '../types/game.room.types';
import type { CombatDeclaration } from '../types/effect.types';
import { CombatRuleRegistry, type CombatDamageContext } from './combat-rules';
import { liveCombatCard, reconcileCombat } from './combat-state';
import { captureSourceInformation } from './source-information';
import { planDamage } from './damage-service';

export function damageRecipientKey(recipient: DamageRecipient): string {
  return recipient.kind === 'player' ? `player:${recipient.playerId}` : `permanent:${recipient.cardUuid}:${recipient.zoneRevision}`;
}
const permanent = (card: CardInstance): DamageRecipient => ({ kind: 'permanent', cardUuid: card.uuid, zoneRevision: card.state.zoneRevision ?? 0 });

function requestsFor(room: GameRoom, pass: string): CombatDamageRequest[] {
  const requests: CombatDamageRequest[] = [];
  const add = (declaration: CombatDeclaration, source: CardInstance, role: CombatDamageRequest['role'], recipients: DamageRecipient[]) => {
    const context: CombatDamageContext = { room, declaration, source, role, pass };
    const snapshot = captureSourceInformation(room, source);
    const total = Math.max(0, snapshot.power);
    const options = [...new Map(CombatRuleRegistry.damageRecipients(context, recipients).map(recipient => [damageRecipientKey(recipient), recipient])).values()];
    if (total > 0 && options.length && CombatRuleRegistry.dealsDamage(context)) {
      requests.push({ source: snapshot, total, recipients: options, role, declarationUuid: declaration.uuid });
    }
  };
  const defendingPlayerId = room.activeTurnPlayerId === room.player1Id ? room.player2Id : room.player1Id;
  for (const declaration of reconcileCombat(room).combat) {
    const attacker = liveCombatCard(room, declaration.attacker)!;
    const blockers = declaration.blockers.map(snapshot => liveCombatCard(room, snapshot)!);
    add(declaration, attacker, 'attacker', declaration.blocked ? blockers.map(permanent) : defendingPlayerId ? [{ kind: 'player', playerId: defendingPlayerId }] : []);
    for (const blocker of blockers) add(declaration, blocker, 'blocker', [permanent(attacker)]);
  }
  // Active player makes all assignments before the defending player.
  return requests.sort((a, b) => Number(a.source.card.state.controllerId !== room.activeTurnPlayerId) - Number(b.source.card.state.controllerId !== room.activeTurnPlayerId));
}

function assignmentsFor(request: CombatDamageRequest, allocations: Record<string, number>): DamageAssignment[] {
  return request.recipients.flatMap(recipient => {
    const amount = allocations[damageRecipientKey(recipient)] ?? 0;
    return amount > 0 ? [{ source: request.source, recipient, amount, combat: true }] : [];
  });
}

export interface CombatPlan { mutations: GameMutation[]; choice?: PendingChoice; error?: string }

function continuePlan(room: GameRoom, state: CombatDamageState): CombatPlan {
  const request = state.requests.find(request => !Object.prototype.hasOwnProperty.call(state.allocations, request.source.card.uuid));
  if (request) return { mutations: [{ type: 'SET_COMBAT_DAMAGE', state }, { type: 'SET_PRIORITY', playerId: null }, { type: 'SET_LAST_PASSED', playerId: null }, { type: 'SET_ENGINE_STATE', state: 'waiting_for_player' }],
    choice: { id: '', playerId: request.source.card.state.controllerId, kind: 'distribution', prompt: `Assign combat damage from ${request.source.card.blueprint.name}`,
      total: request.total, min: 0, max: request.recipients.length, minimumPerOption: 0,
      options: request.recipients.map(recipient => ({ id: damageRecipientKey(recipient), value: recipient,
        label: recipient.kind === 'player' ? recipient.playerId : room.battlefield.find(card => card.uuid === recipient.cardUuid)!.blueprint.name })),
      continuation: { type: 'combat', sourceUuid: request.source.card.uuid, passIndex: state.passIndex } } };
  const assignments = state.requests.flatMap(request => assignmentsFor(request, state.allocations[request.source.card.uuid]));
  return { mutations: [...planDamage(room, assignments), { type: 'SET_COMBAT_DAMAGE', state: { ...state, completed: true } },
    { type: 'SET_PENDING_CHOICE', choice: null }, { type: 'SET_PENDING_TRIGGERS', mutations: [] }, { type: 'SET_LAST_PASSED', playerId: null }] };
}

export function startCombatDamage(room: GameRoom, nextPass = false): CombatPlan {
  const previous = nextPass ? room.combatDamage : null;
  const passes = previous?.passes ?? CombatRuleRegistry.damagePasses(room);
  const passIndex = previous ? previous.passIndex + 1 : 0;
  return continuePlan(room, { passes, passIndex, completed: false, allocations: {}, requests: requestsFor(room, passes[passIndex]) });
}

export function answerCombatDamage(room: GameRoom, choice: PendingChoice, answer: ChoiceAnswer): CombatPlan {
  const state = room.combatDamage;
  const continuation = choice.continuation;
  if (continuation.type !== 'combat' || !state || state.completed || state.passIndex !== continuation.passIndex || !answer.allocations) return { mutations: [], error: 'Combat damage choice is stale' };
  // Revalidate every source and recipient against the current room before accepting more of the transaction.
  const liveRequests = requestsFor(room, state.passes[state.passIndex]);
  if (JSON.stringify(liveRequests) !== JSON.stringify(state.requests)) return { mutations: [], error: 'Combat damage plan is stale' };
  const request = state.requests.find(request => request.source.card.uuid === continuation.sourceUuid)!;
  if (!request || Object.prototype.hasOwnProperty.call(state.allocations, continuation.sourceUuid)) return { mutations: [], error: 'Combat damage source is stale' };
  const declaration = reconcileCombat(room).combat.find(declaration => declaration.uuid === request.declarationUuid)!;
  const source = liveCombatCard(room, request.source.card)!;
  const reason = CombatRuleRegistry.validateAllocation({ room, declaration, source, role: request.role, pass: state.passes[state.passIndex] }, assignmentsFor(request, answer.allocations));
  if (reason) return { mutations: [], error: reason };
  return continuePlan(room, { ...state, allocations: { ...state.allocations, [continuation.sourceUuid]: answer.allocations } });
}
