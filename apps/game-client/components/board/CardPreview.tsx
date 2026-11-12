import type { CardView } from '@card-game/protocol';
import { CardSurface } from '@card-game/ui';
import { permanentBadges } from '../../presentation/permanent-statuses';

export interface PreviewRequest {
  anchor: string;
  rect: DOMRect;
}

const PREVIEW_WIDTH = 300;
const PREVIEW_HEIGHT = Math.round((PREVIEW_WIDTH * 7) / 5);
const MARGIN = 16;

/**
 * The inspection panel.
 *
 * Fixed-positioned and `pointer-events: none`, so it can never steal a click
 * from the permanent underneath it — the single most common way a hover
 * preview ruins a board. It flips to whichever side of the card has room and
 * clamps to the viewport, so it never clips against an edge.
 */
export function CardPreview({ card, rect, attachments = [] }: { card: CardView; rect: DOMRect; attachments?: readonly CardView[] }) {
  const viewportWidth = typeof window === 'undefined' ? 1440 : window.innerWidth;
  const viewportHeight = typeof window === 'undefined' ? 900 : window.innerHeight;

  const spaceRight = viewportWidth - rect.right;
  const left =
    spaceRight >= PREVIEW_WIDTH + MARGIN
      ? rect.right + MARGIN
      : Math.max(MARGIN, rect.left - PREVIEW_WIDTH - MARGIN);

  const top = Math.min(
    Math.max(MARGIN, rect.top + rect.height / 2 - PREVIEW_HEIGHT / 2),
    Math.max(MARGIN, viewportHeight - PREVIEW_HEIGHT - MARGIN),
  );

  return (
    <div
      className="card-preview"
      aria-hidden="true"
      style={{ left, top, width: PREVIEW_WIDTH, height: PREVIEW_HEIGHT }}
    >
      <CardSurface card={card} label={card.label} />
      <div className="card-preview-details">
        {card.state.isTapped && <p className="card-preview-note">Tapped</p>}
        {card.state.summoningSickness && <p className="card-preview-note">Summoning sick</p>}
        {permanentBadges(card).map(({ detail, tone }, index) => (
          <p className="card-preview-note" data-tone={tone} key={index}>{detail}</p>
        ))}
        {attachments.map(source => <p className="card-preview-note" key={source.uuid}>{source.name} attached</p>)}
      </div>
    </div>
  );
}
