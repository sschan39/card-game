import { center, type Anchor, type Anchors } from './board-anchors';
import type { ImpactCue } from './board-transitions';

type Point = ReturnType<typeof center>;

function animate(layer: HTMLElement, visual: HTMLElement, frames: Keyframe[], options: KeyframeAnimationOptions) {
  layer.append(visual);
  const animation = visual.animate(frames, options);
  animation.onfinish = animation.oncancel = () => visual.remove();
  return animation;
}

function position({ x, y }: Point, scale = 1) {
  return `translate3d(${x}px, ${y}px, 0) translate(-50%, -50%) scale(${scale})`;
}

function lunge(layer: HTMLElement, anchor: Anchor, contact: Point) {
  if (!anchor.card) return [];
  const visual = document.createElement('div');
  visual.className = 'board-flight board-lunge';
  visual.style.width = `${anchor.card.offsetWidth || anchor.rect.width}px`;
  visual.append(anchor.card.cloneNode(true));
  const start = center(anchor.rect);
  return [animate(layer, visual, [
    { transform: position(start), opacity: 0.85 },
    { transform: position(contact, 1.04), opacity: 1, offset: 0.5 },
    { transform: position(start, 0.96), opacity: 0 },
  ], { duration: 420, easing: 'cubic-bezier(.2,.7,.3,1)' })];
}

function projectile(layer: HTMLElement, start: Point, end: Point, style: ImpactCue['style']) {
  const visual = document.createElement('div');
  visual.className = 'board-projectile';
  visual.dataset.impact = style;
  const angle = Math.atan2(end.y - start.y, end.x - start.x);
  const pose = (point: Point) => `${position(point)} rotate(${angle}rad)`;
  return animate(layer, visual, [
    { transform: pose(start), opacity: 0.65 },
    { transform: pose(end), opacity: 1 },
  ], { duration: 220, easing: 'ease-in' });
}

function burst(layer: HTMLElement, point: Point, style: ImpactCue['style'], delay: number) {
  const visual = document.createElement('div');
  visual.className = 'board-burst';
  visual.dataset.impact = style;
  return animate(layer, visual, [
    { transform: position(point, 0.25), opacity: 0.95 },
    { transform: position(point, 1.15), opacity: 0.8, offset: 0.4 },
    { transform: position(point, 1.85), opacity: 0 },
  ], { delay, duration: 420, easing: 'ease-out' });
}

/** Play a one-shot impact using visible anchors. Lethal hits can use the old board. */
export function playImpact(cue: ImpactCue, before: Anchors, after: Anchors, layer: HTMLElement): Animation[] {
  const destination = after.get(cue.at) ?? before.get(cue.at);
  if (!destination) return [];
  const origin = cue.from && cue.from !== cue.at ? before.get(cue.from) ?? after.get(cue.from) : undefined;
  const end = center(destination.rect);
  if (!origin) return [burst(layer, end, cue.style, 0)];

  const start = center(origin.rect);
  if (cue.style !== 'combat') {
    return [projectile(layer, start, end, cue.style), burst(layer, end, cue.style, 205)];
  }

  if (!destination.card) return [...lunge(layer, origin, end), burst(layer, end, 'combat', 150)];
  const contact = { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 };
  return [...lunge(layer, origin, contact), ...lunge(layer, destination, contact), burst(layer, contact, 'combat', 150)];
}
