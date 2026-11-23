import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { AdminAccountsResponseSchema, AdminAccountResponseSchema, PASSWORD_LIMITS, PROTOCOL_VERSION, type AdminAccount } from '@card-game/protocol';
import type { AdminApi } from '../api';
import { adminUi } from '../config';
import { useResource } from '../hooks';
import { Notice, Pagination } from '../components/common';

const roleLabels = { player: 'Player', tester: 'Tester', admin: 'Admin' } as const;
type AccountForm = { kind: 'create' } | { kind: 'edit' | 'disable'; account: AdminAccount };

export default function Accounts({ api, actorId, ended, managed = false }: {
  api: AdminApi; actorId: string; ended: () => void; managed?: boolean;
}) {
  const [offset, setOffset] = useState(0);
  const [refresh, setRefresh] = useState(0);
  const [form, setForm] = useState<AccountForm | null>(null);
  const [role, setRole] = useState<AdminAccount['role']>('tester');
  const [disabled, setDisabled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const formTitle = useRef<HTMLHeadingElement>(null);
  useEffect(() => { if (form) formTitle.current?.focus(); }, [form]);
  const load = useCallback((signal: AbortSignal) => api.get(
    `/api/admin/accounts?offset=${offset}&limit=${adminUi.pageSize}`, AdminAccountsResponseSchema, signal,
  ), [api, offset]);
  const state = useResource(load, refresh);
  const edited = form?.kind === 'edit' ? form.account : null;
  const hasChanges = !!edited && (edited.role !== role || edited.disabled !== disabled);
  const open = (value: AccountForm) => {
    setForm(value);
    setRole(value.kind === 'create' ? 'tester' : value.account.role);
    setDisabled(value.kind === 'create' ? false : value.account.disabled);
    setError(null);
    setNotice(null);
  };
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!form || busy || form.kind === 'edit' && !hasChanges) return;
    const fields = new FormData(event.currentTarget);
    setBusy(true);
    setError(null);
    try {
      const result = form.kind === 'create'
        ? await api.post('/api/admin/accounts', AdminAccountResponseSchema, {
          protocolVersion: PROTOCOL_VERSION, username: fields.get('username'), password: fields.get('password'), role,
        })
        : form.kind === 'disable'
          ? await api.post('/api/admin/accounts/' + encodeURIComponent(form.account.id) + '/disable',
            AdminAccountResponseSchema, { protocolVersion: PROTOCOL_VERSION })
          : await api.mutate('/api/admin/accounts/' + encodeURIComponent(form.account.id), 'PATCH', {
            protocolVersion: PROTOCOL_VERSION,
            ...(role !== form.account.role ? { role } : {}),
            ...(disabled !== form.account.disabled ? { disabled } : {}),
          }, AdminAccountResponseSchema);
      const account = result.account;
      setForm(null);
      setNotice(`${account.username} ${form.kind === 'create' ? 'was created' : 'access was updated'}.`);
      setRefresh(value => value + 1);
      if (account.id === actorId && (account.disabled || account.role !== 'admin')) ended();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to save account access.');
    } finally { setBusy(false); }
  }

  return <>
    <div className="page-heading">
      <div><p className="eyebrow">Access management</p><h1>Accounts</h1><p>Review accounts and manage access.</p></div>
      <div className="account-actions">
        {managed && <button className="primary" disabled={busy} onClick={() => open({ kind: 'create' })}>New account</button>}
        <button disabled={busy} onClick={() => setRefresh(value => value + 1)}>Refresh</button>
      </div>
    </div>
    {form?.kind === 'disable' && <section className="confirmation" role="alertdialog" aria-labelledby="disable-account-title">
      <h2 id="disable-account-title" ref={formTitle} tabIndex={-1}>Disable {form.account.username}?</h2>
      <p>This signs the account out of the game and administration panel immediately.</p>
      <form onSubmit={save}>
        <button className="danger" disabled={busy} type="submit">{busy ? 'Disabling…' : 'Confirm disable'}</button>
        <button disabled={busy} type="button" onClick={() => setForm(null)}>Cancel</button>
      </form>
    </section>}
    {form && form.kind !== 'disable' && <section className="panel" aria-labelledby="account-form-title">
      <h2 id="account-form-title" ref={formTitle} tabIndex={-1}>{form.kind === 'create' ? 'Create account' : `Edit access for ${form.account.username}`}</h2>
      {edited && <p>Role or status changes end the account’s current sessions.</p>}
      <form className="account-form" onSubmit={save}>
        <fieldset disabled={busy}>
          <legend>{form.kind === 'create' ? 'New account details' : 'Access settings'}</legend>
          {form.kind === 'create' && <>
            <label>Username<input name="username" autoComplete="off" required minLength={3} maxLength={32} /></label>
            <label>Initial password<input name="password" type="password" autoComplete="new-password" required minLength={PASSWORD_LIMITS.min} maxLength={PASSWORD_LIMITS.max} /></label>
          </>}
          <label>Role<select value={role} onChange={event => setRole(event.target.value as AdminAccount['role'])}>
            {Object.entries(roleLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select></label>
          {edited && <label>Status<select value={disabled ? 'disabled' : 'active'} onChange={event => setDisabled(event.target.value === 'disabled')}>
            <option value="active">Active</option><option value="disabled">Disabled</option>
          </select></label>}
        </fieldset>
        <div className="account-actions">
          <button className="primary" type="submit" disabled={busy || form.kind === 'edit' && !hasChanges}>
            {busy ? 'Saving…' : form.kind === 'create' ? 'Create account' : 'Save access'}
          </button>
          <button type="button" disabled={busy} onClick={() => setForm(null)}>Cancel</button>
        </div>
      </form>
    </section>}
    {error && <Notice message={error} error />}
    {notice && <Notice message={notice} />}
    <section className="panel">
      {state.loading && <Notice message="Loading accounts…" />}
      {state.error && <Notice message={state.error} error />}
      {state.data && <>
        <table>
          <thead><tr><th>Username</th><th>Role</th><th>Status</th>{!managed && <th>Created</th>}<th>Access</th></tr></thead>
          <tbody>{state.data.accounts.map(account => <tr key={account.id}>
            <td><strong>{account.username}</strong>{account.id === actorId && <small>Your account</small>}</td>
            <td>{roleLabels[account.role]}</td>
            <td><span className={'badge ' + (account.disabled ? 'muted' : 'active')}>{account.disabled ? 'Disabled' : 'Active'}</span></td>
            {!managed && <td>{account.createdAt === undefined ? '—' : new Date(account.createdAt).toLocaleDateString()}</td>}
            <td>{managed ? <button disabled={busy} aria-label={`Edit access for ${account.username}`} onClick={() => open({ kind: 'edit', account })}>Edit access</button>
              : <button disabled={account.disabled || busy} onClick={() => open({ kind: 'disable', account })}>Disable</button>}</td>
          </tr>)}</tbody>
        </table>
        <Pagination offset={offset} limit={state.data.limit} change={setOffset}
          {...('total' in state.data ? { total: state.data.total } : { count: state.data.accounts.length, nextOffset: state.data.nextOffset })} />
      </>}
    </section>
  </>;
}
