import { publicObservedCard } from './captured-windows';
import type { PermissionRule } from '../types/continuous-effect.types';
import { actionPermission } from '../shared/action-permissions';
import { cardZonePlayer } from '../shared/card-visibility';
import { sampleWithoutReplacement } from '../shared/random';
import { planTokenCreation } from './token-creation';
import { collectCardSource } from '../shared/card-collections';
import { matchesCardFilter } from '../shared/card-query';
import { CardCharacteristicService } from './card-characteristic-service';
import { roomCards } from './continuous-effect-state';
import type { CardResultSource } from '../types/resolution-result.types';
import type { CardFilter } from '../types/card-query.types';
import { abilityEffects } from './ability-effects';
// src/engine/effect-registry.ts
import type { GameMutation } from '../types/game-mutation.types';
import { findTargetCard } from '../shared/target-legality';
import type { GameRoom } from '../types/game.room.types';
import type { StackObject, StackEffect } from '../types/effect.types';
import type { ManaColor, CardInstance, CardZone, ContinuousEffectEntry, TriggeredAbility } from '../types/card.types';
import { resolveSourceInformation } from './source-information';
import { planDamage } from './damage-service';
import type { DamageAssignment } from '../types/damage.types';
import type { ReplacementDefinition } from '../types/proposed-event.types';
import { planLibraryReorder, planLibraryShuffle } from './library-operations';
import type { MoveZoneParameters } from '../types/library.types';
import { defaultEffectContext, type EffectContext } from './effect-context';
import { getCardInZone, moveDestinationPlayer, validateCardMove } from './zone-transitions';
import { legalEquipmentAttachment } from './mechanics/equipment';

export type EffectHandler = (room: GameRoom, stackObj: StackObject, effect: StackEffect, context?: EffectContext) => GameMutation[];

/** Narrow an unknown parameter value to a zone name. */
const isCardZone = (value: unknown): value is CardZone => {
  return typeof value === 'string' && ['library', 'hand', 'battlefield', 'graveyard', 'exile', 'stack'].includes(value);
};

/** Look up a permanent by uuid. */
function findCardOnBattlefield(room: GameRoom, uuid: string): CardInstance | undefined {
  return room.battlefield.find(c => c.uuid === uuid);
}

/** Look up a card by uuid in a named zone, searching every player for private zones. */
function findCardInZone(room: GameRoom, uuid: string, zone: string): CardInstance | undefined {
  if (zone === 'battlefield') return room.battlefield.find(c => c.uuid === uuid);

  for (const player of Object.values(room.players)) {
    if (zone === 'hand') {
      const found = player.hand.find(c => c.uuid === uuid);

      if (found) return found;
    }

    if (zone === 'graveyard') {
      const found = player.graveyard.find(c => c.uuid === uuid);

      if (found) return found;
    }

    if (zone === 'exile') {
      const found = player.exile?.find(c => c.uuid === uuid);

      if (found) return found;
    }

    if (zone === 'library') {
      const found = player.deck.find(c => c.uuid === uuid);

      if (found) return found;
    }
  }

  return undefined;
}

function discardHandCard(card: CardInstance): GameMutation {
  return {
    type: 'MOVE_CARD',
    cardUuid: card.uuid,
    playerId: cardZonePlayer(card),
    from: 'hand',
    to: 'graveyard',
    zoneRevision: card.state.zoneRevision ?? 0,
    reason: 'discard',
  };
}

/** A library discard is the same zone move whether chosen by mill or reveal. */
function discardLibraryCard(card: CardInstance, playerId = card.state.ownerId): GameMutation {
  return {
    type: 'MOVE_CARD',
    cardUuid: card.uuid,
    playerId,
    from: 'library',
    to: 'graveyard',
    zoneRevision: card.state.zoneRevision ?? 0,
    reason: 'discard',
  };
}

