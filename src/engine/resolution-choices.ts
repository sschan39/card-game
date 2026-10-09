import { CardCharacteristicService } from './card-characteristic-service';
import type { PendingChoice, ChoiceAnswer, ResolutionContinuation } from '../types/choice.types';
import type { GameRoom } from '../types/game.room.types';
import type { StackObject, StackEffect, ModeDefinition, TargetPointer } from '../types/effect.types';
import { buildStackEffects } from './effect-resolver';
import { targetOptions } from './choices';
import { targetKey, findTargetCard } from '../shared/target-legality';

export function resolutionChoice(room: GameRoom, stackObj: StackObject, effect: StackEffect, index: number, results: ResolutionContinuation['results']): PendingChoice {
  const def = effect.choice!;
  const base = { id: '', playerId: stackObj.controllerId, kind: def.kind, prompt: def.prompt ?? `Choose: ${def.kind}`, continuation: { type: 'resolution' as const, stackObj, effectIndex: index, results } };
  switch (def.kind) {
    case 'optional': return { ...base, min: 1, max: 1, options: [{ id: 'yes', label: 'Yes', value: true }, { id: 'no', label: 'No', value: false }] };
    case 'options': case 'ordering': return { ...base, min: def.kind === 'ordering' ? def.options.length : def.min ?? 1, max: def.kind === 'ordering' ? def.options.length : def.max ?? 1,
      options: def.options.map(option => ({ id: option.id, label: option.label, value: option })) };
    case 'search': {
      const player = room.players[stackObj.controllerId];
      const cards = def.zone === 'battlefield' ? room.battlefield.filter(c => CardCharacteristicService.resolveController(room, c) === stackObj.controllerId)
        : def.zone === 'library' ? player.deck : def.zone === 'hand' ? player.hand : def.zone === 'graveyard' ? player.graveyard : def.zone === 'exile' ? player.exile ?? [] : room.stack.filter(s => s.type === 'spell' && s.controllerId === stackObj.controllerId).map(s => s.source);
      return { ...base, min: def.min ?? 0, max: def.max ?? 1, options: cards.filter(card => (!def.cardTypes?.length || def.cardTypes.some(type => CardCharacteristicService.resolveTypes(room, card).includes(type))) && (!def.subTypes?.length || def.subTypes.some(type => CardCharacteristicService.resolveSubTypes(room, card).includes(type))))
        .map(card => ({ id: card.uuid, label: card.blueprint.name, value: { targetType: 'card', cardUuid: card.uuid, zone: card.state.zone, zoneRevision: card.state.zoneRevision ?? 0 } })) };
    }
    case 'selection': return { ...base, min: def.criteria.minTargets ?? (def.criteria.required ? 1 : 0), max: def.criteria.maxTargets ?? 1, options: targetOptions(room, stackObj.controllerId, stackObj.source, def.criteria, false) };
    case 'distribution': return { ...base, min: 0, max: effect.targets.length, total: def.total, options: effect.targets.map(target => {
      const card = findTargetCard(room, target);
      return { id: targetKey(target), label: target.playerId ?? card?.blueprint.name ?? target.stackUuid ?? 'target',
        value: card ? { ...target, zone: card.state.zone, zoneRevision: card.state.zoneRevision ?? 0 } : target };
    }) };
  }
}

export function applyResolutionChoice(choice: PendingChoice, answer: ChoiceAnswer): ResolutionContinuation {
  if (choice.continuation.type !== 'resolution') throw new Error('Expected resolution continuation');
  const continuation = choice.continuation;
  const original = continuation.stackObj.effects[continuation.effectIndex];
  const effect = { ...original, choice: undefined };
  let replacements: StackEffect[];
  if (choice.kind === 'optional') replacements = answer.values[0] ? [effect] : [];
  else if (choice.kind === 'options' || choice.kind === 'ordering') replacements = buildStackEffects((answer.values as ModeDefinition[]).flatMap(mode => mode.effects), continuation.stackObj.controllerId, continuation.stackObj.source);
  else if (choice.kind === 'distribution') {
    const field = original.choice?.kind === 'distribution' ? original.choice.field ?? 'amount' : 'amount';
    const sign = typeof effect.params[field] === 'number' && (effect.params[field] as number) < 0 ? -1 : 1;
    replacements = choice.options.filter(option => (answer.allocations?.[option.id] ?? 0) > 0).map(option => ({ ...effect,
      targeting: { type: 'self', required: false }, params: { ...effect.params, [field]: answer.allocations![option.id] * sign }, targets: [option.value as TargetPointer] }));
  } else replacements = [{ ...effect, targeting: { type: 'self', required: false }, targets: answer.values as TargetPointer[] }];
  return { ...continuation, stackObj: { ...continuation.stackObj, effects: [
    ...continuation.stackObj.effects.slice(0, continuation.effectIndex), ...replacements,
    ...continuation.stackObj.effects.slice(continuation.effectIndex + 1),
  ] } };
}
