import { useT } from '@card-game/ui';
/**
 * Shown instead of the board when the viewport cannot hold a landscape table.
 *
 * The board is a table: it needs width. Rather than squeeze a 5/7 card into a
 * portrait window until the rules text is unreadable, the client says so
 * plainly and tells the player what to do about it.
 */
export default function RotateGate() {
  const t = useT();
  return (
    <div className="rotate-gate" role="status">
      <div className="rotate-gate-card">
        <p className="rotate-gate-eyebrow">{t('board.landscapeRequired')}</p>
        <h1>{t('board.turnDevice')}</h1>
        <p>{t('board.rotateHint')}</p>
      </div>
    </div>
  );
}
