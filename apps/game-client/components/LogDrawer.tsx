import { useT } from '@card-game/ui';
import { useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useGameStore } from '../store/gameStore';
import GameLog from './GameLog';

const EMPTY_LOG: never[] = [];

/**
 * The log as a drawer rather than a column.
 *
 * A permanent rail costs the board a fifth of its width for information nobody reads
 * mid-combat, so the log is a tab on the right edge that slides over the felt when
 * asked for.
 *
 * The panel stays mounted for its whole life. `display` now takes part in the
 * transition (`transition-behavior: allow-discrete`), so the browser itself holds the
 * node until the slide finishes — no timer, no unmount bookkeeping, and no way for the
 * exit to be cut short because a timeout and a duration drifted apart.
 */
export default function LogDrawer() {
  const t = useT();
  const count = useGameStore(useShallow((s) => (s.log ?? EMPTY_LOG).length));
  const [open, setOpen] = useState(false);

  return (
    <div className="log-drawer">
      <button
        type="button"
        className="log-drawer-tab"
        aria-expanded={open}
        aria-controls="log-drawer-panel"
        onClick={() => setOpen((value) => !value)}
      >
        <span className="log-drawer-label">{t('board.log')}</span>
        <span className="log-drawer-count">{count}</span>
      </button>
      <div id="log-drawer-panel" className="log-drawer-panel" data-open={open} inert={!open}>
        <GameLog />
      </div>
    </div>
  );
}
