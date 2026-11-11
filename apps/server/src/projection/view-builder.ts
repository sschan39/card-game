import type { GameRoom } from '@card-game/engine/types/game.room.types';
import type { StackObject } from '@card-game/engine/types/effect.types';
import { MANA_COLORS } from '@card-game/engine/types/card.types';
import { collectCards } from '@card-game/engine/shared/card-query';
import { baseCardVisibleTo } from '@card-game/engine/shared/card-visibility';
import { declarationPlayer } from '@card-game/engine/shared/turn-utils';
import { describeStackObject } from '@card-game/engine/shared/action-description';
import { gameConfig, landPlayLimit } from '@card-game/engine/config';
import { PROTOCOL_VERSION, type PlayerView, type StackView } from '@card-game/protocol';
import { assertViewer, canSeeStackSource, canSeeHand, canSeeRpsPlay } from './reveal-policy';
import { buildCardView } from './card-view';
import { buildObservationViews } from './observation-view';
import { buildChoiceView } from './choice-view';
import { withCharacteristicCache } from '@card-game/engine/engine/card-characteristic-service';
import { resolveSourceInformation } from '@card-game/engine/engine/source-information';
import { publicAbilityId } from './wire-identifiers';

export function buildStackView(room: GameRoom, viewerId: string, object: StackObject): StackView {
  const visible = canSeeStackSource(room, viewerId, object);
  const source = visible && object.type !== 'spell' ? resolveSourceInformation(room, object).card : object.source;
  return { uuid: object.uuid, type: object.type, controllerId: object.controllerId,
    source: visible ? buildCardView(room, viewerId, source) : null,
    description: visible ? describeStackObject(room, object, viewerId) : 'Hidden source · ' + object.type,
    ...(object.countered !== undefined ? { countered: object.countered } : {}), ...(object.fizzled !== undefined ? { fizzled: object.fizzled } : {}),
    ...(visible && object.type !== 'spell' && object.ability?.id ? { abilityId: publicAbilityId(room.roomId, viewerId, object.ability.id) } : {}),
  };
}

export function buildPlayerView(room: GameRoom, viewerId: string): PlayerView {
  return withCharacteristicCache(room, () => projectPlayerView(room, viewerId));
}

function publicNameLocks(room: GameRoom): NonNullable<PlayerView['publicNameLocks']> {
  const locks = new Map<string, { name: string; playerId: string }>();
  for (const entry of room.continuousEffectPool) {
    if (!entry.publicNameLock || entry.effect.type !== 'PERMISSION') continue;
    const name = entry.scope.names?.[0];
    const playerId = entry.sourceControllerId === room.player1Id ? room.player2Id : room.player1Id;
    if (name && playerId) locks.set(JSON.stringify([name, playerId]), { name, playerId });
  }
  return [...locks.values()];
}

function visibleHostedCards(room: GameRoom, viewerId: string): NonNullable<PlayerView['hostedCards']> {
  const groups = new Map<string, NonNullable<PlayerView['hostedCards']>[number]>();
  for (const card of collectCards(room, { zones: ['hosted'] })) {
    const host = card.state.hostedBy?.host;
    if (!host || !baseCardVisibleTo(card, viewerId)) continue;
    const key = JSON.stringify([host.cardUuid, host.zoneRevision]);
    const group = groups.get(key) ?? { hostUuid: host.cardUuid, hostRevision: host.zoneRevision, cards: [] };
    group.cards.push(buildCardView(room, viewerId, card));
    groups.set(key, group);
  }
  return [...groups.values()];
}

function projectPlayerView(room: GameRoom, viewerId: string): PlayerView {
  assertViewer(room, viewerId);
  const locks = publicNameLocks(room);
  const hostedCards = visibleHostedCards(room, viewerId);
  return {
    protocolVersion: PROTOCOL_VERSION, viewerId, roomId: room.roomId, player1Id: room.player1Id, player2Id: room.player2Id,
    players: Object.fromEntries(Object.entries(room.players).map(([id, player]) => [id, {
      id, life: player.life, ...(player.failedDraw !== undefined ? { failedDraw: player.failedDraw } : {}),
      mana: Object.fromEntries(MANA_COLORS.map(color => [color, player.mana[color]])) as typeof player.mana,
      hand: canSeeHand(viewerId, id) ? player.hand.map(card => buildCardView(room, viewerId, card, true)) : [],
      handCount: player.hand.length, deckCount: player.deck.length,
      graveyard: player.graveyard.map(card => buildCardView(room, viewerId, card)), exile: (player.exile ?? []).map(card => buildCardView(room, viewerId, card)),
    }])),
    phase: room.phase, status: room.status, debugMode: room.debugMode ?? gameConfig.debugMode,
    engineState: room.engineState, turnNumber: room.turnNumber ?? 0,
    ...(room.outcome ? { outcome: { type: room.outcome.type, ...(room.outcome.type === 'win' ? { winnerId: room.outcome.winnerId } : {}),
      losses: room.outcome.losses.map(loss => ({ playerId: loss.playerId, reason: loss.reason })) } as PlayerView['outcome'] } : {}),
    activeTurnPlayerId: room.activeTurnPlayerId, priorityPlayerId: room.priorityPlayerId, lastPassedPlayerId: room.lastPassedPlayerId,
    declarationPlayerId: declarationPlayer(room), landPlayLimit: landPlayLimit(room.setup),
    turnHistory: { landPlays: Object.fromEntries(Object.keys(room.players).map(id => [id, room.turnHistory?.landPlays?.[id] ?? 0])) },
    stack: room.stack.map(object => buildStackView(room, viewerId, object)),
    battlefield: room.battlefield.map(card => buildCardView(room, viewerId, card, true)),
    combat: room.combat.map(declaration => ({ uuid: declaration.uuid, attackerPower: declaration.attackerPower,
      attacker: buildCardView(room, viewerId, declaration.attacker), blockers: declaration.blockers.map(card => buildCardView(room, viewerId, card)),
      ...(declaration.blocked !== undefined ? { blocked: declaration.blocked } : {}),
    })),
    ...(room.combatDeclarations ? { combatDeclarations: { attackers: room.combatDeclarations.attackers, blockers: room.combatDeclarations.blockers } } : {}),
    ...(room.combatDamage ? { combatDamage: { completed: room.combatDamage.completed } } : { combatDamage: null }),
    observations: buildObservationViews(room, viewerId),
    ...(locks.length ? { publicNameLocks: locks } : {}),
    ...(hostedCards.length ? { hostedCards } : {}),
    pendingChoice: buildChoiceView(room, viewerId),
    rpsState: { status: room.rpsState.status, playedCards: Object.fromEntries(Object.entries(room.rpsState.playedCards).filter(([id, value]) => canSeeRpsPlay(room, viewerId, id) && ['rock', 'paper', 'scissors'].includes(value))) },
  };
}
