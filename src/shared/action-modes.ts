import type { EffectDefinition, ModeDefinition } from '../types/effect.types';
import { isExplicitTargeting } from './target-legality';
import type { GameRoom } from '../types/game.room.types';
import { isActionTimingAllowed } from './turn-utils';

/** Resolution branches may make nontargeted selections, but cannot introduce new targets. */
export function validResolutionChoices(effects: EffectDefinition[]): boolean {
  return effects.every(effect => {
    const choice = effect.choice;
    if (!choice || (choice.kind !== 'options' && choice.kind !== 'ordering')) return true;
    return choice.options.every(option => option.effects.every(branch => !isExplicitTargeting(branch.targeting)) && validResolutionChoices(option.effects));
  });
}

export function selectModeEffects(base: EffectDefinition[], modes: ModeDefinition[] | undefined, selected: unknown, count = { min: 1, max: 1 }, timing?: { room: GameRoom; playerId: string }): EffectDefinition[] | undefined {
  if (!validResolutionChoices(base) || modes?.some(mode => !validResolutionChoices(mode.effects))) return;
  if (!modes?.length) return selected === undefined || (Array.isArray(selected) && !selected.length) ? base : undefined;
  if (!Array.isArray(selected) || selected.length < count.min || selected.length > count.max || new Set(selected).size !== selected.length ||
      selected.some(id => typeof id !== 'string' || !modes.some(mode => mode.id === id && (!timing || isActionTimingAllowed(timing.room, timing.playerId, mode.castSpeed))))) return;
  return [...base, ...selected.flatMap(id => modes.find(mode => mode.id === id)!.effects)];
}
