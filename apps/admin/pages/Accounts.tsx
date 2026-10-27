import { useCallback, useState } from 'react';
import { AdminAccountsResponseSchema, AdminAccountResponseSchema, PROTOCOL_VERSION, type AdminAccount } from '@card-game/protocol';
import type { AdminApi } from '../api';
import { adminUi } from '../config';
import { useResource } from '../hooks';
import { Notice, Pagination } from '../components/common';

export default function Accounts({ api, actorId, ended }: { api: AdminApi; actorId: string; ended: () => void }) {
  const [offset, setOffset] = useState(0), [refresh, setRefresh] = useState(0), [confirm, setConfirm] = useState<AdminAccount | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null);
  const load = useCallback((signal: AbortSignal) => api.get(`/api/admin/accounts?offset=${offset}&limit=${adminUi.pageSize}`, AdminAccountsResponseSchema, signal), [api, offset]);
  const state = useResource(load, refresh);
  const disable = async () => {
    if (!confirm || busy) return; setBusy(true); setError(null);
    try { await api.post('/api/admin/accounts/' + encodeURIComponent(confirm.id) + '/disable', AdminAccountResponseSchema, { protocolVersion: PROTOCOL_VERSION }); if (confirm.id === actorId) ended(); setConfirm(null); setRefresh(value => value + 1); }
    catch (error) { setError(error instanceof Error ? error.message : 'Unable to disable this account.'); } finally { setBusy(false); }
  };
  return <><div className="page-heading"><div><p className="eyebrow">Access management</p><h1>Accounts</h1><p>Review accounts and withdraw access when needed.</p></div><button onClick={() => setRefresh(value => value + 1)}>Refresh</button></div>
    {confirm && <section className="confirmation" role="alertdialog" aria-label="Confirm account disable"><h2>Disable {confirm.username}?</h2><p>This signs the account out of the game and administration panel immediately.</p>
      <button className="danger" disabled={busy} onClick={() => void disable()}>{busy ? 'Disabling…' : 'Confirm disable'}</button><button disabled={busy} onClick={() => setConfirm(null)}>Cancel</button></section>}
    {error && <Notice message={error} error />}<section className="panel">{state.loading && <Notice message="Loading accounts…" />}{state.error && <Notice message={state.error} error />}
      {state.data && <><table><thead><tr><th>Username</th><th>Role</th><th>Status</th><th>Created</th><th>Access</th></tr></thead><tbody>{state.data.accounts.map(account => <tr key={account.id}><td><strong>{account.username}</strong>{account.id === actorId && <small>Your account</small>}</td><td>{account.role}</td><td><span className={'badge ' + (account.disabled ? 'muted' : 'active')}>{account.disabled ? 'Disabled' : 'Active'}</span></td><td>{new Date(account.createdAt).toLocaleDateString()}</td><td><button disabled={account.disabled || busy} onClick={() => { setConfirm(account); setError(null); }}>Disable</button></td></tr>)}</tbody></table>
        <Pagination offset={offset} limit={adminUi.pageSize} total={state.data.total} change={setOffset} /></>}
    </section></>;
}
