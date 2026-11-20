import { useT } from '@card-game/ui';
import { useEffect, useState } from 'react';
import { useGameStore } from '../store/gameStore';
import { useGameActions } from '../hooks/useGameActions';

/** The countdown is presentation only; the server owns the deadline and the final legality check. */
export default function AutoPassControl() {
  const t = useT();
  const { enabled, passAt } = useGameStore(state => state.autoPass);
  const { setAutoPass } = useGameActions();
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    setNow(Date.now());
    if (passAt === null) return;
    const timer = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(timer);
  }, [passAt]);
  const seconds = passAt === null ? null : Math.max(0, Math.ceil((passAt - now) / 1000));
  return <div className="auto-pass-control">
    <label><input type="checkbox" checked={enabled} onChange={event => setAutoPass(event.target.checked)} />
      {t('board.autoPass')}</label>
    <span role="status" aria-live="polite">{!enabled ? t('board.off') : seconds === null
      ? t('board.autoPassWaiting') : t('board.autoPassCountdown', { seconds })}</span>
  </div>;
}
