import { useLayoutEffect, useState, type RefObject } from 'react';
import type { PlayerView, TargetPointer } from '@card-game/protocol';
import { useGameStore } from '../store/gameStore';
import { cardAnchor, center, measureAnchors, seatAnchor, stackAnchor } from './board-anchors';

function targetAnchor(room: PlayerView, pointer: TargetPointer) {
  if (pointer.stackUuid) return stackAnchor(pointer.stackUuid);
  if (pointer.playerId) return seatAnchor('life', pointer.playerId);
  const matches = (card: PlayerView['battlefield'][number]) => card.uuid === pointer.cardUuid &&
    (pointer.zoneRevision === undefined || (card.state.zoneRevision ?? 0) === pointer.zoneRevision);
  const permanent = room.battlefield.find(matches);
  if (permanent) return cardAnchor('battlefield', permanent);
  const handCard = room.players[room.viewerId]?.hand.find(matches);
  return handCard ? cardAnchor('hand', handCard) : undefined;
}

type Link = { from: string; to: string; kind: 'attack' | 'block' | 'skill'; draft?: boolean };
type Line = { id: string; link: Link; x: number; y: number; length: number; angle: number };

/** Draw combat and spell links across the table without taking space from either battlefield. */
export function TargetingLines({ board, room }: { board: RefObject<HTMLDivElement | null>; room: PlayerView }) {
  const targeting = useGameStore(state => state.targeting);
  const selection = useGameStore(state => state.combatSelection);
  const [lines, setLines] = useState<Line[]>([]);

  useLayoutEffect(() => {
    const stage = board.current;
    if (!stage) return;
    const links: Link[] = [];
    const defender = room.activeTurnPlayerId === room.player1Id ? room.player2Id : room.player1Id;
    const permanent = (uuid: string) => {
      const card = room.battlefield.find(value => value.uuid === uuid);
      return card && cardAnchor('battlefield', card);
    };
    const attack = (from: string, draft = false) => {
      if (defender) links.push({ from, to: seatAnchor('life', defender), kind: 'attack', draft });
    };
    for (const uuid of selection.attackers) {
      const from = permanent(uuid);
      if (from) attack(from, true);
    }
    for (const group of room.combat) {
      const from = cardAnchor('battlefield', group.attacker);
      const pending = selection.blockerPairs.filter(pair => pair.attackerUuid === group.uuid);
      for (const blocker of group.blockers) links.push({ from, to: cardAnchor('battlefield', blocker), kind: 'block' });
      for (const pair of pending) {
        const to = permanent(pair.blockerUuid);
        if (to) links.push({ from, to, kind: 'block', draft: true });
      }
      if (!group.blocked && !group.blockers.length && !pending.length) attack(from);
    }
    const top = room.stack[room.stack.length - 1];
    if (top) for (const pointer of top.targets ?? []) {
      const to = targetAnchor(room, pointer);
      if (to) links.push({ from: stackAnchor(top.uuid), to, kind: 'skill' });
    }

    const source = targeting?.zone === 'hand'
      ? room.players[room.viewerId]?.hand.find(card => card.uuid === targeting.cardUuid)
      : room.battlefield.find(card => card.uuid === targeting?.cardUuid);
    const from = targeting && source ? cardAnchor(targeting.zone, source) : undefined;
    const toAnchors = (pointers: readonly TargetPointer[]) => pointers
      .map(pointer => targetAnchor(room, pointer)).filter((anchor): anchor is string => !!anchor && anchor !== from);
    const selected = new Set(toAnchors([...targeting?.completedGroups?.flatMap(group => group.targets) ?? [], ...targeting?.collected ?? []]));
    const candidates = toAnchors(targeting?.groups?.[targeting.groupIndex ?? 0]?.legalTargets ?? []);
    if (from) for (const to of selected) links.push({ from, to, kind: 'skill' });
    if (!links.length && !(from && candidates.length)) { setLines([]); return; }

    let hover: string | undefined;
    let frame = 0;
    const draw = () => {
      frame = 0;
      const anchors = measureAnchors(stage);
      const bounds = stage.getBoundingClientRect();
      const preview = hover && candidates.includes(hover) ? hover : candidates.length === 1 ? candidates[0] : undefined;
      const current = from && preview && !selected.has(preview)
        ? [...links, { from, to: preview, kind: 'skill' as const, draft: true }] : links;
      setLines(current.flatMap(link => {
        const start = anchors.get(link.from), target = anchors.get(link.to);
        if (!start || !target || start === target) return [];
        const startRect = start.card?.getBoundingClientRect() ?? start.rect;
        const targetRect = target.card?.getBoundingClientRect() ?? target.rect;
        const a = center(startRect), b = center(targetRect);
        const dx = b.x - a.x, dy = b.y - a.y, distance = Math.hypot(dx, dy);
        if (!distance) return [];
        const ux = dx / distance, uy = dy / distance;
        const edge = (rect: DOMRect) => Math.min(rect.width / 2 / Math.abs(ux), rect.height / 2 / Math.abs(uy));
        const startInset = edge(startRect), length = distance - startInset - edge(targetRect);
        if (length < 7) return [];
        return [{ id: link.kind + ':' + link.from + '>' + link.to, link, length, angle: Math.atan2(dy, dx),
          x: a.x - bounds.left - stage.clientLeft + ux * startInset, y: a.y - bounds.top - stage.clientTop + uy * startInset }];
      }));
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(draw); };
    const pointAt = (event: Event) => {
      const element = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-board-anchor]') : null;
      hover = element?.dataset.boardAnchor;
      schedule();
    };
    const clear = () => { hover = undefined; schedule(); };
    const resize = new ResizeObserver(schedule);
    resize.observe(stage);
    draw();
    stage.addEventListener('pointerover', pointAt);
    stage.addEventListener('focusin', pointAt);
    stage.addEventListener('pointerleave', clear);
    stage.addEventListener('scroll', schedule, true);
    stage.addEventListener('transitionend', schedule);
    return () => {
      resize.disconnect();
      cancelAnimationFrame(frame);
      stage.removeEventListener('pointerover', pointAt);
      stage.removeEventListener('focusin', pointAt);
      stage.removeEventListener('pointerleave', clear);
      stage.removeEventListener('scroll', schedule, true);
      stage.removeEventListener('transitionend', schedule);
    };
  }, [board, room, targeting, selection]);

  if (!lines.length) return null;
  return <div className="board-targeting" aria-hidden="true">
    {lines.map(line => <span key={line.id} data-kind={line.link.kind} className={line.link.draft ? 'is-draft' : undefined} style={{
      left: line.x, top: line.y, width: line.length, transform: `rotate(${line.angle}rad)`,
    }} />)}
  </div>;
}
