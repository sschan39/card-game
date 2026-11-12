import type { PermanentBadge } from '../../presentation/permanent-statuses';

/** The badges and tint are derived from the current card, including after reconnect. */
export function PermanentStatus({ badges }: { badges: PermanentBadge[] }) {
  if (!badges.length) return null;
  const scorch = badges.some(badge => badge.tone === 'scorch');
  const visible = badges.slice(0, 3);
  return <div className={scorch ? 'permanent-status is-scorched' : 'permanent-status'}
    role="img" aria-label={badges.map(badge => badge.detail).join(', ')}>
    {visible.map(({ label, tone }, index) => <span data-tone={tone} key={index}>{label}</span>)}
    {badges.length > visible.length && <span>+{badges.length - visible.length}</span>}
  </div>;
}
