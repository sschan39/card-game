import { damageCause } from './change-cause';
import type { ChangeCause } from '../types/change-cause.types';
import type { GameRoom } from '../types/game.room.types';
import type { CardInstance, CardSnapshot } from '../types/card.types';
import type { GameMutation } from '../types/game-mutation.types';
import type { EventDraft, GameEventPayloads, ResolutionReport } from '../types/game-event.types';
import { captureSourceInformation } from './source-information';
import { getCardInZone, moveDestinationPlayer } from './zone-transitions';
import { validDamageAssignments } from './damage-service';
import { CardCharacteristicService } from './card-characteristic-service';
import { reduceGameOperation } from './game-reducer';
import { planDamageResults } from './damage-keywords';
import { findTargetCard } from '../shared/target-legality';
import { sameStateValue } from '../shared/state-value';
export { sameStateValue } from '../shared/state-value';

export interface AppliedMutation {
  mutation: GameMutation;
  before: GameRoom;
  after: GameRoom;
  /** Present only when the operation owns semantic derivation for this step. */
  events?: EventDraft[];
}

/** Pure derivation. New semantic events belong here; logging needs no event-specific cases. */
export function deriveAppliedEvents(
  batchBefore: GameRoom,
  batchAfter: GameRoom,
  steps: AppliedMutation[],
  resolution?: ResolutionReport,
  observe?: (before: GameRoom, after: GameRoom) => void,
): EventDraft[] {
  const events: EventDraft[] = [];
  let eventBefore = batchBefore,
    eventAfter = batchAfter;
  let eventCause: ChangeCause | undefined;

  const add = <K extends keyof GameEventPayloads>(eventId: K, payload: GameEventPayloads[K]) => {
    events.push({
      eventId,
      roomId: batchAfter.roomId,
      payload,
      ...(eventCause ? { cause: eventCause } : {}),
    } as EventDraft);
    observe?.(eventBefore, eventAfter);
  };

  // Creation and real zone transitions publish exactly the same ETB contract.
  const entered = (room: GameRoom, card: CardInstance) =>
    add('PERMANENT_ENTERED', {
      card,
      controllerId: CardCharacteristicService.resolveController(room, card),
    });

  for (const { mutation: m, before, after, events: ownedEvents } of steps) {
    eventBefore = before;
    eventAfter = after;
    eventCause = m.cause;

    // Emit a damage event, resolving the source's snapshot from the pre-step state.
    const damageEvent = (
      amount: number,
      source: string | undefined,
      combat: boolean,
      recipient: { cardUuid?: string; playerId?: string },
      retained?: CardSnapshot,
    ) => {
      const live =
        before.battlefield.find((card) => card.uuid === source) ??
        before.stack.find((object) => object.type === 'spell' && object.source.uuid === source)?.source;
      const snapshot = retained ?? (live ? captureSourceInformation(before, live) : undefined);
      const card = snapshot?.card;
      const permanent = recipient.cardUuid ? before.battlefield.find(card => card.uuid === recipient.cardUuid) : undefined;

      add('DAMAGE_DEALT', {
        card,
        controllerId: card?.state.controllerId,
        source,
        snapshot,
        amount,
        combat,
        recipient: permanent ? { ...recipient, cardTypes: CardCharacteristicService.resolveTypes(before, permanent) } : recipient,
      });
    };

    add('MUTATION_APPLIED', { mutation: m });

    // An operation that owns its own derivation supplies the events directly.
    if (ownedEvents !== undefined) {
      for (const event of ownedEvents) {
        events.push(event);
        observe?.(before, after);
      }

      continue;
    }

    if (m.type === 'TAP_CARD' || m.type === 'REGENERATE_CARD') {
      const oldCard = before.battlefield.find(card => card.uuid === m.cardUuid);
      const card = after.battlefield.find(card => card.uuid === m.cardUuid);
      if (oldCard && !oldCard.state.isTapped && card?.state.isTapped) {
        add('PERMANENT_TAPPED', { card, controllerId: CardCharacteristicService.resolveController(after, card) });
      }
    }

    if (m.type === 'ADD_COUNTER' || m.type === 'REMOVE_COUNTER') {
      const oldCard = before.battlefield.find((card) => card.uuid === m.cardUuid);
      const card = after.battlefield.find((card) => card.uuid === m.cardUuid);
      const oldCount = oldCard?.state.counters[m.counterType] ?? 0;
      const newCount = card?.state.counters[m.counterType] ?? 0;

      if (card && oldCard && newCount !== oldCount)
        add('COUNTER_CHANGED', {
          card,
          counterType: m.counterType,
          oldCount,
          newCount,
          amount: newCount - oldCount,
          targetControllerId: CardCharacteristicService.resolveController(after, card),
          controllerId: m.sourceControllerId ?? m.sourceInfo?.card.state.controllerId ?? m.cause?.controllerId,
          source: m.sourceInfo?.card.uuid ?? m.cause?.source?.card.uuid,
          sourceInfo: m.sourceInfo ?? m.cause?.source,
        });
    }

    if (m.type === 'APPLY_DAMAGE_BATCH') {
      let resultRoom = before;

      // Replay the derived damage results so their own events are published first.
      const resultSteps = (
        m.results ?? planDamageResults(before, validDamageAssignments(before, m.assignments))
      ).flatMap((mutation) => {
        const previous = resultRoom;
        const outcome = reduceGameOperation(previous, mutation);
        resultRoom = outcome.state;

        return outcome.status === 'committed'
          ? [{ mutation, before: previous, after: resultRoom, events: outcome.events }]
          : [];
      });

      const resultEvents = deriveAppliedEvents(before, after, resultSteps);

      for (const event of resultEvents) {
        events.push(event);
        observe?.(before, after);
      }

      // Track cumulative damage per card so each DAMAGE_TAKEN reports the right delta.
      const marked = new Map<string, number>();

      for (const assignment of validDamageAssignments(before, m.assignments)) {
        const { source, recipient, amount, combat } = assignment;
        eventCause = damageCause(assignment);

        if (recipient.kind === 'player') {
          damageEvent(amount, source.card.uuid, combat, { playerId: recipient.playerId }, source);
        } else {
          const previous = before.battlefield.find((card) => card.uuid === recipient.cardUuid)!;
          const card =
            after.battlefield.find(
              (card) => card.uuid === recipient.cardUuid && (card.state.zoneRevision ?? 0) === recipient.zoneRevision,
            ) ?? captureSourceInformation(before, previous).card;
          const oldDamage =
            marked.get(card.uuid) ?? before.battlefield.find((c) => c.uuid === card.uuid)!.state.damageTaken ?? 0;
          const newDamage = Math.min(oldDamage + amount, card.state.damageTaken);

          marked.set(card.uuid, newDamage);

          if (CardCharacteristicService.resolveTypes(before, previous).includes('Creature'))
            add('DAMAGE_TAKEN', {
              card,
              controllerId: CardCharacteristicService.resolveController(before, previous),
              amount,
              oldDamage,
              newDamage,
              source: source.card.uuid,
            });

          damageEvent(amount, source.card.uuid, combat, { cardUuid: card.uuid }, source);
        }
      }
    }

    if (
      m.type !== 'APPLY_DAMAGE_BATCH' &&
      (before.battlefield !== after.battlefield ||
        before.continuousEffectPool !== after.continuousEffectPool ||
        before.phase !== after.phase ||
        before.players !== after.players)
    ) {
      for (const card of after.battlefield) {
        const old = before.battlefield.find(
          (c) => c.uuid === card.uuid && (c.state.zoneRevision ?? 0) === (card.state.zoneRevision ?? 0),
        );
        if (!old) continue;
        const previous = CardCharacteristicService.resolve(before, old),
          current = CardCharacteristicService.resolve(after, card);
        if (!sameStateValue(previous, current))
          add('CHARACTERISTICS_CHANGED', {
            card,
            controllerId: current.controllerId,
            before: previous,
            after: current,
          });
      }
    }

    if (m.type === 'COUNTER_STACK') {
      const stackObj = before.stack.find((object) => object.uuid === m.stackUuid);

      if (stackObj && !after.stack.some((object) => object.uuid === m.stackUuid)) {
        add('STACK_COUNTERED', { stackObj });

        // A countered spell's card moves from the stack to its owner's graveyard.
        if (stackObj.type === 'spell') {
          const card = after.players[stackObj.source.state.ownerId].graveyard.find(
            (card) => card.uuid === stackObj.source.uuid,
          );

          if (card)
            add('CARD_MOVED', {
              cardUuid: card.uuid,
              from: 'stack',
              to: 'graveyard',
              before: stackObj.source,
              after: card,
            });
        }
      }
    }

    if (m.type === 'SET_PENDING_CHOICE') {
      if (before.pendingChoice && before.pendingChoice.id !== after.pendingChoice?.id)
        add('CHOICE_COMPLETED', {
          choiceId: before.pendingChoice.id,
          playerId: before.pendingChoice.playerId,
          kind: before.pendingChoice.kind,
        });
      if (after.pendingChoice && before.pendingChoice?.id !== after.pendingChoice.id)
        add('CHOICE_REQUESTED', {
          choiceId: after.pendingChoice.id,
          playerId: after.pendingChoice.playerId,
          kind: after.pendingChoice.kind,
        });
    }

    if (m.type === 'CREATE_TOKEN') {
      const card = after.battlefield.find((card) => card.uuid === m.cardUuid);
      if (card && !before.battlefield.some((old) => old.uuid === m.cardUuid)) {
        entered(after, card);
      }
    }

    if (m.type === 'MOVE_CARD') {
      const oldCard = getCardInZone(before, m.cardUuid, m.playerId, m.from);
      const recipient = oldCard ? moveDestinationPlayer(oldCard, m) : m.playerId;
      const newCard = getCardInZone(after, m.cardUuid, recipient, m.to);

      if (oldCard && newCard)
        add('CARD_MOVED', { cardUuid: m.cardUuid, from: m.from, to: m.to, before: oldCard, after: newCard });
      if (oldCard && newCard && m.reason === 'draw' && m.from === 'library' && m.to === 'hand')
        add('CARD_DRAWN', { card: newCard, playerId: recipient, controllerId: recipient });
      if (oldCard && newCard && m.reason === 'discard' && m.from === 'hand' && m.to === 'graveyard')
        add('CARD_DISCARDED_FROM_HAND', { card: oldCard, playerId: m.playerId, controllerId: m.playerId, ...(m.asCost ? { asCost: true } : {}) });
      if (oldCard && newCard && m.reason === 'discard' && m.from === 'library' && m.to === 'graveyard')
        add('CARD_DISCARDED_FROM_LIBRARY', { card: oldCard, playerId: m.playerId, controllerId: m.playerId, ...(m.asCost ? { asCost: true } : {}) });

      // A cast spell is announced once its card reaches the stack.
      if (m.reason === 'cast' && oldCard && newCard) {
        const stackObj = m.stackObject?.immediate
          ? m.stackObject
          : after.stack.find((object) => object.type === 'spell' && object.source.uuid === m.cardUuid);

        if (stackObj)
          add('SPELL_CAST', {
            card: stackObj.source,
            playerId: stackObj.controllerId,
            controllerId: stackObj.controllerId,
            stackObj,
          });
      }

      // Leaving the battlefield always reports a departure, plus death/destruction.
      if (m.from === 'battlefield') {
        const departed = oldCard;

        if (departed) {
          const snapshot = m.sourceSnapshot ?? captureSourceInformation(before, departed);
          const payload = { card: snapshot.card, snapshot, controllerId: snapshot.card.state.controllerId };

          const tokenCeased =
            departed.isToken === true && !after.battlefield.some((card) => card.uuid === departed.uuid);
          add('PERMANENT_LEFT', payload);
          if (tokenCeased) add('TOKEN_CEASED', { ...payload, destination: m.to });
          if (
            (newCard || tokenCeased) &&
            m.kill &&
            ['graveyard', 'exile'].includes(m.to) &&
            m.kill.victim.zoneRevision === (departed.state.zoneRevision ?? 0)
          )
            add('CREATURE_KILLED', { ...payload, destination: m.to, outcome: m.kill });

          if ((newCard || tokenCeased) && m.to === 'graveyard' && m.reason === 'destroy')
            add('PERMANENT_DESTROYED', payload);
          if (
            m.to === 'graveyard' &&
            CardCharacteristicService.resolveTypes(before, snapshot.card).includes('Creature')
          )
            add('PERMANENT_DIED', payload);
        }
      }

      if (m.to === 'battlefield' && newCard) entered(after, newCard);
    }

    if (m.type === 'SET_DAMAGE') {
      const oldCard = before.battlefield.find((card) => card.uuid === m.cardUuid);
      const card = after.battlefield.find((card) => card.uuid === m.cardUuid);
      const oldDamage = oldCard?.state.damageTaken ?? 0;
      const newDamage = card?.state.damageTaken ?? 0;

      if (card && CardCharacteristicService.resolveTypes(after, card).includes('Creature') && newDamage > oldDamage) {
        add('DAMAGE_TAKEN', {
          card,
          controllerId: CardCharacteristicService.resolveController(after, card),
          amount: newDamage - oldDamage,
          oldDamage,
          newDamage,
          source: m.source,
        });
      }

      if (card && newDamage > oldDamage)
        damageEvent(newDamage - oldDamage, m.source, m.combat ?? false, { cardUuid: card.uuid }, m.damageSourceInfo);
    }

    if (m.type === 'SET_LIFE') {
      const oldLife = before.players[m.playerId].life;
      const newLife = after.players[m.playerId].life;

      if (oldLife !== newLife) {
        add('LIFE_CHANGED', { playerId: m.playerId, oldLife, newLife, amount: newLife - oldLife });
        add(newLife > oldLife ? 'LIFE_GAINED' : 'LIFE_LOST', {
          playerId: m.playerId,
          oldLife,
          newLife,
          amount: Math.abs(newLife - oldLife),
        });

        // Life loss from a damage source is also a damage event.
        if (newLife < oldLife && m.damageSource)
          damageEvent(
            oldLife - newLife,
            m.damageSource,
            m.combat ?? false,
            { playerId: m.playerId },
            m.damageSourceInfo,
          );
      }
    }

    if (m.type === 'DECLARE_ATTACKERS') {
      add('ATTACKERS_DECLARED', { attackerIds: after.combat.map((decl) => decl.attacker.uuid) });

      for (const decl of after.combat)
        add('ATTACK_DECLARED', { card: decl.attacker, controllerId: decl.attacker.state.controllerId });
    }

    // A blocker declaration is reported once, whether completed or assigned directly.
    if (
      m.type === 'COMPLETE_BLOCKER_DECLARATION' ||
      (m.type === 'ASSIGN_BLOCKERS' && !steps.some((step) => step.mutation.type === 'COMPLETE_BLOCKER_DECLARATION'))
    )
      add('BLOCKERS_DECLARED', {
        blockerAssignments: after.combat.map((decl) => ({
          attackerUuid: decl.attacker.uuid,
          blockerUuids: decl.blockers.map((card) => card.uuid),
        })),
      });

    if (m.type === 'COMPLETE_BLOCKER_DECLARATION')
      for (const declaration of after.combat)
        for (const blocker of declaration.blockers) {
          add('BLOCK_DECLARED', {
            card: blocker,
            controllerId: blocker.state.controllerId,
            attackerUuid: declaration.attacker.uuid,
          });
        }

    // Combat damage is announced once per completed pass.
    if (
      m.type === 'SET_COMBAT_DAMAGE' &&
      m.state?.completed &&
      (!before.combatDamage?.completed || before.combatDamage.passIndex !== m.state.passIndex)
    ) {
      add('COMBAT_DAMAGE_RESOLVED', {
        currentPlayer: after.activeTurnPlayerId,
        damageAssignments: steps
          .map((step) => step.mutation)
          .filter((mutation) => mutation.type === 'APPLY_DAMAGE_BATCH'),
        pass: m.state.passes[m.state.passIndex],
      });
    }

    if (m.type === 'SET_PHASE' && before.phase !== after.phase) {
      add('PHASE_CHANGED', {
        previousPhase: before.phase,
        phase: after.phase,
        currentPlayer: after.activeTurnPlayerId,
      });

      if (after.phase === 'stateTurnStart') add('TURN_STARTED', { currentPlayer: after.activeTurnPlayerId });
      if (after.phase === 'stateDrawPhase') add('DRAW_STEP_STARTED', { currentPlayer: after.activeTurnPlayerId });
      if (after.phase === 'upkeepStep') add('UPKEEP_STARTED', { currentPlayer: after.activeTurnPlayerId });
      if (after.phase === 'stateEndPhase') add('END_STEP_STARTED', { currentPlayer: after.activeTurnPlayerId });
      if (after.phase === 'beginCombatStep') add('COMBAT_BEGIN', { currentPlayer: after.activeTurnPlayerId });
      if (after.phase === 'endCombatStep') add('COMBAT_ENDED', { currentPlayer: after.activeTurnPlayerId });
    }

    if (m.type === 'SET_TURN' && before.activeTurnPlayerId !== after.activeTurnPlayerId)
      add('TURN_SWITCHED', { previousPlayer: before.activeTurnPlayerId, newPlayer: after.activeTurnPlayerId });
    if (m.type === 'SET_PRIORITY' && before.priorityPlayerId !== after.priorityPlayerId)
      add('PRIORITY_GIVEN', { previousPlayer: before.priorityPlayerId, playerId: after.priorityPlayerId });

    // Any stack change is published, plus the proposal when something was added.
    if (!sameStateValue(before.stack, after.stack)) {
      const newAction = after.stack.find((object) => !before.stack.some((old) => old.uuid === object.uuid));

      add('STACK_UPDATED', { before: before.stack, stack: after.stack, newAction });

      if (newAction)
        add('ACTION_PROPOSED', { actionType: newAction.type, playerId: newAction.controllerId, stackObj: newAction });

      const announced = newAction?.targetGroups?.map(group => ({
        stackUuid: newAction.uuid, groupId: group.id, targets: group.targets,
      })) ?? [];
      if (m.type === 'RETARGET_STACK')
        announced.push({ stackUuid: m.stackUuid, groupId: m.groupId, targets: [m.to] });
      for (const group of announced) {
        for (const target of group.targets) {
          const card = findTargetCard(after, target);
          if (card?.state.zone !== 'battlefield' || target.zoneRevision !== (card.state.zoneRevision ?? 0)) continue;
          add('PERMANENT_TARGETED', { card, controllerId: CardCharacteristicService.resolveController(after, card),
            stackUuid: group.stackUuid, groupId: group.groupId, target });
        }
      }
    }
  }

  eventBefore = batchBefore;
  eventAfter = batchAfter;
  eventCause = undefined;

  if (resolution?.stackObj.immediate)
    add('ACTION_RESOLVED', { stackObj: resolution.stackObj, effects: resolution.effects });

  // Reveals are published once the resolving object has finished resolving.
  const revealCompleted =
    resolution &&
    (resolution.stackObj.immediate ||
      (batchBefore.stack.some((object) => object.uuid === resolution.stackObj.uuid) &&
        !batchAfter.stack.some((object) => object.uuid === resolution.stackObj.uuid)));

  if (revealCompleted) {
    const stackObj = resolution.stackObj;

    // Guard: a countered or fizzled object reveals nothing.
    if (!stackObj.countered && !stackObj.fizzled)
      for (const reveal of stackObj.resolutionReveals ?? []) {
        for (const revealedCard of reveal.cards) {
          const player = batchAfter.players[revealedCard.state.ownerId];
          const card = [...player.deck, ...player.hand].find((card) => card.uuid === revealedCard.uuid) ?? revealedCard;

          const revealedSnapshot = reveal.snapshots?.find(snapshot =>
            snapshot.card.uuid === revealedCard.uuid && snapshot.card.state.zone === revealedCard.state.zone &&
            (snapshot.card.state.zoneRevision ?? 0) === (revealedCard.state.zoneRevision ?? 0));

          add('CARD_REVEALED', {
            card,
            revealedCard,
            ...(revealedSnapshot ? { revealedSnapshot } : {}),
            sourceInfo: reveal.sourceInfo,
            controllerId: reveal.controllerId,
          });
        }
      }
  }

  // Completion notifications require the resolving object to have actually left the stack.
  if (
    resolution &&
    batchBefore.stack.some((object) => object.uuid === resolution.stackObj.uuid) &&
    !batchAfter.stack.some((object) => object.uuid === resolution.stackObj.uuid)
  ) {
    const stackObj = resolution.stackObj;

    for (const result of resolution.effects) add('STACK_ITEM_RESOLVED', { ...result, stackObj });

    add('STACK_RESOLVED', {
      effectId: stackObj.effects[0]?.action ?? 'structural',
      stackObj,
      countered: stackObj.countered,
    });
  }

  return events;
}
