import { canChooseCapturedCard, capturedChoiceAllowed, choiceSourceOrderVisible } from '@card-game/engine/engine/captured-windows';
import { createHmac, randomBytes } from 'node:crypto';
import type { PlayerActionInspection } from '@card-game/engine/engine/player-action-query';
import { PROTOCOL_VERSION, type ActionInspectionMessage } from '@card-game/protocol';
import type { GameRoom } from '@card-game/engine/types/game.room.types';
import type { CardFaceView, ChoiceView } from '@card-game/protocol';
import { collectCards } from '@card-game/engine/shared/card-query';
import { baseCardVisibleTo } from '@card-game/engine/shared/card-visibility';
import type { TargetPointer } from '@card-game/engine/types/effect.types';
import { battlefieldCardLabel } from '@card-game/engine/shared/card-label';
import type { DamageRecipient } from '@card-game/engine/types/damage.types';
import { canSeeChoice, choiceOptionLabel } from './reveal-policy';
import { buildCardView } from './card-view';

// Stable for reconnects within this process; rooms themselves are in-memory.
// These are option handles, not authentication credentials.
const choiceKey = randomBytes(32);
export function optionId(room: GameRoom, choiceId: string, playerId: string, id: string): string {
  return createHmac('sha256', choiceKey)
    .update(JSON.stringify([room.roomId, choiceId, playerId, id]))
    .digest('hex');
}

export function buildChoiceView(room: GameRoom, viewerId: string): ChoiceView | null {
  const choice = room.pendingChoice;
  if (!choice) return null;
  if (!canSeeChoice(room, viewerId) || !capturedChoiceAllowed(room, choice))
    return { kind: 'waiting', playerId: choice.playerId };
  const continuation = choice.continuation;
  const exposeSourceOrder = choiceSourceOrderVisible(room, choice);
  const sourceUuid =
    continuation.type === 'action'
      ? continuation.data.cardUuid
      : continuation.type === 'combat'
        ? continuation.sourceUuid
        : undefined;
  const source = [...room.battlefield, ...room.players[viewerId].hand].find((card) => card.uuid === sourceUuid);
  const numericBindings = continuation.type === 'action' && continuation.data.numericBindings;
  const base = {
    id: choice.id,
    playerId: choice.playerId,
    prompt: choice.prompt,
    cancellable: continuation.type === 'action' || 'paymentStage' in continuation,
    ...(source ? { sourceLabel: battlefieldCardLabel(room, source) } : {}),
    ...(numericBindings && typeof numericBindings === 'object'
      ? {
          numericBindings: Object.fromEntries(
            Object.entries(numericBindings).filter(([, value]) => typeof value === 'number' && Number.isFinite(value)),
          ) as Record<string, number>,
        }
      : {}),
  };
  if (choice.kind === 'number')
    return {
      ...base,
      kind: 'number',
      range: { min: choice.range.min, ...(choice.range.max !== undefined ? { max: choice.range.max } : {}) },
    };
  const cardChoice = choice.kind === 'search' || choice.kind === 'ordering' || choice.kind === 'discard' || choice.kind === 'selection';
  const liveCards = cardChoice ? new Map(collectCards(room).map(card => [card.uuid, card])) : undefined;
  const sourceEffect = continuation.type === 'resolution' ? continuation.stackObj.effects[continuation.effectIndex]?.choice : undefined;
  const search = sourceEffect?.kind === 'search' ? sourceEffect : undefined;
  const faceFor = (value: unknown): CardFaceView | null | undefined => {
    const pointer = value as Partial<TargetPointer> | undefined;
    if (!liveCards || (pointer?.targetType !== 'card' && pointer?.targetType !== 'permanent')) return;
    const card = pointer.cardUuid ? liveCards.get(pointer.cardUuid) : undefined;
    if (!card || (pointer.zone !== undefined && card.state.zone !== pointer.zone) ||
        (pointer.zoneRevision !== undefined && (card.state.zoneRevision ?? 0) !== pointer.zoneRevision)) return null;
    const from = search?.from?.name;
    const captured = continuation.type === 'resolution' && from &&
      continuation.stackObj.resolutionResults?.[from]?.observationId &&
      canChooseCapturedCard(room, continuation.stackObj, from, card);
    const ownLibrary = search?.zone === 'library' && card.state.zone === 'library' && card.state.ownerId === viewerId;
    if (!ownLibrary && !captured && !baseCardVisibleTo(card, viewerId)) return null;
    const { definitionId, name, cardTypes, rulesText, manaCost, power, toughness, isToken } = buildCardView(room, viewerId, card);
    return { definitionId, name, cardTypes, rulesText, manaCost, power, toughness, isToken };
  };
  return {
    ...base,
    kind: choice.kind,
    min: choice.min,
    max: choice.max,
    ...(choice.total !== undefined ? { total: choice.total } : {}),
    ...(choice.minimumPerOption !== undefined ? { minimumPerOption: choice.minimumPerOption } : {}),
    ...(choice.weightGreaterThan !== undefined ? { weightGreaterThan: choice.weightGreaterThan } : {}),
    options: choice.options
      .map((option) => {
        const face = faceFor(option.value);
        const recipient = continuation.type === 'combat' ? (option.value as DamageRecipient) : undefined;
        const card =
          recipient?.kind === 'permanent'
            ? room.battlefield.find(
                (card) => card.uuid === recipient.cardUuid && (card.state.zoneRevision ?? 0) === recipient.zoneRevision,
              )
            : undefined;
        const label =
          recipient?.kind === 'player'
            ? recipient.playerId === viewerId
              ? 'You'
              : 'Opponent'
            : card
              ? battlefieldCardLabel(room, card)
              : continuation.type === 'trigger' && continuation.field === 'order'
                ? option.label.split('@')[0]
                : choiceOptionLabel(room, viewerId, option.label);
        return {
          id: optionId(room, choice.id, viewerId, option.id),
          label: face === null ? 'Hidden card' : label,
          ...(face ? { card: face } : {}),
          ...(option.limit !== undefined ? { limit: option.limit } : {}),
          ...(option.weight !== undefined ? { weight: option.weight } : {}),
          ...(option.distinctGroup !== undefined
            ? { distinctGroup: optionId(room, choice.id, viewerId, 'group:' + option.distinctGroup) } : {}),
        };
      })
      .sort((a, b) => (exposeSourceOrder ? 0 : a.id.localeCompare(b.id))),
  };
}

