import { useState } from 'react';
import { useGameStore } from '../store/gameStore';
import GameLog from './GameLog';

export default function LogDrawer() {
  const count = useGameStore(state => state.log.length);
  const [open, setOpen] = useState(false);
  return <div className="log-drawer" data-open={open}>
    <button type="button" aria-expanded={open} aria-controls={open ? 'match-log' : undefined} onClick={() => setOpen(!open)}>
      Log <span>{count}</span>
    </button>
    {open && <GameLog />}
  </div>;
}
