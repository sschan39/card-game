import type { CardView } from '@card-game/protocol';

/** The badges and tint are derived from the current card, including after reconnect. */
export function PermanentStatus({ counters }: { counters: CardView['state']['counters'] }) {
  const entries = Object.entries(counters ?? {}).filter(([, count]) => count > 0);
  if (!entries.length) return null;
  const scorch = entries.find(([name]) => name === 'scorch');
  const visible = scorch ? [scorch, ...entries.filter(([name]) => name !== 'scorch')] : entries;
  const label = ([name, count]: [string, number]) => `${name === 'scorch' ? 'Scorch' : name} ${count}`;
  return <div className={scorch ? 'permanent-status is-scorched' : 'permanent-status'}
    role="img" aria-label={visible.map(label).join(', ')}>
    {visible.slice(0, 2).map(entry => <span key={entry[0]}>{label(entry)}</span>)}
    {visible.length > 2 && <span>+{visible.length - 2}</span>}
  </div>;
}
