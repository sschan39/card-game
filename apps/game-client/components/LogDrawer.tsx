import { useEffect, useRef, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useGameStore } from '../store/gameStore';
import GameLog from './GameLog';

const EMPTY_LOG: never[] = [];
/** Matches the exit transition; the node is only removed once the slide is over. */
const EXIT_MS = 240;

/**
 * The log as a drawer rather than a column.
 *
 * A permanent rail costs the board a fifth of its width for information nobody reads
 * mid-combat, so the log is a tab on the right edge that slides over the felt when
 * asked for. It is not a native <details>: those hide their content the instant they
 * close, which leaves no frame to animate.
 *
 * The exit works by keeping the node mounted for the duration of the slide and
 * removing it afterwards. Nothing removes it from layout early — a `display: none`
 * or `visibility: hidden` during the transition is exactly what made earlier attempts
 * snap back instead of sliding out.
 */
export default function LogDrawer() {
  const count = useGameStore(useShallow((s) => (s.log ?? EMPTY_LOG).length));
  const [open, setOpen] = useState(false);
  const [rendered, setRendered] = useState(false);
  const timer = useRef<number | null>(null);

  useEffect(() => () => {
    if (timer.current !== null) window.clearTimeout(timer.current);
  }, []);

  const toggle = () => {
    if (timer.current !== null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
    if (open) {
      setOpen(false);
      timer.current = window.setTimeout(() => setRendered(false), EXIT_MS);
      return;
    }
    setRendered(true);
    requestAnimationFrame(() => setOpen(true));
  };

  return (
    <div className="log-drawer">
      <button
        type="button"
        className="log-drawer-tab"
        aria-expanded={open}
        aria-controls="log-drawer-panel"
        onClick={toggle}
      >
        <span className="log-drawer-label">Log</span>
        <span className="log-drawer-count">{count}</span>
      </button>
      {rendered && (
        <div id="log-drawer-panel" className="log-drawer-panel" data-open={open} inert={!open}>
          <GameLog />
        </div>
      )}
    </div>
  );
}
