import type { GameRoom } from '../types/game.room.types';
import type { GameMutation } from '../types/game-mutation.types';
import type { StackEffect } from '../types/effect.types';
import type { EffectContext } from './effect-context';
import { defaultRuntimeContext } from '../shared/runtime-context';
import { tokenPolicy } from '../shared/token-policy';
import { createCardState } from '../shared/card-state';
import { roomCards } from './continuous-effect-state';
import { nextEffectTimestamp } from './continuous-effects';

type TokenCreation = Extract<GameMutation, { type: 'CREATE_TOKEN' }>;

function tokenBlueprint(room: GameRoom, id: string) {
  const tokens = room.matchContent?.tokenBlueprints;
  return tokens && Object.prototype.hasOwnProperty.call(tokens, id) ? tokens[id] : undefined;
}

function isRecipient(room: GameRoom, playerId: string): boolean {
  return (
    (room.player1Id === playerId || room.player2Id === playerId) &&
    Object.prototype.hasOwnProperty.call(room.players, playerId)
  );
}

/** Allocate identities once during planning; the serialized transaction retains them across replacement choices. */
export function planTokenCreation(room: GameRoom, effect: StackEffect, context: EffectContext): GameMutation[] {
  const amount = effect.params.amount ?? 1;
  const tokenId = effect.params.tokenId;
  if (
    typeof tokenId !== 'string' ||
    !tokenBlueprint(room, tokenId) ||
    !Number.isSafeInteger(amount) ||
    (amount as number) < 0 ||
    (amount as number) > tokenPolicy.maxCreatedPerInstruction
  )
    return [];
  const players = [
    ...new Set(
      effect.targets
        .filter((target) => target.targetType === 'player' && !!target.playerId && isRecipient(room, target.playerId))
        .map((target) => target.playerId!),
    ),
  ];
  if ((amount as number) * players.length > tokenPolicy.maxCreatedPerInstruction) return [];
  const occupied = new Set(roomCards(room).map((card) => card.uuid));
  const mutations: TokenCreation[] = [];
  for (const playerId of players) {
    for (let index = 0; index < (amount as number); index++) {
      const cardUuid = (context.uuid ?? defaultRuntimeContext.uuid)();
      if (typeof cardUuid !== 'string' || !cardUuid || occupied.has(cardUuid)) return [];
      occupied.add(cardUuid);
      mutations.push({
        type: 'CREATE_TOKEN',
        tokenId,
        cardUuid,
        playerId,
        sequence: (room.tokenSequence ?? 0) + mutations.length + 1,
      });
    }
  }
  return mutations;
}

/** Pure admission from a canonical blueprint: no staging zone, casting, random generation or trusted client state. */
export function createToken(room: GameRoom, creation: TokenCreation): GameRoom {
  const blueprint = tokenBlueprint(room, creation.tokenId);
  if (
    !Number.isSafeInteger(creation.sequence) ||
    creation.sequence <= 0 ||
    creation.sequence !== (room.tokenSequence ?? 0) + 1 ||
    !blueprint ||
    !isRecipient(room, creation.playerId) ||
    typeof creation.cardUuid !== 'string' ||
    !creation.cardUuid ||
    roomCards(room).some((card) => card.uuid === creation.cardUuid)
  )
    return room;
  const token = {
    blueprint, uuid: creation.cardUuid, isToken: true,
    state: {
      ...createCardState(blueprint, creation.playerId, creation.playerId, 'battlefield'),
      zoneRevision: 0, summonKind: 'effect' as const, characteristicTimestamp: nextEffectTimestamp(room),
    },
  };
  return { ...room, tokenSequence: creation.sequence, battlefield: [...room.battlefield, token] };
}
