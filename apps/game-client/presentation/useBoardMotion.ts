import { useLayoutEffect, useRef, type RefObject } from 'react';
import type { DamageImpactView, PlayerView } from '@card-game/protocol';
import { useGameStore } from '../store/gameStore';
import { deriveBoardCues, deriveImpactCues, type BoardCue } from './board-transitions';
import { center, measureAnchors, type Anchors } from './board-anchors';
import { playImpact } from './impact-motion';

function playCue(cue: BoardCue, before: Anchors, after: Anchors, layer: HTMLElement, delay = 0) {
  if (cue.kind === 'pulse') {
    return after.get(cue.at)?.element.animate([
      { boxShadow: 'inset 0 0 0 1px #e8cb7d, 0 0 22px #d6ac5f66' },
      { boxShadow: 'inset 0 0 0 1px transparent, 0 0 2px transparent' },
    ], { duration: 440, easing: 'ease-out' });
  }

  const destination = after.get(cue.kind === 'move' ? cue.to : cue.at);
  if (!destination) return;
  const end = center(destination.rect);
  const visual = document.createElement('div');
  let animation: Animation;
  if (cue.kind === 'number') {
    visual.className = `board-number ${cue.amount < 0 ? 'is-damage' : 'is-gain'}`;
    visual.textContent = cue.amount > 0 ? `+${cue.amount}` : String(cue.amount);
    visual.style.left = `${end.x}px`;
    visual.style.top = `${end.y - 8}px`;
    layer.append(visual);
    animation = visual.animate([
      { transform: 'translate(-50%, -40%) scale(.85)', opacity: 0 },
      { transform: 'translate(-50%, -105%) scale(1.1)', opacity: 1, offset: 0.22 },
      { transform: 'translate(-50%, -190%) scale(1)', opacity: 0 },
    ], { duration: 690, delay, easing: 'ease-out' });
  } else {
    const origin = before.get(cue.from);
    if (!origin) return playCue({ kind: 'pulse', at: cue.to }, before, after, layer);
    const start = center(origin.rect);
    const face = destination.card ?? origin.card;
    visual.className = 'board-flight';
    if (face) {
      visual.append(face.cloneNode(true));
      visual.style.width = `${Math.min(130, Math.max(72, face.offsetWidth || origin.rect.width))}px`;
    } else {
      visual.classList.add('board-flight-label');
      visual.textContent = cue.card.name;
    }
    const position = (x: number, y: number, scale: number) =>
      `translate3d(${x}px, ${y}px, 0) translate(-50%, -50%) scale(${scale})`;
    layer.append(visual);
    animation = visual.animate([
      { transform: position(start.x, start.y, origin.card ? 0.95 : 0.55), opacity: 0.7 },
      { transform: position((start.x + end.x) / 2, (start.y + end.y) / 2 - 22, 1), opacity: 1, offset: 0.55 },
      { transform: position(end.x, end.y, destination.card ? 0.8 : 0.4), opacity: 0 },
    ], { duration: 380, delay, easing: 'cubic-bezier(.18, .66, .25, 1)' });
  }
  animation.onfinish = animation.oncancel = () => visual.remove();
  return animation;
}

/** Measure the old board before React commits and play against the new DOM.
 * Several deltas in one render produce one visual diff. State updates never wait for motion.
 */
export function useBoardMotion(board: RefObject<HTMLDivElement | null>, layer: RefObject<HTMLDivElement | null>, room: PlayerView | null) {
  const seq = useGameStore(state => state.lastSeq);
  const pending = useRef<{ view: PlayerView; anchors: Anchors; cues: BoardCue[]; impacts: DamageImpactView[] } | null>(null);
  const active = useRef(new Set<Animation>());
  const awaitingSnapshotRender = useRef(false);

  useLayoutEffect(() => {
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
    const reset = () => {
      pending.current = null;
      for (const animation of active.current) animation.cancel();
      active.current.clear();
    };
    const unsubscribe = useGameStore.subscribe((next, previous) => {
      if (next.roomSync !== 'live' || !next.room) { reset(); return; }
      if (next.viewUpdate === 'snapshot') {
        if (next.room === previous.room && next.lastSeq === previous.lastSeq && previous.viewUpdate === 'snapshot') return;
        awaitingSnapshotRender.current = true;
        reset();
        return;
      }
      if (awaitingSnapshotRender.current || next.lastSeq === previous.lastSeq) return;
      if (pending.current) {
        pending.current.cues = deriveBoardCues(pending.current.view, next.room);
        pending.current.impacts = [...pending.current.impacts, ...next.lastImpacts ?? []].slice(0, 12);
        return;
      }
      if (reduced.matches || !previous.room || typeof board.current?.animate !== 'function') return;
      const cues = deriveBoardCues(previous.room, next.room);
      const impacts = next.lastImpacts ?? [];
      if (cues.length || impacts.length) pending.current = { view: previous.room, anchors: measureAnchors(board.current), cues, impacts };
    });
    reduced.addEventListener('change', reset);
    return () => {
      reset();
      unsubscribe();
      reduced.removeEventListener('change', reset);
    };
  }, [board]);

  useLayoutEffect(() => {
    awaitingSnapshotRender.current = false;
    const frame = pending.current;
    pending.current = null;
    const stage = board.current;
    const effects = layer.current;
    if (!frame || !room || !stage || !effects) return;
    const after = measureAnchors(stage);
    const impacts = deriveImpactCues(frame.impacts);
    const hitAnchors = new Set(impacts.flatMap(cue => [cue.at, cue.from]));
    const animations = impacts.flatMap(cue => playImpact(cue, frame.anchors, after, effects));
    for (const cue of frame.cues.slice(0, 12)) {
      const anchor = cue.kind === 'move' ? cue.from : cue.at;
      const animation = playCue(cue, frame.anchors, after, effects, hitAnchors.has(anchor) ? 220 : 0);
      if (animation) animations.push(animation);
    }
    for (const animation of animations) {
      active.current.add(animation);
      const forget = () => active.current.delete(animation);
      animation.finished.then(forget, forget);
    }
  }, [room, seq, board, layer]);
}
