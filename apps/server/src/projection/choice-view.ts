import { createHmac, randomBytes } from 'node:crypto';
import type { GameRoom } from '@card-game/engine/types/game.room.types';
import type { ChoiceView } from '@card-game/protocol';
import { battlefieldCardLabel } from '@card-game/engine/shared/card-label';
import type { DamageRecipient } from '@card-game/engine/types/damage.types';
import { canSeeChoice, choiceOptionLabel } from './reveal-policy';

// Stable for reconnects within this process; rooms themselves are in-memory.
// These are option handles, not authentication credentials.
const choiceKey = randomBytes(32);
function optionId(room: GameRoom, choiceId: string, playerId: string, id: string): string {
  return createHmac('sha256', choiceKey).update(JSON.stringify([room.roomId, choiceId, playerId, id])).digest('hex');
}

export function buildChoiceView(room: GameRoom, viewerId: string): ChoiceView | null {
  const choice = room.pendingChoice;
  if (!choice) return null;
  if (!canSeeChoice(room, viewerId)) return { kind: 'waiting', playerId: choice.playerId };
  const continuation = choice.continuation;
  const sourceUuid = continuation.type === 'action' ? continuation.data.cardUuid : continuation.type === 'combat' ? continuation.sourceUuid : undefined;
  const source = [...room.battlefield, ...room.players[viewerId].hand].find(card => card.uuid === sourceUuid);
  const numericBindings = continuation.type === 'action' && continuation.data.numericBindings;
  const base = {
    id: choice.id, playerId: choice.playerId, prompt: choice.prompt,
    cancellable: continuation.type === 'action',
    ...(source ? { sourceLabel: battlefieldCardLabel(room, source) } : {}),
    ...(numericBindings && typeof numericBindings === 'object' ? { numericBindings: Object.fromEntries(Object.entries(numericBindings).filter(([, value]) => typeof value === 'number' && Number.isFinite(value))) as Record<string, number> } : {}),
  };
  if (choice.kind === 'number') return { ...base, kind: 'number', range: { min: choice.range.min, ...(choice.range.max !== undefined ? { max: choice.range.max } : {}) } };
  return { ...base, kind: choice.kind, min: choice.min, max: choice.max,
    ...(choice.total !== undefined ? { total: choice.total } : {}), ...(choice.minimumPerOption !== undefined ? { minimumPerOption: choice.minimumPerOption } : {}),
    options: choice.options.map(option => {
      const recipient = continuation.type === 'combat' ? option.value as DamageRecipient : undefined;
      const card = recipient?.kind === 'permanent' ? room.battlefield.find(card => card.uuid === recipient.cardUuid && (card.state.zoneRevision ?? 0) === recipient.zoneRevision) : undefined;
      const label = recipient?.kind === 'player' ? recipient.playerId === viewerId ? 'You' : 'Opponent' : card ? battlefieldCardLabel(room, card)
        : continuation.type === 'trigger' && continuation.field === 'order' ? option.label.split('@')[0] : choiceOptionLabel(room, viewerId, option.label);
      return { id: optionId(room, choice.id, viewerId, option.id), label,
      ...(option.limit !== undefined ? { limit: option.limit } : {}) };
    }),
  };
}

export function decodeChoiceAnswer(room: GameRoom, playerId: string, data: Record<string, unknown>): Record<string, unknown> {
  const choice = room.pendingChoice;
  if (!choice || choice.playerId !== playerId || choice.id !== data.choiceId || choice.kind === 'number') return data;
  const options = new Map(choice.options.map(option => [optionId(room, choice.id, playerId, option.id), option.id]));
  const decode = (id: unknown): string => {
    if (typeof id !== 'string' || !options.has(id)) throw new Error('Invalid choice option');
    return options.get(id)!;
  };
  return { ...data,
    ...(Array.isArray(data.choices) ? { choices: data.choices.map(decode) } : {}),
    ...(data.allocations && typeof data.allocations === 'object' && !Array.isArray(data.allocations)
      ? { allocations: Object.fromEntries(Object.entries(data.allocations).map(([id, amount]) => [decode(id), amount])) } : {}),
  };
}
