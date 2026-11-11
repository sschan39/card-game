import type { CardInstance, ActivatedAbility, TriggeredAbility } from '../types/card.types';
import type { GameRoom } from '../types/game.room.types';
import type { GameMutation } from '../types/game-mutation.types';
import type { RuleUse } from '../types/rule.types';
import { CardCharacteristicService } from './card-characteristic-service';
import { abilityUseKey } from '../shared/ability-identity';
import { recordRuleUse, ruleUseAvailable } from '../rules/runtime/active-rules';
import { evaluateNumericValue } from '../shared/numeric-values';
import { roomCards } from './continuous-effect-state';
import { createBoardNumericContext } from './numeric-characteristics';

type Ability = ActivatedAbility | TriggeredAbility;
/** Same period/identity contract as modifier usage; queries never consume it. */
export function abilityUsage(
  source: CardInstance,
  ability: Pick<Ability, 'id' | 'usage'>,
  controllerId = source.state.controllerId,
  room?: GameRoom,
): RuleUse | undefined {
  const usage = ability.usage;
  if (!usage) return;
  let identity = `${source.uuid}:${source.state.zoneRevision ?? 0}`;
  if (usage.identity === 'source_card') identity = source.uuid;
  if (usage.identity === 'controller') {
    identity = controllerId;
    if (!usage.group) identity += ':' + source.blueprint.id;
  }
  return {
    key: usage.group ? `usage:${identity}:group:${usage.group}` : `ability-use:${identity}:${ability.id ?? ''}`,
    period: usage.period,
    limit: typeof usage.limit === 'number' ? usage.limit : liveUsageLimit(usage.limit, room, source, controllerId),
  };
}
/** Queries read the current state without resetting or consuming the use history. */
function liveUsageLimit(value: Exclude<NonNullable<Ability['usage']>['limit'], number>, room: GameRoom | undefined,
  source: CardInstance, controllerId: string): number {
  if (!room) return 0;
  const evaluated = evaluateNumericValue(value, createBoardNumericContext({
    cards: roomCards(room),
    characteristics: card => CardCharacteristicService.resolve(room, card),
    source,
    controllerId,
    fields: {
      controller: room.players[controllerId],
      room: { phase: room.phase, turnNumber: room.turnNumber ?? 1, activeTurnPlayerId: room.activeTurnPlayerId },
      history: room.turnHistory,
    },
    defaultCountZones: ['battlefield'],
  }));
  return evaluated.ok && Number.isSafeInteger(evaluated.value) && evaluated.value >= 0 ? evaluated.value : 0;
}

/** Only controller-scoped budgets need a live control query; physical-card keys are controller-independent. */
function usageController(room: GameRoom, source: CardInstance, ability: Ability, explicit?: string): string {
  if (explicit !== undefined) return explicit;
  if (ability.usage?.identity === 'controller') return CardCharacteristicService.resolveController(room, source);
  return source.state.controllerId;
}

/** Both the older turn-limit spelling and explicit budgets use one counter query. */
export function abilityUsageAvailable(
  room: GameRoom,
  source: CardInstance,
  ability: Ability,
  reserved: GameMutation[] = [],
  controllerId?: string,
  occurrenceKey = abilityUseKey(source, ability.id ?? ''),
): boolean {
  const limits: RuleUse[] = [];
  const use = abilityUsage(source, ability, usageController(room, source, ability, controllerId), room);
  if (use) limits.push(use);
  if (ability.limitPerTurn !== undefined) {
    if (!Number.isSafeInteger(ability.limitPerTurn) || ability.limitPerTurn < 1) return false;
    limits.push({ key: occurrenceKey, period: 'turn', limit: ability.limitPerTurn });
  }
  return limits.every((limit) => {
    const count = reserved.filter(
      (m) =>
        m.type === (limit.period === 'game' ? 'RECORD_GAME_RULE_USE' : 'RECORD_ABILITY_USE') &&
        'key' in m &&
        m.key === limit.key &&
        (m.type !== 'RECORD_ABILITY_USE' || (m.turnNumber ?? room.turnNumber ?? 1) === (room.turnNumber ?? 1)),
    ).length;
    return ruleUseAvailable(room, { ...limit, limit: limit.limit - count });
  });
}
/** Produce the single committed usage debit for an ability budget. */
export function recordAbilityUsage(
  room: GameRoom,
  source: CardInstance,
  ability: Ability,
  controllerId?: string,
): GameMutation[] {
  const use = abilityUsage(source, ability, usageController(room, source, ability, controllerId), room);
  return use ? [recordRuleUse(room, use)] : [];
}

/** Commit occurrence history even for unlimited abilities, then debit any explicit budget once. */
export function recordAbilityCommit(
  room: GameRoom,
  source: CardInstance,
  ability?: Ability,
  controllerId: string | undefined = undefined,
  occurrenceKey = abilityUseKey(source, ability?.id ?? 'on-enter'),
): GameMutation[] {
  return [
    { type: 'RECORD_ABILITY_USE', key: occurrenceKey, turnNumber: room.turnNumber ?? 1 },
    ...(ability ? recordAbilityUsage(room, source, ability, controllerId) : []),
  ];
}

/** Conditions on later events can see queued debits, without mutating committed history. */
export function withReservedAbilityUses(room: GameRoom, reserved: GameMutation[]): GameRoom {
  const turnNumber = room.turnNumber ?? 1;
  const uses = { ...(room.turnHistory?.uses ?? {}) },
    gameUses = { ...room.gameRuleUses };
  for (const mutation of reserved) {
    if (mutation.type === 'RECORD_ABILITY_USE' && (mutation.turnNumber ?? turnNumber) === turnNumber)
      uses[mutation.key] = (uses[mutation.key] ?? 0) + 1;
    if (mutation.type === 'RECORD_GAME_RULE_USE') gameUses[mutation.key] = (gameUses[mutation.key] ?? 0) + 1;
  }
  // Rooms normally have history after their first event. Preserve absence for
  // direct discovery fixtures instead of manufacturing unrelated event counts.
  return {
    ...room,
    gameRuleUses: gameUses,
    ...(room.turnHistory ? { turnHistory: { ...room.turnHistory, uses } } : {}),
  };
}
