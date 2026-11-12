import type { CardInstance } from '@card-game/engine/types/card.types';
import type { ContinuousEffectEntry } from '@card-game/engine/types/continuous-effect.types';
import type { GameRoom } from '@card-game/engine/types/game.room.types';
import type { AppliedCharacteristicObserver } from '@card-game/engine/engine/characteristic-layers';
import { CardCharacteristicService } from '@card-game/engine/engine/card-characteristic-service';
import { permissionRuleMatches } from '@card-game/engine/shared/permission-rule-matcher';
import { baseCardVisibility } from '@card-game/engine/shared/card-visibility';
import type { PermanentEffectView } from '@card-game/protocol';

const durations: Record<ContinuousEffectEntry['duration'], PermanentEffectView['duration']> = {
  END_OF_TURN: 'turn',
  END_OF_COMBAT: 'combat',
  WHILE_ATTACHED: 'attached',
  WHILE_ON_BATTLEFIELD: 'source',
  PERMANENT: 'ongoing',
};

/** Project a small allowlist of public facts from the actual layer evaluation. */
export function projectPermanentEffects(room: GameRoom) {
  const publicCards = new Map(room.battlefield.map(card => [card.uuid, card]));
  const applied = new Map<CardInstance, { effect: PermanentEffectView; source?: CardInstance }[]>();

  const observe: AppliedCharacteristicObserver = (card, entry, before, after) => {
    if (publicCards.get(card.uuid) !== card) return;

    const candidate = publicCards.get(entry.source);
    const source = candidate && baseCardVisibility(candidate) === 'public' &&
      (candidate.state.zoneRevision ?? 0) === entry.sourceRevision ? candidate : undefined;
    if (entry.origin !== 'resolved' && !source) return;

    const duration = entry.duration === 'PERMANENT' && entry.origin === 'static' && source && entry.requiredZone !== null
      ? entry.scope.attachedToSource ? 'attached' : 'source'
      : durations[entry.duration];
    const effects: PermanentEffectView[] = [];
    switch (entry.effect.type) {
      case 'STAT_DELTA': {
        const power = after.power - before.power;
        const toughness = after.toughness - before.toughness;
        if (power || toughness) effects.push({ kind: 'stats', power, toughness, duration });
        break;
      }
      case 'PERMISSION': {
        const rules = after.permissions.slice(before.permissions.length);
        for (const action of ['attack', 'block'] as const) {
          if (rules.some(rule => rule.mode === 'prohibit' && permissionRuleMatches(rule, after.controllerId, action))) {
            effects.push({ kind: 'restriction', action, duration });
          }
        }
        break;
      }
      case 'ABILITY':
        for (const keyword of after.keywords.filter(keyword => !before.keywords.includes(keyword))) {
          effects.push({ kind: 'keyword', keyword, duration });
        }
        break;
    }
    if (effects.length) {
      const entries = applied.get(card) ?? [];
      entries.push(...effects.map(effect => ({ effect, source })));
      applied.set(card, entries);
    }
  };

  function effectsFor(card: CardInstance): PermanentEffectView[] {
    const current = CardCharacteristicService.resolve(room, card);
    const creature = current.cardTypes.includes('Creature');
    return (applied.get(card) ?? []).flatMap(({ effect, source }) => {
      if (effect.kind === 'keyword' ? !current.keywords.includes(effect.keyword) : !creature) return [];
      return [source ? { ...effect, sourceName: CardCharacteristicService.resolve(room, source).name } : effect];
    });
  }

  return { observe, effectsFor };
}
