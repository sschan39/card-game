import { afterEach, describe, expect, it, vi } from 'vitest';
import { randomBytes, randomUUID } from 'node:crypto';
import { createGameApplication } from '@server/application';
import { newScenario } from '@card-game/protocol';
import { tokenDigest } from '@server/auth/session';
import type { SessionRecord } from '@server/auth/account-store';

const password = 'coverage-lab-strong-passphrase-73';
const setup = () => ({ ...newScenario(), name: 'Coverage demonstration', openingHandSize: 0,
  players: [{ life: 17, library: [{ cardId: 'land-red', quantity: 3 }], hand: [{ cardId: 'land-red', quantity: 1 }], graveyard: [], battlefield: [] },
    { life: 23, library: [{ cardId: 'land-red', quantity: 4 }], hand: [], graveyard: [], battlefield: [] }] as ReturnType<typeof newScenario>['players'] });

type Application = ReturnType<typeof createGameApplication>;
const running: Application[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const app of running.splice(0)) await new Promise<void>(resolve => app.io.close(() => resolve()));
});

async function startApp(configuration: Record<string, unknown> = {}) {
  const app = createGameApplication({ environment: { NODE_ENV: 'test', DELTA_LOG_PATH: '' },
    configuration: { lab: { enabled: true, maxRooms: 2, maxScenarios: 5 }, inspectionEnabled: true, navigation: { instanceId: 'coverage-lab', purpose: 'lab' }, ...configuration } });
  running.push(app);
  await app.ready;
  const operator = await app.auth.register({ username: 'operator', password });
  app.auth.repository.saveAccount({ ...app.auth.repository.findAccount(operator.account!.id)!, role: 'admin' });
  const admin = await app.auth.login({ username: 'operator', password, scope: 'admin' });
  const second = await app.auth.register({ username: 'player-two', password });
  const third = await app.auth.register({ username: 'player-three', password });
  const seat = (id: string) => app.auth.gameTab(app.auth.sessions.issue({ kind: 'account', id }, 'game', { kind: 'browser' }).record);
  await new Promise<void>(resolve => app.server.listen(0, '127.0.0.1', resolve));
  const url = 'http://127.0.0.1:' + (app.server.address() as { port: number }).port;
  const request = (path: string, method = 'GET', body?: unknown, token: string | undefined = admin.token) =>
    fetch(url + '/api/admin/scenarios' + path, { method, headers: { ...(token ? { Authorization: 'Bearer ' + token } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
  return { app, url, admin, request, one: seat(operator.account!.id), two: seat(second.account!.id), three: seat(third.account!.id), secondId: second.account!.id, thirdId: third.account!.id };
}

describe('scenario administration routes', () => {
  it('serves presets, paged lists, individual records and rejects malformed mutations', async () => {
    const { app, request } = await startApp();
    const presets = await request('/presets'); expect(presets.status).toBe(200);
    const fixtures = (await presets.json()).fixtures as { name: string; fixture: { scenario: { name: string } } }[];
    expect(fixtures.length).toBeGreaterThan(0); expect(fixtures.every(entry => typeof entry.name === 'string' && entry.fixture.scenario.name.length > 0)).toBe(true);
    expect((await (await request('/runs')).json()).runs).toEqual([]);
    const save = await request('/', 'POST', { protocolVersion: 1, scenario: setup() }); expect(save.status).toBe(200);
    const record = (await save.json()).record;
    const page = await request('/?limit=2'); expect(page.status).toBe(200);
    expect(await page.json()).toMatchObject({ total: 1, offset: 0, limit: 2 });
    const defaulted = await (await request('/')).json();
    expect(defaulted.limit).toBe(app.config.http.pageSize); expect(defaulted.records).toHaveLength(1);
    const read = await request('/' + record.id); expect(read.status).toBe(200); expect((await read.json()).record).toMatchObject({ id: record.id, revision: 1 });
    const missing = await request('/' + randomUUID()); expect(missing.status).toBe(404); expect(await missing.json()).toMatchObject({ message: 'Scenario unavailable.' });
    const revisionAtCreate = await request('/', 'POST', { protocolVersion: 1, scenario: setup(), expectedRevision: 1 });
    expect(revisionAtCreate.status).toBe(400); expect(await revisionAtCreate.json()).toMatchObject({ message: 'New scenario cannot specify a revision.' });
    const revisionAtUpdate = await request('/' + record.id, 'PUT', { protocolVersion: 1, scenario: setup() });
    expect(revisionAtUpdate.status).toBe(400); expect(await revisionAtUpdate.json()).toMatchObject({ message: 'Expected revision required.' });
  });

  it('refuses sessions that are not account-backed administrators', async () => {
    const { app, request } = await startApp();
    const token = randomBytes(32).toString('base64url');
    const record: SessionRecord = { id: randomUUID(), digest: tokenDigest(token), subject: { kind: 'guest', id: randomUUID() },
      scope: 'admin', createdAt: Date.now(), expiresAt: Date.now() + 600_000 };
    app.auth.repository.saveSession(record);
    const response = await request('/', 'GET', undefined, token);
    expect(response.status).toBe(403); expect(await response.json()).toMatchObject({ message: 'Current administrator access required.' });
    expect(app.store.audit.pendingAudit(10).map(entry => entry.action)).toContain('scenario.denied');
  });
});

describe('scenario service limits and lifecycle', () => {
  it('rejects schema-invalid scenarios and enforces the configured capacity', async () => {
    const { app, request } = await startApp({ lab: { enabled: true, maxRooms: 2, maxScenarios: 1 } });
    expect(() => app.scenarios.save({ nope: true })).toThrow('Invalid or unsupported scenario.');
    expect((await request('/', 'POST', { protocolVersion: 1, scenario: setup() })).status).toBe(200);
    const second = await request('/', 'POST', { protocolVersion: 1, scenario: setup() });
    expect(second.status).toBe(409); expect(await second.json()).toMatchObject({ message: 'Scenario capacity reached.' });
  });

  it('reports a storage conflict when the saved revision moved underneath a write', async () => {
    const { app, request } = await startApp();
    vi.spyOn(app.scenarios.repository, 'saveScenario').mockReturnValueOnce(false);
    const response = await request('/', 'POST', { protocolVersion: 1, scenario: setup() });
    expect(response.status).toBe(409); expect(await response.json()).toMatchObject({ message: 'Scenario changed. Reload before saving.' });
    expect(app.store.audit.pendingAudit(10).map(entry => entry.action)).toContain('scenario.create');
  });

  it('accepts a battlefield permanent that has no sub-types', async () => {
    const { app, request } = await startApp();
    const scenario = setup();
    scenario.players[0].battlefield = [{ cardId: 'awakened-blood-mountain', quantity: 1 }];
    const saved = await request('/', 'POST', { protocolVersion: 1, scenario });
    expect(saved.status).toBe(200); expect((await saved.json()).record.scenario.players[0].battlefield).toEqual([{ cardId: 'awakened-blood-mountain', quantity: 1 }]);
    expect(app.scenarios.repository.listScenarios(0, 10).total).toBe(1);
  });

  it('rejects stale deletions, stale launches and unusable participants', async () => {
    const { app, request, one, two, three } = await startApp();
    const record = (await (await request('/', 'POST', { protocolVersion: 1, scenario: setup() })).json()).record;
    const staleDelete = await request('/' + record.id, 'DELETE', { protocolVersion: 1, expectedRevision: 8 });
    expect(staleDelete.status).toBe(409); expect(await staleDelete.json()).toMatchObject({ message: 'Scenario changed. Reload before deletion.' });
    const staleLaunch = await request('/' + record.id + '/launch', 'POST', { protocolVersion: 1, expectedRevision: 8, participants: [one.account!.id, two.account!.id] });
    expect(staleLaunch.status).toBe(409); expect(await staleLaunch.json()).toMatchObject({ message: 'Launch requires the current saved revision.' });
    for (const participants of [[one.account!.id, one.account!.id], [one.account!.id, randomUUID()]]) {
      const refused = await request('/' + record.id + '/launch', 'POST', { protocolVersion: 1, expectedRevision: 1, participants });
      expect(refused.status).toBe(400); expect(await refused.json()).toMatchObject({ message: 'Choose two distinct enabled lab accounts.' });
    }
    expect(app.scenarios.listRuns()).toEqual([]);
    const launched = await request('/' + record.id + '/launch', 'POST', { protocolVersion: 1, expectedRevision: 1, participants: [one.account!.id, three.account!.id] });
    expect(launched.status).toBe(200); expect((await launched.json()).run.participants).toEqual([one.account!.id, three.account!.id]);
  });

  it('prunes runs whose rooms are gone and stops live rooms outside a transaction', async () => {
    const { app, request, one, two } = await startApp();
    const record = (await (await request('/', 'POST', { protocolVersion: 1, scenario: setup() })).json()).record;
    const launch = async () => (await (await request('/' + record.id + '/launch', 'POST', { protocolVersion: 1, expectedRevision: 1, participants: [one.account!.id, two.account!.id] })).json()).run;
    const first = await launch(), second = await launch();
    app.runtime.removeTestRoom(first.roomId);
    expect(app.scenarios.listRuns().map(run => run.roomId)).toEqual([second.roomId]);
    expect(() => app.scenarios.run(first.roomId)).toThrow('Test room unavailable.');
    app.scenarios.stop(second.roomId);
    expect(app.store.getRoom(second.roomId)).toBeUndefined();
    expect(app.scenarios.listRuns()).toEqual([]);
  });

  it('cleans up nested atomic work once and loses nothing when the outer transaction commits', async () => {
    const { app, request, one, two } = await startApp();
    const record = (await (await request('/', 'POST', { protocolVersion: 1, scenario: setup() })).json()).record;
    const run = (await (await request('/' + record.id + '/launch', 'POST', { protocolVersion: 1, expectedRevision: 1, participants: [one.account!.id, two.account!.id] })).json()).run;
    expect(app.scenarios.atomic(() => app.scenarios.atomic(() => app.scenarios.stop(run.roomId)))).toBeUndefined();
    expect(app.store.getRoom(run.roomId)).toBeUndefined(); expect(app.scenarios.listRuns()).toEqual([]);
    expect(app.scenarios.atomic(() => 'outer')).toBe('outer');
  });

  it('refuses a claim for a run whose room vanished from the state store', async () => {
    const { app, url, request, one, two } = await startApp();
    const record = (await (await request('/', 'POST', { protocolVersion: 1, scenario: setup() })).json()).record;
    const run = (await (await request('/' + record.id + '/launch', 'POST', { protocolVersion: 1, expectedRevision: 1, participants: [one.account!.id, two.account!.id] })).json()).run;
    app.store.deleteRoom(run.roomId);
    const claim = await fetch(url + '/api/lab/rooms/' + run.roomId + '/claim', { method: 'POST', headers: { Authorization: 'Bearer ' + one.token, 'Content-Type': 'application/json' }, body: JSON.stringify({ protocolVersion: 1 }) });
    expect(claim.status).toBe(404); expect(await claim.json()).toMatchObject({ message: 'Test room unavailable.' });
  });
});
