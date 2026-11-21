import { randomUUID } from 'node:crypto';
import { ScenarioSchema, type Scenario, type ScenarioRecord, type ScenarioRun, type ScenarioProvenance } from '@card-game/protocol';
import { getBlueprint } from '@card-game/engine/library/card-catalog';
import { buildScenarioRoom, scenarioRandom } from '@card-game/engine/engine/scenario-setup';
import { canSetUpOnBattlefield } from '@card-game/engine/engine/playtest-edit';
import type { ScenarioRepository } from './repository';
import type { RoomRuntime } from '../rooms/room-runtime';
import type { AuthService } from '../auth/service';
import type { ServerConfig } from '../config';
import type { SessionRecord } from '../auth/account-store';
import { AuthError } from '../auth/errors';
import { PlaytestRun } from './playtest-run';
export const scenariosEnabled = (config: ServerConfig) => config.lab.enabled && config.navigation.purpose === 'lab' && config.inspectionEnabled;
const retentionMs = 24 * 60 * 60 * 1000;
export class ScenarioService {
    private runs = new Map<string, ScenarioRun>();
    private playtests = new Map<string, PlaytestRun>();
    private pendingRemovals: string[] | null = null;
    constructor(readonly repository: ScenarioRepository, private runtime: RoomRuntime, private auth: AuthService,
        private config: ServerConfig, private now = Date.now, private retireControls: (id: string) => void = () => {}) { }
    atomic<T>(operation: () => T): T {
        const previous = structuredClone(this.runs);
        const previousPlaytests = new Map(this.playtests);
        this.pendingRemovals = [];
        let result: T;
        try {
            result = this.repository.scenarioTransaction(() => this.auth.sessions.atomic(operation));
        }
        catch (error) {
            for (const id of this.runs.keys())
                if (!previous.has(id) && this.runtime.isTestRoom(id))
                    this.runtime.removeTestRoom(id);
            this.runs = previous;
            this.playtests = previousPlaytests;
            this.pendingRemovals = null;
            throw error;
        }
        const removals = this.pendingRemovals;
        this.pendingRemovals = null;
        for (const id of removals ?? [])
            this.runtime.removeTestRoom(id);
        return result;
    }
    private removeRun(id: string) { if (this.pendingRemovals)
        this.pendingRemovals.push(id);
    else
        this.runtime.removeTestRoom(id); this.runs.delete(id); this.playtests.delete(id); }
    private validate(input: unknown): Scenario {
        const parsed = ScenarioSchema.safeParse(input);
        if (!parsed.success)
            throw new AuthError(400, 'Invalid or unsupported scenario.');
        for (const p of parsed.data.players)
            for (const entries of [p.library, p.hand, p.graveyard, p.battlefield])
                for (const e of entries)
                    try {
                        getBlueprint(e.cardId);
                    }
                    catch {
                        throw new AuthError(400, 'Unknown canonical card: ' + e.cardId);
                    }
        for (const p of parsed.data.players)
            for (const e of p.battlefield) {
                const c = getBlueprint(e.cardId);
                if (!canSetUpOnBattlefield(c))
                    throw new AuthError(400, 'Unsupported initial battlefield card.');
            }
        return parsed.data;
    }
    get(id: string) { const r = this.repository.findScenario(id); if (!r)
        throw new AuthError(404, 'Scenario unavailable.'); return r; }
    save(input: unknown, id?: string, expectedRevision = 0, importedFrom?: ScenarioProvenance): ScenarioRecord {
        const scenario = this.validate(input), previous = id ? this.get(id) : undefined;
        if (previous && expectedRevision !== previous.revision)
            throw new AuthError(409, 'Scenario changed. Reload before saving.');
        if (!previous && this.repository.listScenarios(0, 1).total >= this.config.lab.maxScenarios)
            throw new AuthError(409, 'Scenario capacity reached.');
        const record = { id: previous?.id ?? randomUUID(), revision: (previous?.revision ?? 0) + 1, scenario, createdAt: previous?.createdAt ?? this.now(), updatedAt: this.now(), ...((previous?.importedFrom ?? importedFrom) ? { importedFrom: previous?.importedFrom ?? importedFrom } : {}) };
        if (!this.repository.saveScenario(record, previous?.revision ?? 0))
            throw new AuthError(409, 'Scenario changed. Reload before saving.');
        return record;
    }
    delete(id: string, revision: number) { this.get(id); if (!this.repository.deleteScenario(id, revision))
        throw new AuthError(409, 'Scenario changed. Reload before deletion.'); }
    pruneRuns() {
        for (const id of this.runs.keys()) {
            if (!this.runtime.isTestRoom(id)) { this.runs.delete(id); this.playtests.delete(id); }
            else {
                const playtest = this.playtests.get(id);
                const digest = playtest?.operator?.digest;
                if (digest && !this.auth.sessions.validateDigest(digest) && playtest.operator?.digest === digest &&
                    this.playtests.get(id) === playtest) this.retirePlaytest(id, playtest);
                if (playtest?.retainedUntil !== undefined && playtest.retainedUntil <= this.now()) this.removeRun(id);
            }
        }
    }
    listRuns() {
        this.pruneRuns();
        return structuredClone([...this.runs.values()]);
    }
    run(id: string) { this.listRuns(); const r = this.runs.get(id); if (!r)
        throw new AuthError(404, 'Test room unavailable.'); return structuredClone(r); }
    launch(id: string, revision: number, participants: [
        string,
        string
    ], actorId: string) {
        const record = this.get(id);
        if (record.revision !== revision)
            throw new AuthError(409, 'Launch requires the current saved revision.');
        return this.createRun(record, participants, actorId);
    }
    private createRun(record: ScenarioRecord, participants: [
        string,
        string
    ], actorId: string, replacing = false) {
        if (participants[0] === participants[1] || participants.some(id => { const a = this.auth.repository.findAccount(id); return !a || a.disabled; }))
            throw new AuthError(400, 'Choose two distinct enabled lab accounts.');
        if (this.listRuns().length - (replacing ? 1 : 0) >= this.config.lab.maxRooms)
            throw new AuthError(409, 'Test room capacity reached.');
        const roomId = randomUUID(), players: [
            string,
            string
        ] = [randomUUID(), randomUUID()];
        const room = buildScenarioRoom(roomId, players, this.validate(record.scenario), { uuid: randomUUID, random: scenarioRandom(record.scenario.seed) });
        this.runtime.installTestRoom(room, scenarioRandom(record.scenario.seed));
        const run = { roomId, scenarioId: record.id, revision: record.revision, snapshot: structuredClone(record.scenario), participants: [...participants] as [
                string,
                string
            ], createdAt: this.now(), actorId };
        this.runs.set(roomId, run);
        return structuredClone(run);
    }
    stop(id: string) { this.run(id); this.removeRun(id); }
    launchPlaytest(scenarioInput: Scenario, operator: SessionRecord, source?: { id: string; revision: number }) {
        if (!scenariosEnabled(this.config)) throw new AuthError(404, 'Scenario capability unavailable on this instance.');
        if (operator.scope !== 'admin' || operator.subject.kind !== 'account' || !this.auth.sessions.validateDigest(operator.digest))
            throw new AuthError(403, 'Current administrator access required.');
        return this.createPlaytest(scenarioInput, operator, false, source);
    }
    async authorizeOperator(operator: SessionRecord) {
        if (!scenariosEnabled(this.config) || !this.auth.authority) throw new AuthError(404, 'Test Rooms are unavailable.');
        if (operator.kind !== 'browser' || operator.subject.kind !== 'account') throw new AuthError(403, 'A browser account is required.');
        await this.auth.authorize(operator, 'lab.operate');
    }
    async refreshOwnedPlaytestAccess(): Promise<void> {
        this.pruneRuns();
        const operators = new Map<string, SessionRecord>();
        for (const playtest of this.playtests.values())
            if (playtest.retained && playtest.operator) operators.set(playtest.operator.digest, playtest.operator);
        await Promise.allSettled([...operators.values()].map(async operator => {
            try { await this.auth.authorize(operator, 'lab.operate'); }
            catch (error) {
                if (error instanceof AuthError && error.status === 403) this.revokePlaytests(operator.digest);
            }
        }));
    }
    launchOwnedPlaytest(scenario: Scenario, operator: SessionRecord) {
        return this.createPlaytest(scenario, operator, true);
    }
    ownedPlaytests(operator: SessionRecord) {
        this.pruneRuns();
        return [...this.playtests.values()].filter(playtest => playtest.retained && playtest.run.actorId === operator.subject.id)
            .map(({ run, retainedUntil }) => ({ roomId: run.roomId, name: run.snapshot.name, createdAt: run.createdAt, retainedUntil: retainedUntil ?? null }));
    }
    resumeOwnedPlaytest(id: string, operator: SessionRecord) {
        this.pruneRuns();
        const playtest = this.playtests.get(id);
        if (!playtest?.retained || playtest.run.actorId !== operator.subject.id)
            throw new AuthError(404, 'Test room unavailable.');
        this.retireControls(id);
        return playtest.issue(operator);
    }
    stopOwnedPlaytest(id: string, operator: SessionRecord): void {
        this.pruneRuns();
        const playtest = this.playtests.get(id);
        if (!playtest?.retained || playtest.run.actorId !== operator.subject.id)
            throw new AuthError(404, 'Test room unavailable.');
        this.removeRun(id);
    }
    private createPlaytest(scenarioInput: Scenario, operator: SessionRecord, retained: boolean, source?: { id: string; revision: number }) {
        const scenario = this.validate(scenarioInput);
        if (source) {
            const saved = this.get(source.id);
            if (saved.revision !== source.revision || JSON.stringify(saved.scenario) !== JSON.stringify(scenario))
                throw new AuthError(409, 'The saved scenario changed. Reload it before launching.');
        }
        if (this.listRuns().length >= this.config.lab.maxRooms) throw new AuthError(409, 'Test room capacity reached.');
        const roomId = randomUUID();
        const run: ScenarioRun = { roomId, scenarioId: source?.id ?? randomUUID(), revision: source?.revision ?? 1,
            snapshot: structuredClone(scenario), participants: null, createdAt: this.now(), actorId: operator.subject.id, ...(!source ? { draft: true as const } : {}) };
        const playtest = new PlaytestRun(run, [randomUUID(), randomUUID()], this.runtime, retained);
        this.runtime.installTestRoom(playtest.startingRoom(), playtest.random.random, true);
        this.runs.set(roomId, run);
        this.playtests.set(roomId, playtest);
        return playtest.issue(operator);
    }
    private resolvePlaytest(id: string, token: string | undefined) {
        if (!scenariosEnabled(this.config) || !this.runtime.isTestRoom(id)) return;
        const playtest = this.playtests.get(id);
        const role = token ? playtest?.control(token) : undefined;
        const operator = playtest?.operator;
        if (!playtest || !operator || role === undefined || !this.auth.sessions.validateDigest(operator.digest)) return;
        return { playtest, role, operator };
    }
    playtestEditor(id: string, token: string | undefined) {
        const access = this.resolvePlaytest(id, token);
        if (access?.role !== 'editor') throw new AuthError(403, 'A current playtest editor session is required.');
        return { playtest: access.playtest, operator: access.operator };
    }
    playtestSeat(id: string, token: string | undefined) {
        const access = this.resolvePlaytest(id, token);
        if (access?.role !== 0 && access?.role !== 1) return;
        return { playerId: access.playtest.players[access.role], operator: access.operator };
    }
    revokePlaytests(operatorDigest: string): void {
        for (const [id, playtest] of this.playtests) {
            if (playtest.operator?.digest === operatorDigest) this.retirePlaytest(id, playtest);
        }
    }
    private retirePlaytest(id: string, playtest: PlaytestRun) {
        if (!playtest.retained) { this.removeRun(id); return; }
        playtest.detach(this.now() + retentionMs);
        this.retireControls(id);
    }
    reset(id: string, actorId: string) {
        const old = this.run(id);
        if (!old.participants) throw new AuthError(409, 'Reset a single-operator room from Edit board.');
        // Reset uses the launch snapshot even if the source was edited/deleted.
        // Build first; a setup/capacity failure must preserve the existing room.
        const next = this.createRun({ id: old.scenarioId, revision: old.revision, scenario: old.snapshot, createdAt: old.createdAt, updatedAt: old.createdAt }, old.participants, actorId, true);
        this.removeRun(id);
        return next;
    }
    claim(id: string, session: SessionRecord) {
        const run = this.run(id);
        if (session.scope !== 'game' || session.kind === 'browser' || session.subject.kind !== 'account')
            throw new AuthError(403, 'Use a signed-in lab game tab.');
        const index = run.participants?.indexOf(session.subject.id) ?? -1;
        if (index < 0)
            throw new AuthError(403, 'This account is not assigned to this test room.');
        // Room players are generated by the server and never accepted from a request.
        const room = this.runtimeRoom(id);
        const playerId = index === 0 ? room.player1Id : room.player2Id!;
        this.auth.claimSeat(session, id, playerId);
        return this.auth.info(session, id);
    }
    private runtimeRoom(id: string) { const room = this.runtime.testRoom(id); if (!room)
        throw new AuthError(404, 'Test room unavailable.'); return room; }
}