export const EffectRegistry: Record<string, EffectHandler> = {
  'ATTACH': (room, stackObj, effect) => {
    const target = effect.targets[0];

    // Guard: an attachment needs a host card and a known host revision.
    if (!target?.cardUuid || target.zoneRevision === undefined) return [];

    const operation: Extract<GameMutation, { type: 'ATTACH_CARD' }> = {
      type: 'ATTACH_CARD',
      cardUuid: stackObj.source.uuid,
      zoneRevision: stackObj.source.state.zoneRevision ?? 0,
      hostUuid: target.cardUuid,
      hostRevision: target.zoneRevision,
      controllerId: stackObj.controllerId,
    };

    return legalEquipmentAttachment(room, operation) ? [operation] : [];
  },

  'CLAIM_REVEALED_SELF': (room, stackObj, effect) => {
    // Guard: only a triggered ability responding to its own reveal may claim it.
    if (stackObj.type !== 'triggered' || stackObj.triggeringEvent?.eventId !== 'CARD_REVEALED') return [];

    const revealed = stackObj.triggeringEvent.payload.revealedCard as CardInstance | undefined;

    if (revealed?.uuid !== stackObj.source.uuid) return [];

    const player = room.players[revealed.state.ownerId];
    const card = [...player.deck, ...player.hand].find(card => card.uuid === revealed.uuid &&
      card.state.zone === stackObj.source.state.zone && (card.state.zoneRevision ?? 0) === (stackObj.source.state.zoneRevision ?? 0));

    // Guard: the card must still be in a zone this effect can move it out of.
    if (!card || (card.state.zone !== 'library' && card.state.zone !== 'hand')) return [];

    const to = effect.params.discard ? 'graveyard' as const : 'hand' as const;

    // Guard: a card already in the destination zone needs no move.
    if (card.state.zone === to) return [];

    return [{
      type: 'MOVE_CARD',
      cardUuid: card.uuid,
      playerId: player.id,
      from: card.state.zone,
      to,
      zoneRevision: card.state.zoneRevision ?? 0,
      ...(effect.params.discard ? { reason: 'discard' as const } : {}),
    }];
  },

  'RESTRICT_REVEALED_NAME': (room, stackObj, effect) => {
    const revealed = publicObservedCard(room, stackObj, effect.params.from as CardResultSource);
    if (!revealed) return [];
    const name = revealed.lastKnownCharacteristics?.name ?? revealed.blueprint.name;
    const actions = effect.params.actions as PermissionRule['action'][];
    return [{
      type: 'ADD_CONTINUOUS_EFFECT',
      entry: {
        source: stackObj.source.uuid, sourceRevision: stackObj.source.state.zoneRevision ?? 0,
        sourceControllerId: stackObj.controllerId, origin: 'resolved',
        requiredZone: null, duration: 'END_OF_TURN', layer: 80, publicNameLock: true,
        scope: { names: [name] },
        effect: { type: 'PERMISSION', rules: actions.map(action => ({ action, mode: 'prohibit', players: 'opponent' })) },
      },
    }];
  },

  'CREATE_TOKEN': (room, _stackObj, effect, context = defaultEffectContext) => planTokenCreation(room, effect, context),

  'DISCARD_CAPTURED': (room, stackObj, effect) => {
    const from = effect.params.from as CardResultSource | undefined;
    if (!from || from.view === 'recorded') return [];

    const members = collectCardSource(roomCards(room), from, stackObj.resolutionResults);
    if (!members || stackObj.resolutionResults?.[from.name]?.kind !== 'captured') return [];

    return members.filter(({ card }) => card.state.zone === 'library').map(({ card }) => discardLibraryCard(card));
  },

  'DISCARD_FROM_LIBRARY': (room, stackObj, effect) => {
    const amount = effect.params.amount;
    if (effect.params.from) {
      const members = collectCardSource(roomCards(room), effect.params.from as CardResultSource, stackObj.resolutionResults);
      if (!members || (amount !== undefined && (!Number.isSafeInteger(amount) || (amount as number) < 0))) return [];
      return members.map(entry => entry.card).filter(card => card.state.zone === 'library' && matchesCardFilter(card,
        CardCharacteristicService.resolve(room, card), effect.params.filter as CardFilter ?? {}, stackObj.controllerId))
        .slice(0, amount as number | undefined).map(card => discardLibraryCard(card));
    }

    if (typeof amount !== 'number' || !Number.isSafeInteger(amount) || amount < 0) return [];

    const { card: source } = resolveSourceInformation(room, stackObj);
    const count = Math.min(Number.MAX_SAFE_INTEGER, amount + (source.lastKnownCharacteristics?.millBonus ?? 0));

    return effect.targets.flatMap(target => {
      const player = target.playerId ? room.players[target.playerId] : undefined;

      if (!player || count === 0) return [];

      return player.deck.slice(-Math.min(count, player.deck.length)).reverse()
        .map(card => discardLibraryCard(card, player.id));
    });
  },

  'DISCARD_RANDOM_FROM_HAND': (room, stackObj, effect, context = defaultEffectContext) => {
    const amount = effect.params.amount;
    if (typeof amount !== 'number' || !Number.isSafeInteger(amount) || amount <= 0) return [];

    return effect.targets.flatMap(target => {
      const hand = target.playerId ? room.players[target.playerId]?.hand : undefined;
      const eligible = hand?.filter(card => actionPermission(room, stackObj.controllerId, card, 'affect').allowed) ?? [];
      if (!eligible.length) return [];

      const selected = sampleWithoutReplacement(eligible, Math.min(amount, eligible.length), context.random);
      return selected.map(discardHandCard);
    });
  },

  'DISCARD_FROM_HAND': (room, _stackObj, effect) => effect.targets.flatMap(target => {
    const card = findTargetCard(room, target);

    return card && card.state.zone === 'hand' && target.zone === 'hand' &&
      target.zoneRevision === (card.state.zoneRevision ?? 0) ? [discardHandCard(card)] : [];
  }),

  'SHUFFLE': (room, _stackObj, effect, context = defaultEffectContext) => effect.targets.flatMap(target =>
    target.targetType === 'player' && target.playerId ? planLibraryShuffle(room, target.playerId, context.random) : []),

  'REORDER_LIBRARY': (room, _stackObj, effect) => {
    const placement = effect.params.placement;

    // Guard: a placement must be top or bottom and there must be cards to move.
    if (placement !== 'top' && placement !== 'bottom' || !effect.targets.length) return [];

    const cards = effect.targets.map(target => target.targetType === 'card' ? findTargetCard(room, target) : undefined);

    // Guard: every target must still be a library card at the expected revision.
    if (cards.some((card, index) => !card || card.state.zone !== 'library' ||
        effect.targets[index].zone !== undefined && effect.targets[index].zone !== 'library' ||
        effect.targets[index].zoneRevision !== undefined && effect.targets[index].zoneRevision !== (card.state.zoneRevision ?? 0))) return [];

    const ownerId = cards[0]!.state.ownerId;

    // Guard: a single reorder cannot span several libraries.
    if (cards.some(card => card!.state.ownerId !== ownerId)) return [];

    return planLibraryReorder(room, ownerId, cards.map(card => ({ cardUuid: card!.uuid, zoneRevision: card!.state.zoneRevision ?? 0 })), placement);
  },

  'CREATE_REPLACEMENT_EFFECT': (room, stackObj, effect) => {
    const definition = effect.params.definition as Omit<ReplacementDefinition, 'id'> | undefined;

    // Guard: a replacement definition needs an operation and a label.
    if (!definition?.operation?.type || typeof definition.label !== 'string') return [];

    const targets = effect.targets.length ? effect.targets : [undefined];

    return targets.flatMap(target => {
      const card = target?.cardUuid ? room.battlefield.find(c => c.uuid === target.cardUuid) : undefined;

      // Guard: a targeted replacement must resolve to a permanent or a player.
      if (target && !card && !target.playerId) return [];

      return [{
        type: 'ADD_REPLACEMENT_EFFECT' as const,
        effect: {
          ...structuredClone(definition),
          source: { cardUuid: stackObj.source.uuid, zoneRevision: stackObj.source.state.zoneRevision ?? 0 },
          match: { ...definition.match, ...(card ? { card: { cardUuid: card.uuid, zoneRevision: card.state.zoneRevision ?? 0 } } : target?.playerId ? { playerId: target.playerId } : {}) },
        },
      }];
    });
  },

  'REGENERATE': (room, stackObj, effect) => EffectRegistry.CREATE_REPLACEMENT_EFFECT(room, stackObj, {
    ...effect,
    params: { definition: { label: 'Regeneration', operation: { type: 'regenerate' }, match: { kinds: ['destroy'] }, uses: 1, duration: 'end_of_turn' } },
  }),

  'CREATE_DELAYED_TRIGGER': (room, stackObj, effect) => {
    const ability = effect.params.ability as TriggeredAbility | undefined;
    const lifetime = effect.params.lifetime ?? 'once';

    // Guard: the delayed trigger needs a real triggered ability with effects and a known lifetime.
    if (!ability || ability.type !== 'triggered' || !ability.triggerCondition || !abilityEffects(ability).length || !['once', 'end_of_turn', 'permanent'].includes(lifetime as string)) return [];

    return [{
      type: 'ADD_DELAYED_TRIGGER',
      registration: {
        id: '',
        source: structuredClone(stackObj.source),
        sourceInfo: resolveSourceInformation(room, stackObj),
        controllerId: stackObj.controllerId,
        ability: structuredClone(ability),
        lifetime: lifetime as 'once' | 'end_of_turn' | 'permanent',
      },
    }];
  },

  'CANCEL_ATTACK': (room, _stackObj, effect) => effect.targets.flatMap(target => {
    const card = target.cardUuid ? findCardOnBattlefield(room, target.cardUuid) : undefined;
    if (!card || !room.combat.some(item => item.attacker.uuid === card.uuid)) return [];
    return [{ type: 'CANCEL_ATTACKER' as const, cardUuid: card.uuid, zoneRevision: card.state.zoneRevision ?? 0 }];
  }),

  'COUNTER': (room, _stackObj, effect) => effect.targets.filter(target =>
    (target.targetType === 'spell' || target.targetType === 'stack') && room.stack.some(object => object.uuid === target.stackUuid))
    .map(target => ({ type: 'COUNTER_STACK', stackUuid: target.stackUuid! })),

  'MOVE_ZONE': (room, stackObj, effect) => {
    const raw = effect.params;

    // Guard: the destination, origin and library placement must all be valid zone names.
    if (!isCardZone(raw.destination) || raw.origin !== undefined && !isCardZone(raw.origin) ||
        raw.libraryPlacement !== undefined && (raw.destination !== 'library' || raw.libraryPlacement !== 'top' && raw.libraryPlacement !== 'bottom')) return [];

    const params = raw as unknown as MoveZoneParameters;
    const mutations: GameMutation[] = [];
    let targets = effect.targets;
    if (params.from) {
      const members = collectCardSource(roomCards(room), params.from, stackObj.resolutionResults) ?? [];
      targets = members
        .map(entry => entry.card)
        .filter(card => matchesCardFilter(card, CardCharacteristicService.resolve(room, card),
          params.filter ?? {}, stackObj.controllerId))
        .map(card => ({
          targetType: 'card', cardUuid: card.uuid, zone: card.state.zone, zoneRevision: card.state.zoneRevision ?? 0,
        }));
    }

    for (const target of targets) {
      // Guard: a library placement only makes sense for a single card or permanent.
      if (params.libraryPlacement && ((target.targetType !== 'card' && target.targetType !== 'permanent') || !target.cardUuid)) return [];

      if ((target.targetType === 'permanent' || target.targetType === 'card') && target.cardUuid) {
        const card = params.origin ? findCardInZone(room, target.cardUuid, params.origin) : findTargetCard(room, target);

        // Guard: the card must still be where the target says it is.
        if (!card || target.zone !== undefined && target.zone !== card.state.zone ||
            target.zoneRevision !== undefined && target.zoneRevision !== (card.state.zoneRevision ?? 0)) {
          if (params.libraryPlacement) return [];

          continue;
        }

        // Reordering an existing library occupant is a distinct operation.
        if (params.libraryPlacement && card.state.zone === 'library') return [];

        mutations.push({
          type: 'MOVE_CARD',
          cardUuid: card.uuid,
          playerId: cardZonePlayer(card),
          from: params.origin ?? card.state.zone,
          to: params.destination,
          ...(params.handRecipient === 'controller' && params.destination === 'hand'
            ? { handRecipientId: stackObj.controllerId } : {}),
          zoneRevision: card.state.zoneRevision ?? 0,
          ...(params.libraryPlacement ? { libraryPlacement: params.libraryPlacement } : {}),
        });
      } else if ((target.targetType === 'stack' || target.targetType === 'spell') && target.stackUuid) {
        // Counter target spell on stack
        const targetStackObj = room.stack.find(s => s.uuid === target.stackUuid);

        if (targetStackObj && effect.tags.includes('counter')) {
          mutations.push({ type: 'COUNTER_STACK', stackUuid: targetStackObj.uuid });
        }
      }
    }

    if (!params.libraryPlacement) return mutations;

    const groups = new Map<string, Extract<GameMutation, { type: 'MOVE_CARD' }>[]>();

    for (const mutation of mutations) {
      // Guard: every planned move must be legal before any of them commit.
      if (mutation.type !== 'MOVE_CARD' || !validateCardMove(room, mutation)) return [];

      const card = getCardInZone(room, mutation.cardUuid, mutation.playerId, mutation.from)!;
      const playerId = moveDestinationPlayer(card, mutation);
      const group = groups.get(playerId) ?? [];

      group.push(mutation);
      groups.set(playerId, group);
    }

    // Guard: the same card must not be moved twice.
    if (new Set(mutations.map(mutation => mutation.type === 'MOVE_CARD' ? mutation.cardUuid : '')).size !== mutations.length) return [];

    // Top placement reverses each group so the listed order is preserved on top.
    return [...groups.values()].flatMap(group => params.libraryPlacement === 'top' ? group.reverse() : group);
  },

  'DEAL_DAMAGE': (room, stackObj, effect) => {
    const source = resolveSourceInformation(room, stackObj);
    const assignments = effect.targets.flatMap<DamageAssignment>(target => {
      if (target.targetType === 'player' && target.playerId) return [{
        source,
        recipient: { kind: 'player' as const, playerId: target.playerId },
        amount: effect.params.amount as number,
        combat: false,
      }];

      if (target.targetType !== 'permanent' || !target.cardUuid) return [];

      const card = findTargetCard(room, target);

      return card && card.state.zone === 'battlefield' && (target.zoneRevision === undefined || target.zoneRevision === (card.state.zoneRevision ?? 0))
        ? [{
          source,
          recipient: { kind: 'permanent' as const, cardUuid: card.uuid, zoneRevision: card.state.zoneRevision ?? 0 },
          amount: effect.params.amount as number,
          combat: false,
        }] : [];
    });

    return planDamage(room, assignments);
  },

  'MODIFY_LIFE': (room, stackObj, effect) => {
    const params = effect.params as { amount: number };

    // A tagged life loss is damage, so it goes through the damage pipeline.
    if (params.amount < 0 && effect.tags.includes('damage')) {
      return planDamage(room, effect.targets.flatMap(target => target.targetType === 'player' && target.playerId
        ? [{
          source: resolveSourceInformation(room, stackObj),
          recipient: { kind: 'player' as const, playerId: target.playerId },
          amount: -params.amount,
          combat: false,
        }] : []));
    }

    const mutations: GameMutation[] = [];

    for (const target of effect.targets) {
      if (target.targetType === 'player' && target.playerId) {
        const player = room.players[target.playerId];

        if (player) {
          mutations.push({ type: 'SET_LIFE', playerId: target.playerId, amount: player.life + params.amount });
        }
      }
    }

    return mutations;
  },

  'MODIFY_STATS': (room, stackObj, effect) => {
    const rawParams = effect.params as { power?: number; toughness?: number; damage?: number };
    const duration = effect.params.duration === 'PERMANENT' ? 'PERMANENT' : 'END_OF_TURN';

    // Resolve dynamic params: use resolve-time values if available, fall back to snapshot params
    const damage = (effect.dynamicParams?.damage as number) ?? rawParams.damage;
    const power = (effect.dynamicParams?.power as number) ?? rawParams.power;
    const toughness = (effect.dynamicParams?.toughness as number) ?? rawParams.toughness;
    const sourceCard = stackObj.source as CardInstance | undefined;
    const source = sourceCard?.uuid ?? 'emblem';
    const mutations: GameMutation[] = [];
    const damageAssignments: DamageAssignment[] = [];

    for (const target of effect.targets) {
      if ((target.targetType === 'permanent' || target.targetType === 'card') && target.cardUuid) {
        const card = findCardOnBattlefield(room, target.cardUuid);

        if (!card) continue;

        if (damage !== undefined) {
          damageAssignments.push({
            source: resolveSourceInformation(room, stackObj),
            recipient: { kind: 'permanent', cardUuid: card.uuid, zoneRevision: card.state.zoneRevision ?? 0 },
            amount: damage,
            combat: false,
          });
        }

        // P/T changes are continuous effects (MTG layer 7), stored in the pool
        // and resolved on-demand by CardCharacteristicService.
        if (power !== undefined) {
          mutations.push({
            type: 'ADD_CONTINUOUS_EFFECT',
            entry: {
              source,
              layer: 7,
              effect: { type: 'STAT_DELTA', power },
              scope: { cardUuid: card.uuid, zoneRevision: card.state.zoneRevision ?? 0 },
              requiredZone: null,
              sourceControllerId: stackObj.controllerId,
              duration,
            },
          });
        }

        if (toughness !== undefined) {
          mutations.push({
            type: 'ADD_CONTINUOUS_EFFECT',
            entry: {
              source,
              layer: 7,
              effect: { type: 'STAT_DELTA', toughness },
              scope: { cardUuid: card.uuid, zoneRevision: card.state.zoneRevision ?? 0 },
              requiredZone: null,
              sourceControllerId: stackObj.controllerId,
              duration,
            },
          });
        }
      }
    }

    return [...planDamage(room, damageAssignments), ...mutations];
  },

  'ADD_COUNTER': (room, stackObj, effect) => {
    const params = effect.params as { counterType: string; amount: number };
    const mutations: GameMutation[] = [];

    for (const target of effect.targets) {
      if ((target.targetType === 'permanent' || target.targetType === 'card') && target.cardUuid) {
        const card = findCardOnBattlefield(room, target.cardUuid);

        if (!card) continue;

        mutations.push({
          type: 'ADD_COUNTER',
          cardUuid: card.uuid,
          counterType: params.counterType,
          amount: params.amount,
          sourceControllerId: stackObj.controllerId,
          sourceInfo: resolveSourceInformation(room, stackObj),
        });
      }
    }

    return mutations;
  },

  'REMOVE_COUNTER': (room, stackObj, effect) => {
    const params = effect.params as { counterType: string; amount: number };
    const mutations: GameMutation[] = [];

    for (const target of effect.targets) {
      if ((target.targetType === 'permanent' || target.targetType === 'card') && target.cardUuid) {
        const card = findCardOnBattlefield(room, target.cardUuid);

        if (!card) continue;

        mutations.push({
          type: 'REMOVE_COUNTER',
          cardUuid: card.uuid,
          counterType: params.counterType,
          amount: params.amount,
          sourceControllerId: stackObj.controllerId,
          sourceInfo: resolveSourceInformation(room, stackObj),
        });
      }
    }

    return mutations;
  },

  'DESTROY': (room, _stackObj, effect) => {
    const mutations: GameMutation[] = [];

    for (const target of effect.targets) {
      if ((target.targetType === 'permanent' || target.targetType === 'card') && target.cardUuid) {
        const card = findCardOnBattlefield(room, target.cardUuid);

        if (!card) continue;

        mutations.push({
          type: 'DESTROY_CARD',
          cardUuid: card.uuid,
          zoneRevision: card.state.zoneRevision ?? 0,
        });
      }
    }

    return mutations;
  },

  'SACRIFICE': (room, _stackObj, effect) => effect.targets.flatMap(target => {
    const card = target.cardUuid ? room.battlefield.find(c => c.uuid === target.cardUuid) : undefined;

    return card ? [{ type: 'SACRIFICE_CARD' as const, cardUuid: card.uuid, zoneRevision: card.state.zoneRevision ?? 0 }] : [];
  }),

  'TAP': (room, _stackObj, effect) => {
    const mutations: GameMutation[] = [];

    for (const target of effect.targets) {
      if ((target.targetType === 'permanent' || target.targetType === 'card') && target.cardUuid) {
        const card = findCardOnBattlefield(room, target.cardUuid);

        if (card) mutations.push({
          type: 'TAP_CARD', cardUuid: card.uuid,
          ...(effect.params.skipNextUntap === true ? { skipNextUntap: true as const } : {}),
        });
      }
    }

    return mutations;
  },

  'UNTAP': (room, _stackObj, effect) => {
    const mutations: GameMutation[] = [];

    for (const target of effect.targets) {
      if ((target.targetType === 'permanent' || target.targetType === 'card') && target.cardUuid) {
        const card = findCardOnBattlefield(room, target.cardUuid);

        if (card) mutations.push({ type: 'UNTAP_CARD', cardUuid: card.uuid });
      }
    }

    return mutations;
  },

  'DRAW_OPPONENT_TOP': (room, stackObj) => {
    const opponentId = stackObj.controllerId === room.player1Id ? room.player2Id : room.player1Id;
    const opponent = opponentId ? room.players[opponentId] : undefined;
    const top = opponent?.deck.slice(-1)[0];
    if (!opponent || !top) return [];
    return [{
      type: 'MOVE_CARD', cardUuid: top.uuid, playerId: opponent.id, zoneRevision: top.state.zoneRevision ?? 0,
      from: 'library', to: 'hand', handRecipientId: stackObj.controllerId, reason: 'draw',
    }];
  },

  'ALLOW_REVEALED_MANA': (room, stackObj, effect) => {
    const revealed = publicObservedCard(room, stackObj, effect.params.from as CardResultSource);
    if (!revealed || revealed.state.zone !== 'hand' || cardZonePlayer(revealed) !== stackObj.controllerId) return [];
    const revision = revealed.state.zoneRevision ?? 0;
    const from = effect.params.color as ManaColor;
    const colors = (revealed.lastKnownCharacteristics?.colors ?? revealed.blueprint.colors ?? []).filter(color => color !== from);
    if (!colors.length) return [];
    return [{
      type: 'ADD_CONTINUOUS_EFFECT',
      entry: {
        source: stackObj.source.uuid, sourceRevision: stackObj.source.state.zoneRevision ?? 0,
        sourceControllerId: stackObj.controllerId, origin: 'resolved',
        requiredZone: null, duration: 'END_OF_TURN', layer: 75,
        scope: { cardUuid: revealed.uuid, zoneRevision: revision, zones: ['hand'] },
        effect: { type: 'MANA_SUBSTITUTION', from, colors },
      },
    }];
  },

  'DRAW': (room, stackObj, effect) => {
    if (!room.players[stackObj.controllerId]) return [];
    return [{
      type: 'DRAW_CARDS', playerId: stackObj.controllerId, amount: effect.params.amount as number,
      ...(effect.params.position === 'bottom' ? { position: 'bottom' as const } : {}),
    }];
  },

  'ADD_MANA': (room, stackObj, effect) => {
    const player = room.players[stackObj.controllerId];
    const params = effect.params as { color: ManaColor; amount: number };

    return [{ type: 'ADD_MANA', playerId: stackObj.controllerId, color: params.color, amount: params.amount }];
  },

  // Convenience handler: decomposes into individual MOVE_ZONE primitives.
  // Per spec Section 2.3, DISCARD_HAND is replaced by multiple MOVE_ZONE calls.
  'DISCARD_HAND': (room, stackObj, _effect) => {
    const player = room.players[stackObj.controllerId];
    const mutations: GameMutation[] = [];

    for (const card of [...player.hand]) {
      mutations.push(discardHandCard(card));
    }

    return mutations;
  },

  'GRANT_STATS': (room, stackObj, effect) => {
    const params = effect.params as { power?: number; toughness?: number };
    const sourceCard = stackObj.source as CardInstance | undefined;
    const source = sourceCard?.uuid ?? 'emblem';
    const mutations: GameMutation[] = [];

    for (const target of effect.targets) {
      // Derive scope from the SAME TargetPointer used by all handlers.
      // Anthem mode (target.all): characteristic scope with filter fields.
      // Single-target mode (target.cardUuid): cardUuid scope.
      // Guard: a target must be either an anthem filter or a specific card.
      if (!target.all && !target.cardUuid) continue;

      const scope: ContinuousEffectEntry['scope'] = target.all
        ? { zones: ['battlefield'], cardTypes: target.cardTypes, subTypes: target.subTypes, controller: target.controller }
        : target.cardUuid
          ? { cardUuid: target.cardUuid, zoneRevision: findCardOnBattlefield(room, target.cardUuid)?.state.zoneRevision ?? 0 }
          : {};

      if (params.power !== undefined) {
        mutations.push({
          type: 'ADD_CONTINUOUS_EFFECT',
          entry: {
            source,
            layer: 7,
            effect: { type: 'STAT_DELTA', power: params.power },
            scope,
            duration: 'END_OF_TURN',
            origin: 'resolved',
            requiredZone: null,
            sourceControllerId: stackObj.controllerId,
          },
        });
      }

      if (params.toughness !== undefined) {
        mutations.push({
          type: 'ADD_CONTINUOUS_EFFECT',
          entry: {
            source,
            layer: 7,
            effect: { type: 'STAT_DELTA', toughness: params.toughness },
            scope,
            duration: 'END_OF_TURN',
            origin: 'resolved',
            requiredZone: null,
            sourceControllerId: stackObj.controllerId,
          },
        });
      }
    }

    return mutations;
  },

  'SET_STATS': (room, stackObj, effect) => createContinuousEffect(room, stackObj, effect,
    { type: 'SET_STATS', power: effect.params.power as number, toughness: effect.params.toughness as number }),

  'CREATE_CONTINUOUS_EFFECT': (room, stackObj, effect) => createContinuousEffect(room, stackObj, effect,
    effect.params.effect as import('../types/card.types').ContinuousEffect),
};

