import type { TurnHistory } from '../types/trigger.types';
import type { TriggeringEvent } from '../types/effect.types';
import type { CardInstance, ActivatedAbility, TriggeredAbility } from '../types/card.types';
import type { GameRoom } from '../types/game.room.types';

export const HISTORY_EVENTS = ['PERMANENT_ENTERED', 'PERMANENT_LEFT', 'PERMANENT_DIED', 'CARD_DRAWN', 'CARD_DISCARDED', 'SPELL_CAST', 'LIFE_GAINED', 'LIFE_LOST', 'DAMAGE_TAKEN', 'DAMAGE_DEALT', 'ATTACK_DECLARED', 'BLOCK_DECLARED', 'UPKEEP_STARTED', 'END_STEP_STARTED', 'COMBAT_DAMAGE_RESOLVED'] as const;
export const emptyEventCounts = (): Record<string, number> => Object.fromEntries(HISTORY_EVENTS.map(id => [id, 0]));
export function newTurnHistory(turnNumber: number): TurnHistory { return { turnNumber, events: [], counts: emptyEventCounts(), playerCounts: {}, uses: {} }; }
export const abilityUseKey = (source: CardInstance, id: string) => `${source.uuid}:${source.state.zoneRevision ?? 0}:${id}`;
export function abilityLimitReached(room: GameRoom, source: CardInstance, ability: ActivatedAbility | TriggeredAbility): boolean {
  const limit = ability.limitPerTurn;
  return limit !== undefined && (!Number.isSafeInteger(limit) || limit < 1 || (room.turnHistory?.uses[abilityUseKey(source, ability.id ?? '')] ?? 0) >= limit);
}
export function recordRuleEvent(history: TurnHistory, event: TriggeringEvent): TurnHistory {
  if (!(HISTORY_EVENTS as readonly string[]).includes(event.eventId)) return history;
  const playerId = event.payload.controllerId ?? event.payload.playerId ?? event.payload.currentPlayer;
  const own = typeof playerId === 'string' ? history.playerCounts[playerId] ?? emptyEventCounts() : undefined;
  return { ...history, events: [...history.events, event], counts: { ...history.counts, [event.eventId]: (history.counts[event.eventId] ?? 0) + 1 },
    playerCounts: own ? { ...history.playerCounts, [playerId as string]: { ...own, [event.eventId]: (own[event.eventId] ?? 0) + 1 } } : history.playerCounts };
}
