import { useCallback, useState } from 'react';
import { AdminRoomsResponseSchema, AdminRoomResponseSchema } from '@card-game/protocol';
import type { AdminApi } from '../api';
import { adminUi } from '../config';
import { useResource } from '../hooks';
import { Notice, Pagination, record, array, label, cardName } from '../components/common';

export function RoomInspector({ room }: { room: Record<string, unknown> }) {
  const participant = (id: unknown) => id === room.player1Id ? 'Player 1' : id === room.player2Id ? 'Player 2' : '—';
  return <>
    <div className="metrics"><div><span>Phase</span><strong>{label(room.phase)}</strong></div><div><span>Turn</span><strong>{String(room.turnNumber ?? 1)}</strong></div><div><span>Active</span><strong>{participant(room.activeTurnPlayerId)}</strong></div><div><span>Priority</span><strong>{participant(room.priorityPlayerId)}</strong></div></div>
    <div className="player-zones">{Object.entries(record(room.players)).map(([id, value]) => <section key={id}><h3>{participant(id)} <small>Life {String(record(value).life ?? '—')}</small></h3>
      {['hand', 'deck', 'graveyard', 'exile'].map(zone => <details key={zone}><summary>{zone === 'deck' ? 'Library' : label(zone)} <span className="badge">{array(record(value)[zone]).length}</span></summary>
        <ul>{array(record(value)[zone]).map((card, index) => <li key={index}>{cardName(card)}</li>)}</ul></details>)}</section>)}</div>
    <details><summary>Battlefield · {array(room.battlefield).length}</summary><ul>{array(room.battlefield).map((card, index) => <li key={index}>{cardName(card)}</li>)}</ul></details>
    <details><summary>Stack · {array(room.stack).length}</summary><ul>{array(room.stack).map((item, index) => <li key={index}>{cardName(record(item).source)}</li>)}</ul></details>
    {room.pendingChoice != null && <details><summary>Pending choice</summary><pre>{JSON.stringify(room.pendingChoice, null, 2)}</pre></details>}
    <details><summary>Full room data</summary><pre>{JSON.stringify(room, null, 2)}</pre></details>
  </>;
}
function SelectedRoom({ api, id, refresh }: { api: AdminApi; id: string; refresh: number }) {
  const load = useCallback((signal: AbortSignal) => api.get('/api/admin/rooms/' + encodeURIComponent(id), AdminRoomResponseSchema, signal), [api, id]);
  const state = useResource(load, refresh, adminUi.roomPollMs);
  return <section className="panel inspector"><h2>Room inspector</h2><p className="identifier">{id}</p>
    {state.loading && <Notice message="Loading room…" />}{state.error && <Notice message={state.error} error />}
    {state.data && <RoomInspector room={state.data.room} />}</section>;
}
export default function Rooms({ api }: { api: AdminApi }) {
  const [offset, setOffset] = useState(0), [selected, setSelected] = useState<string | null>(null), [refresh, setRefresh] = useState(0);
  const load = useCallback((signal: AbortSignal) => api.get(`/api/admin/rooms?offset=${offset}&limit=${adminUi.pageSize}`, AdminRoomsResponseSchema, signal), [api, offset]);
  const state = useResource(load, refresh, adminUi.roomPollMs);
  return <><div className="page-heading"><div><p className="eyebrow">Live matches</p><h1>Rooms</h1><p>Inspect active matches and their current state.</p></div><button onClick={() => setRefresh(value => value + 1)}>Refresh</button></div>
    <div className="split"><section className="panel"><h2>Active rooms</h2>{state.loading && <Notice message="Loading rooms…" />}{state.error && <Notice message={state.error} error />}
      {state.data && <><table><thead><tr><th>Room</th><th>Players</th><th>Turn</th><th>Status</th></tr></thead><tbody>{state.data.rooms.map(room => <tr key={room.roomId} className={selected === room.roomId ? 'selected' : ''}><td><button className="link" title={room.roomId} onClick={() => setSelected(room.roomId)}>{room.roomId.slice(0, 8)}</button><small>{label(room.phase)}</small></td><td>{room.players}/2</td><td>{room.turnNumber}</td><td><span className="badge">{label(room.status)}</span></td></tr>)}</tbody></table>
        {!state.data.rooms.length && <Notice message="No rooms are active." />}<Pagination offset={offset} limit={adminUi.pageSize} total={state.data.total} change={setOffset} /></>}
    </section>{selected ? <SelectedRoom key={selected} api={api} id={selected} refresh={refresh} /> : <section className="panel empty"><h2>Room inspector</h2><p>Select a room to inspect its players, zones and stack.</p></section>}</div></>;
}
