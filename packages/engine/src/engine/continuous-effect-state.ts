import type { CardInstance } from '../types/card.types';
import type { ContinuousEffectEntry } from '../types/continuous-effect.types';
import type { GameRoom } from '../types/game.room.types';

export function roomCards(room: GameRoom): CardInstance[] {
  const cards = [...room.battlefield, ...room.stack.filter(s => s.type === 'spell').map(s => s.source),
    ...Object.values(room.players).flatMap(p => [...p.hand, ...p.graveyard, ...p.deck, ...p.exile ?? []])];
  return [...new Map(cards.map(c => [c.uuid, c])).values()];
}

export function effectSource(cards: CardInstance[], entry: ContinuousEffectEntry): CardInstance | undefined {
  return cards.find(c => c.uuid === entry.source && (entry.sourceRevision === undefined || (c.state.zoneRevision ?? 0) === entry.sourceRevision) &&
    (entry.requiredZone == null || c.state.zone === entry.requiredZone));
}

export function effectIsActive(cards: CardInstance[], entry: ContinuousEffectEntry): boolean {
  const sourceDuration = entry.duration === 'WHILE_ON_BATTLEFIELD' || entry.duration === 'WHILE_ATTACHED';
  if (sourceDuration) {
    const source = effectSource(cards, { ...entry, requiredZone: 'battlefield' });
    return !!source && (entry.duration !== 'WHILE_ATTACHED' || !!source.state.attachedTo);
  }
  if (entry.requiredZone === null || (entry.origin === 'resolved' && entry.requiredZone === undefined) || entry.source === 'global' || entry.source === 'emblem') return true;
  const source = effectSource(cards, { ...entry, requiredZone: entry.requiredZone ?? 'battlefield' });
  if (!source) return false;
  return true;
}
