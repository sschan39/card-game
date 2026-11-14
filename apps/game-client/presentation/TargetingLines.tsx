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

type Line = { id: string; selected: boolean; x: number; y: number; length: number; angle: number };

/** Show a preview to a legal target and keep the chosen links visible until the draft closes. */
export function TargetingLines({ board, room }: { board: RefObject<HTMLDivElement | null>; room: PlayerView }) {
  const targeting = useGameStore(state => state.targeting);
  const [lines, setLines] = useState<Line[]>([]);

  useLayoutEffect(() => {
    const stage = board.current;
    const source = targeting?.zone === 'hand'
      ? room.players[room.viewerId]?.hand.find(card => card.uuid === targeting.cardUuid)
      : room.battlefield.find(card => card.uuid === targeting?.cardUuid);
    if (!stage || !targeting || !source) {
      setLines([]);
      return;
    }
    const from = cardAnchor(targeting.zone, source);
    const toAnchors = (pointers: readonly TargetPointer[]) => pointers
      .map(pointer => targetAnchor(room, pointer)).filter((anchor): anchor is string => !!anchor && anchor !== from);
    const selected = new Set(toAnchors([
      ...targeting.completedGroups?.flatMap(group => group.targets) ?? [], ...targeting.collected,
    ]));
    const candidates = toAnchors(targeting.groups?.[targeting.groupIndex ?? 0]?.legalTargets ?? []);
    let hover: string | undefined;
    let frame = 0;
    const draw = () => {
      frame = 0;
      const anchors = measureAnchors(stage);
      const origin = anchors.get(from);
      if (!origin) { setLines([]); return; }
      const { x, y } = center(origin.rect);
      const preview = hover && candidates.includes(hover) ? hover : candidates.length === 1 ? candidates[0] : undefined;
      const targets = new Set(selected);
      if (preview) targets.add(preview);
      setLines([...targets].flatMap(id => {
        const target = anchors.get(id);
        if (!target) return [];
        const end = center(target.rect);
        const dx = end.x - x, dy = end.y - y;
        const distance = Math.hypot(dx, dy);
        /* The line starts at the card's centre, not 16px along the way: the arrow layer
           now sits under the hand, so the card itself hides the first stretch and the
           line reads as coming out from under it. */
        const inset = 0;
        const angle = Math.atan2(dy, dx);
        return [{
          id, selected: selected.has(id), x: x + Math.cos(angle) * inset, y: y + Math.sin(angle) * inset,
          length: distance - 2 * inset, angle,
        }];
      }));
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(draw); };
    const pointAt = (event: Event) => {
      const element = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-board-anchor]') : null;
      hover = element?.dataset.boardAnchor;
      schedule();
    };
    const clear = () => { hover = undefined; schedule(); };
    draw();
    stage.addEventListener('pointerover', pointAt);
    stage.addEventListener('focusin', pointAt);
    stage.addEventListener('pointerleave', clear);
    stage.addEventListener('scroll', schedule, true);
    stage.addEventListener('transitionend', schedule);
    window.addEventListener('resize', schedule);
    return () => {
      cancelAnimationFrame(frame);
      stage.removeEventListener('pointerover', pointAt);
      stage.removeEventListener('focusin', pointAt);
      stage.removeEventListener('pointerleave', clear);
      stage.removeEventListener('scroll', schedule, true);
      stage.removeEventListener('transitionend', schedule);
      window.removeEventListener('resize', schedule);
    };
  }, [board, room, targeting]);

  if (!targeting || !lines.length) return null;
  return <div className="board-targeting" aria-hidden="true">
    {lines.map(line => <span key={line.id} className={line.selected ? 'is-selected' : undefined} style={{
      left: line.x, top: line.y, width: line.length, transform: `rotate(${line.angle}rad)`,
    }} />)}
  </div>;
}
