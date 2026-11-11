import { canChooseCapturedCard } from './captured-windows';
import { CardCharacteristicService } from './card-characteristic-service';
import type { PendingChoice, ChoiceAnswer, ResolutionContinuation } from '../types/choice.types';
import type { GameRoom } from '../types/game.room.types';
import type { StackObject, StackEffect, ModeDefinition, TargetPointer } from '../types/effect.types';
import { buildStackEffects, buildDynamicParams, revalidateTargets } from './resolution-planning';
import { targetOptions } from './choices';
import { targetKey, findTargetCard } from '../shared/target-legality';
import { collectCards, matchesCardFilter } from '../shared/card-query';
import type { CardInstance } from '../types/card.types';
import { collectCardSource } from '../shared/card-collections';

/** Build the pending choice for one effect that needs a player decision. */
export function resolutionChoice(room: GameRoom, stackObj: StackObject, effect: StackEffect, index: number, results: ResolutionContinuation['results']): PendingChoice {
  const def = effect.choice!;
  const base = {
    id: '',
    playerId: stackObj.controllerId,
    kind: def.kind,
    prompt: def.prompt ?? `Choose: ${def.kind}`,
    continuation: { type: 'resolution' as const, stackObj, effectIndex: index, results },
  };

  switch (def.kind) {
    case 'discard': {
      const targets = revalidateTargets(room, effect, stackObj.controllerId, stackObj.source).targets;
      const recipients = targets.filter((target) => target.targetType === 'player' && target.playerId);
      const player = recipients.length === 1 ? room.players[recipients[0].playerId!] : undefined;

      const amount = buildDynamicParams(room, stackObj, effect).amount ?? effect.params.amount;

      // Clamp the discard count to what the player actually holds.
      const count = Number.isSafeInteger(amount) && (amount as number) >= 0
        ? Math.min(amount as number, player?.hand.length ?? 0)
        : 0;

      return {
        ...base,
        playerId: player?.id ?? stackObj.controllerId,
        kind: 'discard',
        prompt: def.prompt ?? `Choose ${count} cards to discard from hand`,
        min: count,
        max: count,
        options: (player?.hand ?? []).map((card) => ({
          id: card.uuid,
          label: card.blueprint.name,
          value: { targetType: 'card', cardUuid: card.uuid, zone: 'hand', zoneRevision: card.state.zoneRevision ?? 0 },
        })),
      };
    }

    case 'optional':
      return {
        ...base,
        min: 1,
        max: 1,
        options: [{ id: 'yes', label: 'Yes', value: true }, { id: 'no', label: 'No', value: false }],
      };

    case 'options': case 'ordering':
      return {
        ...base,
        min: def.kind === 'ordering' ? def.options.length : def.min ?? 1,
        max: def.kind === 'ordering' ? def.options.length : def.max ?? 1,
        options: def.options.map((option) => ({ id: option.id, label: option.label, value: option })),
      };

    case 'search': {
      // Cache only for this immutable choice snapshot, never across committed mutations.
      const values = new Map<string, ReturnType<typeof CardCharacteristicService.resolve>>();

      const view = (card: CardInstance) => {
        let value = values.get(card.uuid);

        if (!value) {
          value = CardCharacteristicService.resolve(room, card);
          values.set(card.uuid, value);
        }

        return value;
      };

      const zoneCards = collectCards(room, { zones: [def.zone], zonePlayer: def.zonePlayer ?? 'self' }, stackObj.controllerId,
        card => view(card).controllerId);
      const cards = collectCardSource(zoneCards, def.from, stackObj.resolutionResults)?.map(entry => entry.card) ?? [];

      // Apply the pinned references and the authored card filter.
      const admitted = cards.filter(card => (!def.cardRefs || def.cardRefs.some(ref => ref.cardUuid === card.uuid && ref.zoneRevision === (card.state.zoneRevision ?? 0))) &&
        matchesCardFilter(card, view(card), def, stackObj.controllerId) &&
        (!def.from || canChooseCapturedCard(room, stackObj, def.from.name, card)));

      // Pinned references also fix the presentation order.
      const ordered = def.cardRefs
        ? [...admitted].sort((a, b) => def.cardRefs!.findIndex(ref => ref.cardUuid === a.uuid) - def.cardRefs!.findIndex(ref => ref.cardUuid === b.uuid))
        : admitted;

      // Take as many as available; retain an impossible mandatory minimum when empty so resolution skips it.
      const min = def.allAvailable ? ordered.length : ordered.length ? Math.min(def.min ?? 0, ordered.length) : def.min ?? 0;
      const max = def.allAvailable ? ordered.length : def.max ?? 1;

      return {
        ...base,
        kind: def.ordered ? 'ordering' : 'search',
        prompt: def.prompt ?? (def.ordered
          ? `Choose ${min === max ? min : `${min}–${max}`} cards in top-to-bottom order`
          : base.prompt),
        min,
        max,
        options: ordered.map(card => ({
          id: card.uuid,
          label: view(card).name,
          value: { targetType: 'card', cardUuid: card.uuid, zone: card.state.zone, zoneRevision: card.state.zoneRevision ?? 0 },
        })),
      };
    }

    case 'selection':
      return {
        ...base,
        min: def.criteria.minTargets ?? (def.criteria.required ? 1 : 0),
        max: def.criteria.maxTargets ?? 1,
        options: targetOptions(room, stackObj.controllerId, stackObj.source, def.criteria, false),
      };

    case 'distribution':
      return {
        ...base,
        min: 0,
        max: effect.targets.length,
        total: def.total,
        options: effect.targets.map((target) => {
          const card = findTargetCard(room, target);

          return {
            id: targetKey(target),
            label: target.playerId ?? card?.blueprint.name ?? target.stackUuid ?? 'target',
            value: card ? { ...target, zone: card.state.zone, zoneRevision: card.state.zoneRevision ?? 0 } : target,
          };
        }),
      };
  }
}

