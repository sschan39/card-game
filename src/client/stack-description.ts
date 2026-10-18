import type { GameRoom } from '../types/game.room.types';
import type { StackEffect, StackObject } from '../types/effect.types';
import { battlefieldCardLabel } from './card-label';

const TRIGGERS: Record<string, string> = {
  ON_ENTER_BATTLEFIELD: 'onEnter', ON_LEAVE_BATTLEFIELD: 'onLeave', ON_DIE: 'onDeath',
  ON_ATTACK: 'onAttack', ON_BLOCK: 'onBlock', ON_DRAW: 'onDraw', ON_SPELL_CAST: 'onCast',
  ON_DAMAGE_TAKEN: 'onDamageTaken', ON_DAMAGE_DEALT: 'onDamageDealt', COMBAT_DAMAGE: 'onCombatDamage',
  ON_LIFE_GAIN: 'onLifeGain', ON_LIFE_LOSS: 'onLifeLoss', ON_DISCARD_FROM_HAND: 'onDiscardFromHand', ON_DISCARD_FROM_LIBRARY: 'onDiscardFromLibrary', ON_SHUFFLE: 'onShuffle',
  BEGIN_UPKEEP: 'onUpkeep', END_OF_TURN: 'onEndStep',
};
const value = (raw: unknown) => typeof raw === 'number' || typeof raw === 'string' ? String(raw) : 'variable';

function effectDescription(effect: StackEffect): string {
  const amount = effect.params.amount;
  switch (effect.action) {
    case 'MODIFY_LIFE': return typeof amount === 'number' ? amount >= 0 ? `heal ${amount}`
      : `${effect.tags?.includes('damage') ? 'damage' : 'lose life'} ${-amount}` : `change life ${value(amount)}`;
    case 'DRAW': return `draw ${value(amount)}`;
    case 'MODIFY_STATS': return effect.params.damage !== undefined ? `damage ${value(effect.params.damage)}` : 'modify stats';
    case 'DISCARD_FROM_HAND': return `discard ${value(amount)} from hand`;
    case 'DISCARD_FROM_LIBRARY': return `discard ${value(amount)} from library`;
    case 'ADD_MANA': return `add ${value(amount)} ${value(effect.params.color)} mana`;
    case 'GRANT_STATS': return `buff ${value(effect.params.power ?? 0)}/${value(effect.params.toughness ?? 0)}`;
    default: return effect.action.toLowerCase().replace(/_/g, ' ') + (amount !== undefined ? ' ' + value(amount) : '');
  }
}

/** Display existing stack instructions; this does not infer resolution success. */
export function describeStackObject(room: GameRoom, object: StackObject, viewerId?: string | null): string {
  const ability = object.type === 'spell' ? undefined : object.ability;
  let label = object.type === 'spell' ? 'onPlay' : object.type === 'activated' ? 'activate'
    : ability?.type === 'triggered' ? TRIGGERS[ability.triggerCondition] ?? ability.triggerCondition
    : object.triggeringEvent?.eventId === 'PERMANENT_ENTERED' ? 'onEnter' : 'trigger';
  if (object.type === 'triggered' && ability?.type === 'triggered' && ability.trigger?.subject === 'another')
    label = label.replace(/^on/, 'onAnother');
  const effects = object.effects.map(effect => {
    const targets = effect.targets.map(target => {
      if (target.playerId) return target.playerId === viewerId ? 'You' : 'Opponent';
      const card = room.battlefield.find(card => card.uuid === target.cardUuid &&
        (target.zoneRevision === undefined || (card.state.zoneRevision ?? 0) === target.zoneRevision));
      if (card) return battlefieldCardLabel(room, card);
      const stack = room.stack.find(item => item.uuid === target.stackUuid);
      return stack?.source.blueprint.name ?? (target.cardUuid ? 'selected card' : undefined);
    }).filter(Boolean);
    return effectDescription(effect) + (targets.length ? ' → ' + [...new Set(targets)].join(', ') : '');
  }).join('; ');
  return `${battlefieldCardLabel(room, object.source)} · ${label}: { ${effects || 'no effects'} }`;
}
