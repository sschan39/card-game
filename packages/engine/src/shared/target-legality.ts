import { actionPermission } from './action-permissions';
import type { CardInstance } from '../types/card.types';
import type { GameRoom } from '../types/game.room.types';
import type { EffectDefinition, TargetGroupDefinition, TargetingDefinition, TargetPointer } from '../types/effect.types';
import { matchesTargetFilter } from './target-utils';
import { CardCharacteristicService } from '../engine/card-characteristic-service';
import { protectionApplies } from './protection';
import { collectCards } from './card-query';

export const isExplicitTargeting = (def: TargetingDefinition | undefined): def is TargetingDefinition => !!def && def.type !== 'self' && !def.all;
export const targetKey = (target: TargetPointer) => [target?.targetType,
  target?.targetType === 'player' ? target.playerId : target?.targetType === 'stack' || target?.targetType === 'spell' ? target.stackUuid : target?.cardUuid].join(':');

export function describeTargetGroups(effects: EffectDefinition[]): TargetGroupDefinition[] {
  const groups = new Map<string, TargetGroupDefinition>();
  effects.forEach((effect, index) => {
    if (!isExplicitTargeting(effect.targeting)) return;
    const id = effect.targetGroup ?? `effect-${index}`;
    if (!id.trim()) throw new Error('Target group ID must be nonempty');
    const existing = groups.get(id);
    if (existing && JSON.stringify(existing.targeting) !== JSON.stringify(effect.targeting)) throw new Error('Inconsistent targeting definitions for group ' + id);
    groups.set(id, { id, targeting: effect.targeting });
  });
  return [...groups.values()];
}

export function findTargetCard(room: GameRoom, target: TargetPointer): CardInstance | undefined {
  if ((target.targetType !== 'card' && target.targetType !== 'permanent') || !target.cardUuid) return;
  // Preserve the common battlefield lookup without collecting every private zone.
  return room.battlefield.find(card => card.uuid === target.cardUuid)
    ?? collectCards(room).find(card => card.uuid === target.cardUuid);
}

export function structuralTargetLegal(room: GameRoom, playerId: string, target: TargetPointer, def: TargetingDefinition): boolean {
  if (def.type === 'any') return !!target && (target.targetType === 'player' || target.targetType === 'permanent')
    && structuralTargetLegal(room, playerId, target, { ...def, type: target.targetType });
  if (!target || target.all || target.targetType !== def.type) return false;
  const controllerMatches = (id: string) => def.controller !== 'self' || id === playerId;
  const opponentMatches = (id: string) => def.controller !== 'opponent' || id !== playerId;
  switch (def.type) {
    case 'player': return !!target.playerId && !!room.players[target.playerId] && controllerMatches(target.playerId) && opponentMatches(target.playerId);
    case 'permanent': case 'card': {
      const card = findTargetCard(room, target);
      if (!card || !(def.type === 'permanent' ? ['battlefield'] : def.zones ?? ['battlefield']).includes(card.state.zone) ||
          (target.zoneRevision !== undefined && target.zoneRevision !== (card.state.zoneRevision ?? 0)) || !matchesTargetFilter(card, def, playerId, room)) return false;
      return true;
    }
    case 'spell': case 'stack': {
      const object = room.stack.find(s => s.uuid === target.stackUuid);
      if (!object || (def.type === 'spell' && object.type !== 'spell') || !controllerMatches(object.controllerId) || !opponentMatches(object.controllerId)) return false;
      if (def.stackTypes?.length && !def.stackTypes.includes(object.type)) return false;
      return matchesTargetFilter(object.source, { ...def, controller: undefined }, playerId, room);
    }
    case 'self': return true;
  }
}

/** Built-in permissions are shared with client highlights; engine hooks can add restrictions. */
export function targetPermissionsAllow(room: GameRoom, playerId: string, source: CardInstance | undefined, target: TargetPointer): boolean {
  if (target.targetType !== 'card' && target.targetType !== 'permanent') return true;
  const card = findTargetCard(room, target);
  if (!card || !actionPermission(room, playerId, card, 'target').allowed ||
      !actionPermission(room, playerId, card, 'affect').allowed) return false;
  const characteristics = CardCharacteristicService.resolve(room, card);
  const keywords = characteristics.keywords.map(k => k.toLowerCase());
  if (keywords.includes('shroud') || (keywords.includes('hexproof') && characteristics.controllerId !== playerId)) return false;
  if (source && protectionApplies(room, card, source)) return false;
  return true;
}
