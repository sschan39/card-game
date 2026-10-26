import { CardCharacteristicService } from '@card-game/engine/engine/card-characteristic-service';
import { abilityEffects } from '@card-game/engine/engine/ability-effects';
import { describeTargetGroups, structuralTargetLegal, targetPermissionsAllow } from '@card-game/engine/shared/target-legality';
import { selectModeEffects } from '@card-game/engine/shared/action-modes';
import type { CardInstance } from '@card-game/engine/types/card.types';
import type { GameRoom } from '@card-game/engine/types/game.room.types';
import type { TargetPointer } from '@card-game/engine/types/effect.types';
import type { TargetGroupView } from '@card-game/protocol';
import { visibleTargetCards } from './reveal-policy';
import { publicAbilityId } from './wire-identifiers';

export function buildTargetGroups(room: GameRoom, viewerId: string, card: CardInstance): Record<string, TargetGroupView[]> {
  const blueprint = CardCharacteristicService.resolveBlueprint(room, card);
  const candidates: TargetPointer[] = [
    ...Object.keys(room.players).map(playerId => ({ targetType: 'player' as const, playerId })),
    ...visibleTargetCards(room, viewerId).flatMap(target => (['card', 'permanent'] as const).map(targetType => ({ targetType, cardUuid: target.uuid, zoneRevision: target.state.zoneRevision ?? 0 }))),
    ...room.stack.flatMap(target => (['spell', 'stack'] as const).map(targetType => ({ targetType, stackUuid: target.uuid }))),
  ];
  const result: Record<string, TargetGroupView[]> = {};
  const sources = [
    { key: 'cast_spell', definition: blueprint, effects: blueprint.onCastEffects ?? [], alternatives: blueprint.castRequirements.alternativeCosts },
    ...blueprint.abilities.filter(ability => ability.type === 'activated').map(ability => ({ key: 'activate_ability:' + publicAbilityId(room.roomId, viewerId, ability.id),
      definition: ability, effects: abilityEffects(ability), alternatives: ability.alternativeCosts })),
  ];
  for (const { key, definition, effects, alternatives } of sources) {
    // These actions first ask the authoritative announcement machinery to choose
    // values/routes/modes. That machinery projects its own choice options.
    if (definition.numericDeclarations?.length || alternatives?.length || definition.modes?.length) continue;
    const selected = selectModeEffects(effects, undefined, undefined, undefined);
    if (!selected) continue;
    result[key] = describeTargetGroups(selected).map(group => {
      const { type, required, minTargets, maxTargets } = group.targeting;
      return { id: group.id, targeting: { type, required, minTargets, maxTargets }, legalTargets: candidates.filter(target =>
        structuralTargetLegal(room, viewerId, target, group.targeting) && targetPermissionsAllow(room, viewerId, card, target)) };
    });
  }
  return result;
}
