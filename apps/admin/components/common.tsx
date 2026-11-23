export function Notice({ message, error = false }: { message: string; error?: boolean }) {
  return <p className={error ? 'notice error' : 'notice'} role={error ? 'alert' : 'status'}>{message}</p>;
}
type PaginationProps = { offset: number; limit: number; change: (offset: number) => void } &
  ({ total: number; count?: never; nextOffset?: never } | { total?: never; count: number; nextOffset: number | null });
export function Pagination({ offset, limit, total, count, nextOffset, change }: PaginationProps) {
  const end = total === undefined ? offset + (count ?? 0) : Math.min(offset + limit, total);
  const next = total === undefined ? nextOffset : offset + limit < total ? offset + limit : null;
  return <div className="pagination"><span>{end > offset ? `${offset + 1}–${end}${total === undefined ? '' : ' of ' + total}` : 'No results'}</span>
    <button disabled={offset === 0} onClick={() => change(Math.max(0, offset - limit))}>Previous</button>
    <button disabled={next == null} onClick={() => { if (next != null) change(next); }}>Next</button></div>;
}
export const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
export const array = (value: unknown): unknown[] => Array.isArray(value) ? value : [];
export const label = (value: unknown): string => typeof value === 'string' ? value.replace(/^state/, '').replace(/([a-z])([A-Z])/g, '$1 $2') : '—';
export const cardName = (card: unknown): string => String(record(record(card).blueprint).name ?? record(card).name ?? 'Card');
