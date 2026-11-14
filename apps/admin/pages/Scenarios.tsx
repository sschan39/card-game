import { useEffect, useRef, useState } from 'react';
import { CatalogResponseSchema, ScenarioPresetsSchema, ScenarioSchema, ScenarioPageSchema, ScenarioResponseSchema, ScenarioRunsSchema, ScenarioRunResponseSchema, ScenarioExportSchema, AdminAccountsResponseSchema, importScenario, newScenario, filterCatalog, changeCardCounts, type CatalogCard, type ScenarioProvenance, type Scenario, type ScenarioRecord, type ScenarioRun, type PlatformInfo, type AdminAccount } from '@card-game/protocol';
import { BuilderTransfer, CardSurface, CardCountControls, CatalogTile, cardArt } from '@card-game/ui';
import type { AdminApi } from '../api';
import Logs from './Logs';
import { setAdminRouteBlocker } from '../router';
import { SelectedRoom } from './Rooms';
type Zone = 'library' | 'hand' | 'graveyard' | 'battlefield';
const draftKey = 'cardgame.scenarioDraft.v1';
function restore(): Scenario { try {
    return ScenarioSchema.parse((() => { const r = JSON.parse(sessionStorage.getItem(draftKey) ?? 'null'); return r?.scenario ?? r; })());
}
catch {
    return newScenario();
} }
const message = (e: unknown) => e instanceof Error ? e.message : 'Scenario request failed.';
export default function Scenarios({ api, platform, roomsOnly = false }: {
    api: AdminApi;
    platform: PlatformInfo | null;
    roomsOnly?: boolean;
}) {
    const [importedFrom, setImportedFrom] = useState<ScenarioProvenance | null>(() => { try {
        return importScenario(JSON.stringify(JSON.parse(sessionStorage.getItem(draftKey) ?? 'null'))).origin ?? null;
    }
    catch {
        return null;
    } });
    const [draft, setDraft] = useState<Scenario>(restore), [saved, setSaved] = useState<ScenarioRecord | null>(null), [records, setRecords] = useState<ScenarioRecord[]>([]), [offset, setOffset] = useState(0), [total, setTotal] = useState(0);
    const [presets, setPresets] = useState<{
        name: string;
        fixture: ReturnType<typeof importScenario>;
    }[]>([]);
    const [cards, setCards] = useState<CatalogCard[]>([]), [accounts, setAccounts] = useState<AdminAccount[]>([]), [participants, setParticipants] = useState<[
        string,
        string
    ]>(['', '']);
    const [runs, setRuns] = useState<ScenarioRun[]>([]), [selected, setSelected] = useState<ScenarioRun | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState(''), [text, setText] = useState(''), [query, setQuery] = useState('');
    const [player, setPlayer] = useState<0 | 1>(0), [zone, setZone] = useState<Zone>('library'), [refresh, setRefresh] = useState(0), [storageWarning, setStorageWarning] = useState(false);
    const alive = useRef(true), epoch = useRef(0), active = useRef<AbortController | null>(null);
    const enabled = !!platform?.capabilities.scenarios;
    useEffect(() => { alive.current = true; return () => { alive.current = false; epoch.current++; active.current?.abort(); }; }, []);
    useEffect(() => { try {
        sessionStorage.setItem(draftKey, JSON.stringify({ format: 'card-game-scenario', version: 1, scenario: draft, provenance: { sourceId: null, revision: 0, instanceId: platform?.navigation.instanceId ?? 'draft' }, ...(importedFrom ? { origin: importedFrom } : {}) }));
        setStorageWarning(false);
    }
    catch {
        setStorageWarning(true);
    } }, [draft, importedFrom, platform?.navigation.instanceId]);
    const dirty = !saved || JSON.stringify(saved.scenario) !== JSON.stringify(draft);
    useEffect(() => { setAdminRouteBlocker(() => !dirty || window.confirm('Leave this scenario? The draft remains recoverable.')); return () => setAdminRouteBlocker(null); }, [dirty]);
    useEffect(() => { const leave = (e: BeforeUnloadEvent) => { if (dirty) {
        e.preventDefault();
        e.returnValue = '';
    } }; window.addEventListener('beforeunload', leave); return () => window.removeEventListener('beforeunload', leave); }, [dirty]);
    useEffect(() => {
        if (!enabled || busy)
            return;
        const c = new AbortController();
        const read = ++epoch.current;
        void (async () => {
            const legacy = await api.get('/api/admin/scenarios/presets', ScenarioPresetsSchema, c.signal);
            const page = await api.get('/api/admin/scenarios?limit=25&offset=' + offset, ScenarioPageSchema, c.signal);
            const test = await api.get('/api/admin/scenarios/runs', ScenarioRunsSchema, c.signal);
            const all: CatalogCard[] = [];
            for (let start = 0;; start += 100) {
                const r = await fetch('/api/cards?limit=100&offset=' + start, { signal: c.signal });
                if (!r.ok)
                    throw new Error('Catalog unavailable.');
                const p = CatalogResponseSchema.parse(await r.json());
                if (!p.cards.length && all.length < p.total)
                    throw new Error('Catalog pagination did not advance.');
                all.push(...p.cards);
                if (all.length >= p.total)
                    break;
            }
            const people: AdminAccount[] = [];
            for (let start = 0;; start += 100) {
                const p = await api.get('/api/admin/accounts?limit=100&offset=' + start, AdminAccountsResponseSchema, c.signal);
                if (!p.accounts.length && people.length < p.total)
                    throw new Error('Account pagination did not advance.');
                people.push(...p.accounts);
                if (people.length >= p.total)
                    break;
            }
            if (c.signal.aborted || read !== epoch.current)
                return;
            setPresets(legacy.fixtures);
            setRecords(page.records);
            setTotal(page.total);
            setRuns(test.runs);
            setCards(all);
            setAccounts(people.filter(a => !a.disabled));
        })().catch(e => { if (!c.signal.aborted && read === epoch.current)
            setError(message(e)); });
        return () => c.abort();
    }, [api, enabled, offset, refresh, busy]);
    const work = async (task: (signal: AbortSignal) => Promise<void>) => { if (busy)
        return; epoch.current++; active.current?.abort(); const c = new AbortController(); active.current = c; setBusy(true); setError(''); setNotice(''); try {
        await task(c.signal);
    }
    catch (e) {
        if (alive.current && !c.signal.aborted)
            setError(message(e));
    }
    finally {
        if (alive.current && !c.signal.aborted) {
            setBusy(false);
            setRefresh(n => n + 1);
        }
    } };
    const replace = (scenario: Scenario, record: ScenarioRecord | null, origin: ScenarioProvenance | null = null) => { if (dirty && !window.confirm('Replace this unsaved scenario? Your saved source is unchanged.'))
        return; setDraft(scenario); setSaved(record); setImportedFrom(record?.importedFrom ?? origin); };
    const edit = (next: Scenario) => { setDraft(next); setNotice(''); };
    const save = () => work(async (signal) => { const parsed = ScenarioSchema.parse(draft); const body = !saved && importedFrom ? { protocolVersion: 1, fixture: { format: 'card-game-scenario', version: 1, scenario: parsed, provenance: importedFrom } } : { protocolVersion: 1, scenario: parsed, ...(saved ? { expectedRevision: saved.revision } : {}) }; const r = await api.mutate(saved ? '/api/admin/scenarios/' + saved.id : importedFrom ? '/api/admin/scenarios/import' : '/api/admin/scenarios', saved ? 'PUT' : 'POST', body, ScenarioResponseSchema, signal); if (signal.aborted || !alive.current)
        return; setSaved(r.record); setDraft(r.record.scenario); setNotice('Saved revision ' + r.record.revision); });
    const change = (id: string, delta: number) => { const p = draft.players[player]; edit({ ...draft, players: draft.players.map((v, i) => i === player ? { ...p, [zone]: changeCardCounts(p[zone], id, delta), ...(zone === 'library' ? { libraryOrder: undefined } : {}) } : v) as Scenario['players'] }); };
    if (!enabled)
        return <section><h1>Test Lab unavailable</h1><p>This instance must be classified as a lab with server-enabled scenario and inspection capabilities.</p></section>;
    const current = draft.players[player], entries = current[zone], validation = ScenarioSchema.safeParse(draft);
    const play = (run: ScenarioRun) => { const url = new URL(platform!.navigation.play, window.location.origin); url.searchParams.set('testRoom', run.roomId); return url.href; };
    return <section className="scenario-workspace"><h1>{roomsOnly ? 'Test rooms' : 'Scenario Builder'}</h1><p role="status">Test Lab · {platform.navigation.instanceId} · {platform.navigation.label}</p>
 <p>Use normal public sign-in in each game tab. Only the two assigned lab accounts can claim these seats. Admin credentials stay here.</p>
 {error && <p role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}{storageWarning && <p role="alert">Draft recovery unavailable; export before leaving.</p>}
 <fieldset disabled={busy}><legend>Saved scenarios</legend><button onClick={() => replace(newScenario(), null)}>New scenario</button>{presets.map(p => <button key={p.name} onClick={() => replace(p.fixture.scenario, null, p.fixture.origin ?? p.fixture.provenance)}>Load {p.name} preset</button>)}<button onClick={() => setRefresh(n => n + 1)}>Refresh</button>
 {records.map(r => <button key={r.id} onClick={() => replace(r.scenario, r)}>{r.scenario.name} · r{r.revision}</button>)}
 <button disabled={offset === 0} onClick={() => setOffset(n => Math.max(0, n - 25))}>Previous</button><button disabled={offset + 25 >= total} onClick={() => setOffset(n => n + 25)}>Next</button>
 {saved && <><span>Source {saved.id} · revision {saved.revision} · {dirty ? 'unsaved changes' : 'saved'}</span><button onClick={() => void work(async (signal) => { if (!window.confirm('Delete saved scenario? Existing runs retain their snapshots.'))
        return; await api.mutate('/api/admin/scenarios/' + saved.id, 'DELETE', { protocolVersion: 1, expectedRevision: saved.revision }, { safeParse: () => ({ success: true as const, data: null }) }, signal); if (!signal.aborted && alive.current)
        setSaved(null); })}>Delete source</button></>}</fieldset>
 {!roomsOnly && <fieldset disabled={busy}><legend>Scenario setup</legend>
 <label>Name<input maxLength={80} value={draft.name} onChange={e => edit({ ...draft, name: e.target.value })}/></label>
 <label>Opening draw<input type="number" min={0} max={30} value={draft.openingHandSize} onChange={e => edit({ ...draft, openingHandSize: Number(e.target.value) })}/></label>
 <label>First player<select value={draft.firstPlayer} onChange={e => edit({ ...draft, firstPlayer: Number(e.target.value) as 0 | 1 })}><option value={0}>Player 1</option><option value={1}>Player 2</option></select></label>
 <label>Existing rules profile<select value={draft.rulesProfile} onChange={e => edit({ ...draft, rulesProfile: e.target.value as Scenario['rulesProfile'] })}><option value="standard-v1">Standard</option><option value="scorch-v1">Scorch</option></select></label><label>Order<select value={draft.shuffle} onChange={e => edit({ ...draft, shuffle: e.target.value as Scenario['shuffle'] })}><option value="fixed">Fixed</option><option value="seeded">Seeded shuffle</option></select></label>
 <label>Gameplay seed<input type="number" min={0} max={4294967295} value={draft.seed} onChange={e => edit({ ...draft, seed: Number(e.target.value) })}/></label>
 <label>Edit player<select value={player} onChange={e => setPlayer(Number(e.target.value) as 0 | 1)}><option value={0}>Player 1</option><option value={1}>Player 2</option></select></label>
 <label>Starting life<input type="number" min={1} max={1000} value={current.life} onChange={e => edit({ ...draft, players: draft.players.map((p, i) => i === player ? { ...p, life: Number(e.target.value) } : p) as Scenario['players'] })}/></label>
 <label>Starting zone<select value={zone} onChange={e => setZone(e.target.value as Zone)}>{(['library', 'hand', 'graveyard', 'battlefield'] as const).map(z => <option key={z}>{z}</option>)}</select></label>
 <p>Library order is first listed → first drawn. Exact mixed order can be imported/exported using libraryOrder. Starting battlefield cards are already present; enter-the-battlefield effects are not replayed.</p>
 <label>Search catalog<input type="search" value={query} onChange={e => setQuery(e.target.value)}/></label>
 <div className="scenario-catalog">{filterCatalog(cards, { search: query, type: '', color: '', legalOnly: false }).map(card => <CatalogTile key={card.id} id={card.id} description={card.rulesText} action={<CardCountControls label={card.name} quantity={entries.find(e => e.cardId === card.id)?.quantity ?? 0} onChange={delta => change(card.id, delta)}/>}><CardSurface card={card} art={cardArt(card.id)}/></CatalogTile>)}</div>
 <h2>Player {player + 1} · {zone}</h2><ul>{entries.map(e => <li key={e.cardId}>{e.cardId} × {e.quantity}<CardCountControls label={e.cardId} quantity={e.quantity} onChange={delta => change(e.cardId, delta)}/></li>)}</ul>
 <p>{validation.success ? 'Setup structure is valid. Canonical IDs are checked on save.' : 'Invalid setup: check card counts, opening draw, order and limits.'}</p><button disabled={!validation.success || !cards.length} onClick={() => void save()}>Save scenario</button>
 <BuilderTransfer text={text} onText={setText} disabled={busy} onImport={() => { try {
            (() => { const f = importScenario(text); replace(f.scenario, null, f.origin ?? f.provenance); })();
        }
        catch (e) {
            setError(message(e));
        } }} onExport={() => void work(async (signal) => { if (saved && !dirty) {
            const r = await api.get('/api/admin/scenarios/' + saved.id + '/export', ScenarioExportSchema, signal);
            if (!signal.aborted && alive.current)
                setText(JSON.stringify(r.fixture, null, 2));
        }
        else
            setText(JSON.stringify({ format: 'card-game-scenario', version: 1, scenario: ScenarioSchema.parse(draft), provenance: { sourceId: null, revision: 0, instanceId: platform.navigation.instanceId }, ...(importedFrom ? { origin: importedFrom } : {}) }, null, 2)); })}/>
 </fieldset>}
 <fieldset disabled={busy}><legend>Launch saved revision</legend>{participants.map((id, i) => <label key={i}>Player {i + 1} account<select value={id} onChange={e => setParticipants(v => i === 0 ? [e.target.value, v[1]] : [v[0], e.target.value])}><option value="">Select enabled lab account</option>{accounts.map(a => <option key={a.id} value={a.id}>{a.username}</option>)}</select></label>)}
 <button disabled={!saved || dirty || !participants[0] || !participants[1] || participants[0] === participants[1]} onClick={() => void work(async (signal) => { const r = await api.mutate('/api/admin/scenarios/' + saved!.id + '/launch', 'POST', { protocolVersion: 1, expectedRevision: saved!.revision, participants }, ScenarioRunResponseSchema, signal); if (!signal.aborted && alive.current) {
        setSelected(r.run);
        setNotice('Test room launched from revision ' + r.run.revision);
    } })}>Launch test room</button></fieldset>
 <h2>Test rooms</h2>{runs.map(run => <div key={run.roomId}><button disabled={busy} onClick={() => setSelected(run)}>{run.snapshot.name} · r{run.revision} · {run.roomId}</button><a href={play(run)} target="_blank" rel="noopener noreferrer">Play assigned seat</a><button disabled={busy} onClick={() => void work(async (signal) => { const r = await api.mutate('/api/admin/scenarios/runs/' + run.roomId + '/reset', 'POST', { protocolVersion: 1 }, ScenarioRunResponseSchema, signal); if (!signal.aborted && alive.current)
        setSelected(r.run); })}>Reset from launch snapshot</button><button disabled={busy} onClick={() => replace(run.snapshot, null)}>Revise launch snapshot</button><button disabled={busy} onClick={() => void work(async (signal) => { if (!window.confirm('Stop this test room and disconnect its participants?'))
        return; await api.mutate('/api/admin/scenarios/runs/' + run.roomId, 'DELETE', { protocolVersion: 1 }, { safeParse: () => ({ success: true as const, data: null }) }, signal); if (!signal.aborted && alive.current && selected?.roomId === run.roomId)
        setSelected(null); })}>Stop test room</button></div>)}
 {selected && <><p>Run {selected.roomId} · source {selected.scenarioId} · r{selected.revision}</p><Logs key={selected.roomId} api={api} roomId={selected.roomId}/><SelectedRoom api={api} id={selected.roomId} refresh={refresh}/></>}
 </section>;
}
