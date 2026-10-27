import { useCallback, useState } from 'react';
import { AdminConfigResponseSchema } from '@card-game/protocol';
import type { AdminApi } from '../api';
import { useResource } from '../hooks';
import { Notice } from '../components/common';

export default function Configuration({ api }: { api: AdminApi }) {
  const [refresh, setRefresh] = useState(0), load = useCallback((signal: AbortSignal) => api.get('/api/admin/config', AdminConfigResponseSchema, signal), [api]);
  const state = useResource(load, refresh), config = state.data;
  return <><div className="page-heading"><div><p className="eyebrow">Server settings</p><h1>Configuration</h1><p>Current effective settings. Changes take effect after a server restart.</p></div><button onClick={() => setRefresh(value => value + 1)}>Refresh</button></div>
    <section className="panel">{state.loading && <Notice message="Loading configuration…" />}{state.error && <Notice message={state.error} error />}
      {config && <>{config.auditExportPending && <Notice message="Audit export is pending. Events remain stored; check the server's audit destination." error />}
        <dl className="settings"><dt>Environment</dt><dd>{config.profile}</dd><dt>Configuration revision</dt><dd><code>{config.revision}</code></dd>
          <dt>Room inspection</dt><dd>{config.inspectionEnabled ? 'Enabled' : 'Disabled'}</dd><dt>Development fixtures</dt><dd>{config.fixturesEnabled ? 'Enabled' : 'Disabled'}</dd><dt>Debug mode</dt><dd>{config.debugMode}</dd>
          <dt>Reconnect grace</dt><dd>{config.reconnectGraceMs / 1000} seconds</dd><dt>Game session lifetime</dt><dd>{config.sessionTtlMs / 3600000} hours</dd><dt>Admin session lifetime</dt><dd>{config.adminSessionTtlMs / 60000} minutes</dd>
          <dt>Default page size</dt><dd>{config.pageSize}</dd><dt>Decks per account</dt><dd>{config.maxDecksPerAccount}</dd></dl></>}
    </section></>;
}