/** Replace the answered effect with the concrete effects the answer implies. */
export function applyResolutionChoice(choice: PendingChoice, answer: ChoiceAnswer): ResolutionContinuation {
  // Guard: numeric announcements are handled before resolution starts.
  if (choice.kind === 'number') throw new Error('Numeric announcement cannot resume resolution');
  if (choice.continuation.type !== 'resolution') throw new Error('Expected resolution continuation');

  const continuation = choice.continuation;
  const original = continuation.stackObj.effects[continuation.effectIndex];
  const kind = original.choice?.kind;
  const effect = { ...original, choice: undefined };

  let replacements: StackEffect[];

  if (kind === 'optional') {
    replacements = answer.values[0] ? [effect] : [];
  } else if (kind === 'options' || kind === 'ordering') {
    replacements = buildStackEffects(
      (answer.values as ModeDefinition[]).flatMap((mode) => mode.effects),
      continuation.stackObj.controllerId,
      continuation.stackObj.source,
    );
  } else if (kind === 'distribution') {
    const field = (original.choice as Extract<NonNullable<typeof original.choice>, { kind: 'distribution' }>).field ?? 'amount';

    // Preserve the authored sign so negative amounts stay negative.
    const sign = typeof effect.params[field] === 'number' && (effect.params[field] as number) < 0 ? -1 : 1;

    replacements = choice.options
      .filter((option) => (answer.allocations?.[option.id] ?? 0) > 0)
      .map((option) => ({
        ...effect,
        targeting: { type: 'self', required: false },
        params: { ...effect.params, [field]: answer.allocations![option.id] * sign },
        targets: [option.value as TargetPointer],
      }));
  } else {
    replacements = [{ ...effect, targeting: { type: 'self', required: false }, targets: answer.values as TargetPointer[] }];
  }

  return {
    ...continuation,
    stackObj: {
      ...continuation.stackObj,
      effects: [
        ...continuation.stackObj.effects.slice(0, continuation.effectIndex),
        ...replacements,
        ...continuation.stackObj.effects.slice(continuation.effectIndex + 1),
      ],
    },
  };
}
