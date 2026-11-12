import type { CardView, ImpactAnchor } from '@card-game/protocol';

const permanentAnchor = (uuid: string, revision: number) => `battlefield:${uuid}:${revision}`;
export const cardAnchor = (zone: 'hand' | 'battlefield', card: CardView) =>
  zone === 'battlefield' ? permanentAnchor(card.uuid, card.state.zoneRevision ?? 0)
    : `hand:${card.uuid}:${card.state.zoneRevision ?? 0}`;
export const stackAnchor = (uuid: string) => `stack:${uuid}`;
export const seatAnchor = (zone: 'deck' | 'graveyard' | 'exile' | 'life', id: string) => `${zone}-seat:${id}`;
export const STACK_LANE = 'stack-lane';

export function impactAnchor(reference: ImpactAnchor): string {
  switch (reference.kind) {
    case 'permanent': return permanentAnchor(reference.cardUuid, reference.zoneRevision);
    case 'player': return seatAnchor('life', reference.playerId);
    case 'stack': return stackAnchor(reference.stackUuid);
  }
}

export type Anchor = { element: HTMLElement; rect: DOMRect; card: HTMLElement | null };
export type Anchors = Map<string, Anchor>;

export function center(rect: DOMRect) {
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
}

/** A scrolled-out permanent has no visible endpoint. */
export function measureAnchors(board: HTMLElement): Anchors {
  const anchors: Anchors = new Map();
  for (const element of board.querySelectorAll<HTMLElement>('[data-board-anchor]')) {
    const rect = element.getBoundingClientRect();
    if (!rect.width || !rect.height) continue;
    const { x, y } = center(rect);
    const viewport = element.closest('.board-half')?.getBoundingClientRect();
    const row = element.closest('.permanent-row.is-scroll')?.getBoundingClientRect();
    if ((viewport && (y < viewport.top || y > viewport.bottom)) ||
        (row && (x < row.left || x > row.right))) continue;
    anchors.set(element.dataset.boardAnchor!, { element, rect, card: element.querySelector('.card') });
  }
  return anchors;
}
