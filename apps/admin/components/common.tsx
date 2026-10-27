export function Notice({ message, error = false }: { message: string; error?: boolean }) {
  return <p className={error ? 'notice error' : 'notice'} role={error ? 'alert' : 'status'}>{message}</p>;
}
export function Pagination({ offset, limit, total, change }: { offset: number; limit: number; total: number; change: (offset: number) => void }) {
  return <div className="pagination"><span>{total ? `${offset + 1}–${Math.min(offset + limit, total)} of ${total}` : 'No results'}</span>
    <button disabled={offset === 0} onClick={() => change(Math.max(0, offset - limit))}>Previous</button>
    <button disabled={offset + limit >= total} onClick={() => change(offset + limit)}>Next</button></div>;
}
export const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
export const array = (value: unknown): unknown[] => Array.isArray(value) ? value : [];
export const label = (value: unknown): string => typeof value === 'string' ? value.replace(/^state/, '').replace(/([a-z])([A-Z])/g, '$1 $2') : '—';
export const cardName = (card: unknown): string => String(record(record(card).blueprint).name ?? record(card).name ?? 'Card');