/** Generic resolved characteristic effect; reducer captures its affected rules objects. */
function createContinuousEffect(room: GameRoom, object: StackObject, effect: StackEffect,
  operation: import('../types/card.types').ContinuousEffect): GameMutation[] {
  // Guard: only known characteristic operations are accepted.
  if (!operation || !['COPY', 'CONTROL', 'TEXT', 'TYPE', 'COLOR', 'ABILITY', 'SET_STATS', 'STAT_DELTA', 'SWITCH_STATS', 'MILL_AMOUNT', 'PERMISSION'].includes(operation.type)) return [];

  const duration = effect.params.duration ?? 'PERMANENT';

  // Guard: the duration must be one the continuous-effect pool understands.
  if (!['END_OF_TURN', 'PERMANENT', 'WHILE_ON_BATTLEFIELD', 'WHILE_ATTACHED'].includes(duration as string)) return [];

  const create = (scope: ContinuousEffectEntry['scope']): GameMutation => ({
    type: 'ADD_CONTINUOUS_EFFECT',
    entry: {
      source: object.source.uuid,
      sourceRevision: object.source.state.zoneRevision ?? 0,
      origin: 'resolved',
      sourceControllerId: object.controllerId,
      requiredZone: effect.params.requiredZone as CardZone | null ?? null,
      layer: 7,
      effect: structuredClone(operation),
      scope,
      duration: duration as ContinuousEffectEntry['duration'],
    },
  });
  const declaredScope = effect.params.scope as ContinuousEffectEntry['scope'] | undefined;
  if (declaredScope) return [create(declaredScope)];

  return effect.targets.flatMap(target => {
    const card = target.cardUuid ? findTargetCard(room, target) : undefined;

    // A target must be a filter or a resolvable card.
    if (!target.all && !card) return [];

    const scope: ContinuousEffectEntry['scope'] = target.all
      ? { zones: ['battlefield'], cardTypes: target.cardTypes, subTypes: target.subTypes, controller: target.controller }
      : { cardUuid: card!.uuid, zoneRevision: card!.state.zoneRevision ?? 0 };

    return [create(scope)];
  });
}