export function decodeChoiceAnswer(
  room: GameRoom,
  playerId: string,
  data: Record<string, unknown>,
): Record<string, unknown> {
  const choice = room.pendingChoice;
  if (!choice || choice.playerId !== playerId || choice.id !== data.choiceId || choice.kind === 'number') return data;
  const options = new Map(choice.options.map((option) => [optionId(room, choice.id, playerId, option.id), option.id]));
  const decode = (id: unknown): string => {
    if (typeof id !== 'string' || !options.has(id)) throw new Error('Invalid choice option');
    return options.get(id)!;
  };
  return {
    ...data,
    ...(Array.isArray(data.choices) ? { choices: data.choices.map(decode) } : {}),
    ...(data.allocations && typeof data.allocations === 'object' && !Array.isArray(data.allocations)
      ? {
          allocations: Object.fromEntries(Object.entries(data.allocations).map(([id, amount]) => [decode(id), amount])),
        }
      : {}),
  };
}

/** Speculative prompts use the same audience and identifier rules as live choices. */
export function projectActionInspection(room: GameRoom, viewerId: string, inspection: PlayerActionInspection): ActionInspectionMessage {
  if (inspection.kind !== 'input') return { protocolVersion: PROTOCOL_VERSION, ...inspection };
  const live = room.pendingChoice === inspection.choice;
  const choice = buildChoiceView({ ...room, pendingChoice: { ...inspection.choice, id: live ? inspection.choice.id : '' } }, viewerId);
  if (!choice || choice.kind === 'waiting') return {
    protocolVersion: PROTOCOL_VERSION, kind: 'unavailable', reason: 'Choice is not available to this player',
  };
  return { protocolVersion: PROTOCOL_VERSION, kind: 'input', stage: live ? 'pending' : 'preview', choice };
}
