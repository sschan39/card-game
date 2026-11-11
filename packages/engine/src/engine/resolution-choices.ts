import { actionPermission } from '../shared/action-permissions';
import { canChooseCapturedCard } from './captured-windows';
import { CardCharacteristicService } from './card-characteristic-service';
import type { PendingChoice, ChoiceAnswer, ResolutionContinuation } from '../types/choice.types';
import type { GameRoom } from '../types/game.room.types';
import type { StackObject, StackEffect, ResolutionOption, TargetPointer } from '../types/effect.types';
import { buildStackEffects, buildDynamicParams, revalidateTargets } from './resolution-planning';
import { targetOptions } from './choices';
import { targetKey, findTargetCard } from '../shared/target-legality';
import { collectCards, matchesCardFilter } from '../shared/card-query';
import type { CardInstance } from '../types/card.types';
import { collectCardSource } from '../shared/card-collections';
import { recordSearchSelection } from './resolution-results';
import { abilityUsage } from './ability-usage';
import { recordRuleUse, ruleUseAvailable } from '../rules/runtime/active-rules';
import { gameReducer } from './game-reducer';
import type { GameMutation } from '../types/game-mutation.types';

function optionUse(object: StackObject, option: ResolutionOption) {
  const abilityId = object.type === 'spell' ? 'cast' : object.ability?.id ?? 'on-enter';
  return abilityUsage(object.source, { id: `option:${abilityId}:${option.id}`, usage: option.usage }, object.controllerId);
}

/** Recheck and consume selected branch uses through the ordinary room history. */
export function planResolutionOptionUses(room: GameRoom, choice: PendingChoice, answer: ChoiceAnswer): GameMutation[] | undefined {
  if (choice.kind !== 'options' || choice.continuation.type !== 'resolution') return [];
  const { stackObj } = choice.continuation;
  const mutations: GameMutation[] = [];
  for (const option of answer.values as ResolutionOption[]) {
    const use = optionUse(stackObj, option);
    if (!use) continue;
    if (!ruleUseAvailable(room, use)) return;
    const mutation = recordRuleUse(room, use);
    mutations.push(mutation);
    room = gameReducer(room, mutation);
  }
  return mutations;
}

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

      const eligible = (player?.hand ?? []).filter(card => actionPermission(room, stackObj.controllerId, card, 'affect').allowed);
      const amount = buildDynamicParams(room, stackObj, effect).amount ?? effect.params.amount;

      // Clamp the discard count to what the player actually holds.
      const count = Number.isSafeInteger(amount) && (amount as number) >= 0
        ? Math.min(amount as number, eligible.length)
        : 0;

      return {
        ...base,
        playerId: player?.id ?? stackObj.controllerId,
        kind: 'discard',
        prompt: def.prompt ?? `Choose ${count} cards to discard from hand`,
        min: count,
        max: count,
        options: eligible.map((card) => ({
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
        options: def.options
        .filter(option => ruleUseAvailable(room, optionUse(stackObj, option)))
        .map(option => ({ id: option.id, label: option.label, value: option })),
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
        matchesCardFilter(card, def.filterView === 'printed'
          ? { ...card.blueprint, controllerId: view(card).controllerId }
          : view(card), def, stackObj.controllerId) &&
        actionPermission(room, stackObj.controllerId, card, 'affect').allowed &&
        (!def.from || canChooseCapturedCard(room, stackObj, def.from.name, card)));

      // Pinned references also fix the presentation order.
      const ordered = def.cardRefs
        ? [...admitted].sort((a, b) => def.cardRefs!.findIndex(ref => ref.cardUuid === a.uuid) - def.cardRefs!.findIndex(ref => ref.cardUuid === b.uuid))
        : admitted;

      // Take as many as available; retain an impossible mandatory minimum when empty so resolution skips it.
      const available = def.distinctBy ? new Set(ordered.map(card => card.blueprint.name)).size : ordered.length;
      const requestedMin = def.min ?? 0;
      const requestedMax = def.max ?? 1;
      const min = def.allAvailable ? available : Math.min(requestedMin, available || requestedMin);
      let max = requestedMax;
      if (def.allAvailable) max = available;
      else if (def.distinctBy) max = Math.min(requestedMax, available);

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
          ...(def.distinctBy ? { distinctGroup: card.blueprint.name } : {}),
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
export function applyResolutionChoice(room: GameRoom, choice: PendingChoice, answer: ChoiceAnswer): ResolutionContinuation {
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
      (answer.values as ResolutionOption[]).flatMap((mode) => mode.effects),
      continuation.stackObj.controllerId,
      continuation.stackObj.source,
    );
  } else if (kind === 'distribution') {
    const field = original.choice?.kind === 'distribution' ? original.choice.field ?? 'amount' : 'amount';

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

  const search = original.choice?.kind === 'search' ? original.choice : undefined;
  const object = search?.recordSelection
    ? recordSearchSelection(room, continuation.stackObj, search.recordSelection, search.from, answer.values as TargetPointer[])
    : continuation.stackObj;
  return {
    ...continuation,
    stackObj: {
      ...object,
      effects: [
        ...continuation.stackObj.effects.slice(0, continuation.effectIndex),
        ...replacements,
        ...continuation.stackObj.effects.slice(continuation.effectIndex + 1),
      ],
    },
  };
}
