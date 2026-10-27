import { useCallback, useState } from 'react';
import { AdminLogsResponseSchema } from '@card-game/protocol';
import type { AdminApi } from '../api';
import { adminUi } from '../config';
import { useResource } from '../hooks';
import { Notice } from '../components/common';

export default function Logs({ api }: { api: AdminApi }) {
  const [cursor, setCursor] = useState<string | undefined>(), [history, setHistory] = useState<(string | undefined)[]>([]), [refresh, setRefresh] = useState(0);
  const load = useCallback((signal: AbortSignal) => api.get('/api/admin/deltas?limit=' + adminUi.pageSize + (cursor ? '&cursor=' + encodeURIComponent(cursor) : ''), AdminLogsResponseSchema, signal), [api, cursor]);
  const state = useResource(load, refresh);
  const reset = () => { setCursor(undefined); setHistory([]); setRefresh(value => value + 1); };
  return <><div className="page-heading"><div><p className="eyebrow">Diagnostics</p><h1>Game logs</h1><p>Browse recorded game changes one page at a time.</p></div><button onClick={reset}>Refresh from beginning</button></div>
    <section className="panel">{state.loading && <Notice message="Loading log entries…" />}{state.error && <Notice message={state.error} error />}
      {state.data && <>{state.data.skipped > 0 && <Notice message={`${state.data.skipped} malformed or oversized entries were skipped.`} />}
        {!state.data.entries.length && <Notice message={state.data.eof ? 'No more complete entries.' : 'This section contains no displayable entries. Continue to the next page.'} />}
        <div className="log-entries">{state.data.entries.map(entry => <details key={entry.offset}><summary>Entry at byte {entry.offset}</summary><pre>{JSON.stringify(entry.value, null, 2)}</pre></details>)}</div>
        <div className="pagination"><span>{state.data.entries.length} entries · {state.data.eof ? 'End of current log' : 'More available'}</span>
          <button disabled={!history.length} onClick={() => { setCursor(history[history.length - 1]); setHistory(values => values.slice(0, -1)); }}>Previous</button>
          <button disabled={state.data.eof || !state.data.nextCursor} onClick={() => { setHistory(values => [...values, cursor]); setCursor(state.data!.nextCursor ?? undefined); }}>Next</button></div></>}
    </section></>;
}
