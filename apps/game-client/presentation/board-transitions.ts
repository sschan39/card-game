import type { CardView, DamageImpactView, ManaColor, PlayerView } from '@card-game/protocol';
import { cardAnchor, impactAnchor, seatAnchor, stackAnchor, STACK_LANE } from './board-anchors';

type Location = { card: CardView; anchor: string; zone: 'hand' | 'battlefield' | 'stack' | 'graveyard' | 'exile' };
export type BoardCue =
  | { kind: 'move'; card: CardView; from: string; to: string }
  | { kind: 'pulse'; at: string }
  | { kind: 'token-appear'; at: string }
  | { kind: 'token-cease'; at: string }
  | { kind: 'number'; at: string; amount: number };
export type ImpactCue = { at: string; from?: string; style: 'combat' | 'neutral' | ManaColor };

/** A mutual combat hit shows one collision. Both damage events still reached the engine. */
export function deriveImpactCues(impacts: readonly DamageImpactView[]): ImpactCue[] {
  const seen = new Set<string>();
  return impacts.flatMap(({ source, target, combat, color }) => {
    const at = impactAnchor(target);
    const from = source ? impactAnchor(source) : undefined;
    const pair = combat && source?.kind === 'permanent' && target.kind === 'permanent';
    const key = JSON.stringify(pair ? [from, at].sort() : [from, at, combat, color]);
    if (seen.has(key)) return [];
    seen.add(key);
    return [{ at, from, style: combat ? 'combat' : color ?? 'neutral' }];
  });
}

function visibleCards(view: PlayerView) {
  const locations = new Map<string, Location>();
  const add = (card: CardView, zone: Location['zone'], anchor: string) =>
    locations.set(card.uuid, { card, zone, anchor });

  for (const player of Object.values(view.players)) {
    for (const card of player.hand) add(card, 'hand', cardAnchor('hand', card));
    for (const card of player.graveyard) add(card, 'graveyard', seatAnchor('graveyard', player.id));
    for (const card of player.exile) add(card, 'exile', seatAnchor('exile', player.id));
  }
  for (const card of view.battlefield) add(card, 'battlefield', cardAnchor('battlefield', card));
  for (const object of view.stack) {
    // An ability references a card in another zone. Only spells travel to the stack.
    if (object.type === 'spell' && object.source) add(object.source, 'stack', stackAnchor(object.uuid));
  }
  return locations;
}

/** Compare two accepted views of the same board. No engine state or hidden identities. */
export function deriveBoardCues(before: PlayerView, after: PlayerView): BoardCue[] {
  if (before.roomId !== after.roomId || before.viewerId !== after.viewerId) return [];
  const previous = visibleCards(before);
  const current = visibleCards(after);
  const cues: BoardCue[] = [];

  const oldSeat = before.players[after.viewerId];
  const newSeat = after.players[after.viewerId];
  const newHandIds = new Set(newSeat?.hand.filter(card => !previous.has(card.uuid)).map(card => card.uuid));
  const drew = oldSeat && newSeat && oldSeat.deckCount - newSeat.deckCount === newHandIds.size;
  for (const [id, location] of current) {
    if (location.card.isToken && location.zone !== 'battlefield') continue;
    const old = previous.get(id);
    if (location.card.isToken && location.zone === 'battlefield' && old?.anchor !== location.anchor) {
      cues.push({ kind: 'token-appear', at: location.anchor });
    } else if (old && old.zone !== location.zone) {
      cues.push({ kind: 'move', card: location.card, from: old.anchor, to: location.anchor });
    } else if (drew && newHandIds.has(id)) {
      // The projection supplies a deck count, so the deck origin is inferred.
      cues.push({ kind: 'move', card: location.card, from: seatAnchor('deck', after.viewerId), to: location.anchor });
    } else if (old?.anchor !== location.anchor && (location.zone === 'hand' || location.zone === 'battlefield')) {
      cues.push({ kind: 'pulse', at: location.anchor });
    } else if (old && location.zone === 'battlefield' && old.anchor === location.anchor) {
      const damage = location.card.state.damageTaken - old.card.state.damageTaken;
      if (damage > 0) cues.push({ kind: 'number', at: location.anchor, amount: -damage });
    }
  }

  for (const [id, location] of previous) {
    if (location.zone === 'battlefield' && location.card.isToken && current.get(id)?.anchor !== location.anchor) {
      cues.push({ kind: 'token-cease', at: location.anchor });
    }
  }

  const oldStack = new Set(before.stack.map(object => object.uuid));
  const newStack = new Set(after.stack.map(object => object.uuid));
  for (const id of newStack) if (!oldStack.has(id)) cues.push({ kind: 'pulse', at: stackAnchor(id) });
  if ([...oldStack].some(id => !newStack.has(id))) cues.push({ kind: 'pulse', at: STACK_LANE });

  for (const [id, player] of Object.entries(after.players)) {
    const old = before.players[id];
    if (old && player.life !== old.life) cues.push({ kind: 'number', at: seatAnchor('life', id), amount: player.life - old.life });
  }
  return cues;
}
