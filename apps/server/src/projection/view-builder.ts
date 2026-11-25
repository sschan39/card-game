import type { GameRoom } from '@card-game/engine/types/game.room.types';
import type { StackObject, TargetPointer } from '@card-game/engine/types/effect.types';
import { MANA_COLORS } from '@card-game/engine/types/card.types';
import { collectCards } from '@card-game/engine/shared/card-query';
import { baseCardVisibleTo } from '@card-game/engine/shared/card-visibility';
import { discoverPlayerControls } from '@card-game/engine/engine/player-action-query';
import { declarationPlayer } from '@card-game/engine/shared/turn-utils';
import { describeStackObject } from '@card-game/engine/shared/action-description';
import { engineDiagnostics } from '@card-game/engine/shared/diagnostic-settings';
import { landPlayLimit } from '@card-game/engine/shared/match-rules';
import { PROTOCOL_VERSION, type PlayerView, type StackView } from '@card-game/protocol';
import { assertViewer, canSeeStackSource, canSeeHand } from './reveal-policy';
import { buildCardView } from './card-view';
import { buildObservationViews } from './observation-view';
import { buildChoiceView } from './choice-view';
import { withCharacteristicCache } from '@card-game/engine/engine/card-characteristic-service';
import { resolveSourceInformation } from '@card-game/engine/engine/source-information';
import { publicAbilityId } from './wire-identifiers';
import { projectPermanentEffects } from './permanent-effects';

export function buildStackView(room: GameRoom, viewerId: string, object: StackObject): StackView {
  const visible = canSeeStackSource(room, viewerId, object);
  const source = visible && object.type !== 'spell' ? resolveSourceInformation(room, object).card : object.source;
  const targets = visible && !object.countered && !object.fizzled ? object.targetGroups?.flatMap(group => group.targets).flatMap<TargetPointer>(target => {
    if (target.playerId && room.players[target.playerId]) return [{ targetType: target.targetType, playerId: target.playerId }];
    if (target.stackUuid && room.stack.some(entry => entry.uuid === target.stackUuid && canSeeStackSource(room, viewerId, entry)))
      return [{ targetType: target.targetType, stackUuid: target.stackUuid }];
    const card = [...room.battlefield, ...room.players[viewerId].hand].find(card => card.uuid === target.cardUuid &&
      (target.zoneRevision === undefined || (card.state.zoneRevision ?? 0) === target.zoneRevision) && baseCardVisibleTo(card, viewerId));
    return card ? [{ targetType: target.targetType, cardUuid: card.uuid, zoneRevision: card.state.zoneRevision ?? 0 }] : [];
  }) : undefined;
  return { uuid: object.uuid, type: object.type, controllerId: object.controllerId,
    source: visible ? buildCardView(room, viewerId, source) : null,
    description: visible ? describeStackObject(room, object, viewerId) : 'Hidden source · ' + object.type,
    countered: object.countered, ...(object.fizzled !== undefined ? { fizzled: object.fizzled } : {}),
    ...(targets?.length ? { targets } : {}),
    ...(visible && object.type !== 'spell' && object.ability?.id ? { abilityId: publicAbilityId(room.roomId, viewerId, object.ability.id) } : {}),
  };
}

export function buildPlayerView(room: GameRoom, viewerId: string): PlayerView {
  return buildPlayerViews(room, [viewerId])[0];
}

export function buildPlayerViews(room: GameRoom, viewerIds: readonly string[]): PlayerView[] {
  const effects = projectPermanentEffects(room);
  return withCharacteristicCache(room, () => viewerIds.map(viewerId => {
    assertViewer(room, viewerId);
    return projectPlayerView(room, viewerId, effects.effectsFor);
  }), effects.observe);
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

function projectPlayerView(room: GameRoom, viewerId: string, effectsFor: ReturnType<typeof projectPermanentEffects>['effectsFor']): PlayerView {
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
    phase: room.phase, status: room.status, debugMode: room.debugMode ?? engineDiagnostics.debugMode,
    engineState: room.engineState, turnNumber: room.turnNumber ?? 0,
    ...(room.outcome ? { outcome: { type: room.outcome.type, ...(room.outcome.type === 'win' ? { winnerId: room.outcome.winnerId } : {}),
      losses: room.outcome.losses.map(loss => ({ playerId: loss.playerId, reason: loss.reason })) } as PlayerView['outcome'] } : {}),
    activeTurnPlayerId: room.activeTurnPlayerId, priorityPlayerId: room.priorityPlayerId, lastPassedPlayerId: room.lastPassedPlayerId,
    legalActions: discoverPlayerControls(room, viewerId),
    declarationPlayerId: declarationPlayer(room), landPlayLimit: landPlayLimit(room.setup),
    turnHistory: { landPlays: Object.fromEntries(Object.keys(room.players).map(id => [id, room.turnHistory?.landPlays?.[id] ?? 0])) },
    stack: room.stack.map(object => buildStackView(room, viewerId, object)),
    battlefield: room.battlefield.map(card => {
      const view = buildCardView(room, viewerId, card, true);
      const effects = effectsFor(card);
      return effects.length ? { ...view, effects } : view;
    }),
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
  };
}
