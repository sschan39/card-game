import { Router, type Request } from 'express';
import { z } from 'zod';
import { PageQuerySchema, ScenarioSchema, ScenarioFixtureSchema, ScenarioResponseSchema, ScenarioRunResponseSchema, ScenarioPageSchema, ScenarioRunsSchema, ScenarioExportSchema, PlaytestLaunchSchema, PlaytestCredentialsSchema, type AuditRecord } from '@card-game/protocol';
import { requireSession } from '../auth/routes';
import { AuthError } from '../auth/errors';
import type { AuthService } from '../auth/service';
import type { AuditService } from '../admin/audit';
import type { ServerConfig } from '../config';
import { ScenarioService, scenariosEnabled } from '../scenarios/service';
import { presetFixture, presetNames } from '../scenarios/presets';
const version = z.literal(1), idSchema = z.string().uuid(), revision = z.number().int().positive();
const save = z.object({ protocolVersion: version, scenario: ScenarioSchema, expectedRevision: revision.optional() }).strict();
const launch = z.object({ protocolVersion: version, expectedRevision: revision, participants: z.tuple([idSchema, idSchema]) }).strict();
const remove = z.object({ protocolVersion: version, expectedRevision: revision }).strict();
const reset = z.object({ protocolVersion: version }).strict();
export function createScenariosRouter(service: ScenarioService, auth: AuthService, config: ServerConfig, audit: AuditService) {
    const router = Router();
    const record = (actor: string | null, action: AuditRecord['action'], target: string, outcome: AuditRecord['outcome'] = 'success') => { audit.record(actor, action, target.slice(0, 128), outcome); audit.flush(); };
    router.use(async (request, response, next) => {
        let actor: string | null = null;
        try {
            const s = requireSession(auth, request), account = s.subject.kind === 'account' ? auth.repository.findAccount(s.subject.id) : undefined;
            actor = account?.id ?? null;
            if (s.scope !== 'admin' || !account || account.disabled || account.role !== 'admin')
                throw new AuthError(403, 'Current administrator access required.');
            if (!scenariosEnabled(config))
                throw new AuthError(404, 'Scenario capability unavailable on this instance.');
            await auth.authorize(s);
            response.locals.actor = actor;
            response.locals.operator = s;
            next();
        }
        catch (e) {
            try {
                record(actor, 'scenario.denied', 'scenarios', 'denied');
            }
            catch { }
            next(e);
        }
    });
    const route = (method: 'get' | 'post' | 'put' | 'delete', path: string, action: AuditRecord['action'], work: (request: Request, actor: string) => unknown) => {
        router[method](path, (request, response, next) => {
            try {
                const result = service.atomic(() => audit.atomic(() => { audit.record(response.locals.actor, action, typeof request.params.id === 'string' ? request.params.id : 'scenarios'); return work(request, response.locals.actor); }));
                audit.flush();
                response.json(result);
            }
            catch (e) {
                try {
                    record(response.locals.actor, action, 'scenarios', e instanceof AuthError && e.status === 404 ? 'not_found' : 'denied');
                }
                catch { }
                next(e);
            }
        });
    };
    const parse = <T>(schema: z.ZodType<T>, input: unknown): T => { const p = schema.safeParse(input); if (!p.success)
        throw new AuthError(400, 'Invalid scenario request.'); return p.data; };
    const id = (request: Request) => parse(idSchema, request.params.id);
    route('get', '/presets', 'scenario.read', () => ({ protocolVersion: 1, fixtures: presetNames.map(name => ({ name, fixture: presetFixture(name) })) }));
    route('get', '/runs', 'scenario.runs', () => ScenarioRunsSchema.parse({ protocolVersion: 1, runs: service.listRuns() }));
    router.post('/playtest', (request, response, next) => {
        try {
            const input = parse(PlaytestLaunchSchema, request.body);
            const credentials = service.atomic(() => audit.atomic(() => {
                const result = service.launchPlaytest(input.scenario, response.locals.operator, input.source);
                audit.record(response.locals.actor, 'scenario.launch', result.run.roomId);
                return PlaytestCredentialsSchema.parse(result);
            }));
            audit.flush();
            response.status(201).json(credentials);
        } catch (error) { next(error); }
    });
    route('delete', '/runs/:id', 'scenario.stop', r => { parse(reset, r.body); service.stop(id(r)); return { protocolVersion: 1, ok: true }; });
    route('post', '/runs/:id/reset', 'scenario.reset', (r, a) => { parse(reset, r.body); return ScenarioRunResponseSchema.parse({ protocolVersion: 1, run: service.reset(id(r), a) }); });
    route('get', '/', 'scenario.list', r => { const { offset, limit } = parse(PageQuerySchema, { ...r.query, limit: r.query.limit ?? config.http.pageSize }); return ScenarioPageSchema.parse({ protocolVersion: 1, ...service.repository.listScenarios(offset, limit), offset, limit }); });
    route('post', '/', 'scenario.create', r => { const p = parse(save, r.body); if (p.expectedRevision !== undefined)
        throw new AuthError(400, 'New scenario cannot specify a revision.'); return ScenarioResponseSchema.parse({ protocolVersion: 1, record: service.save(p.scenario) }); });
    route('post', '/import', 'scenario.create', r => { const p = parse(z.object({ protocolVersion: version, fixture: ScenarioFixtureSchema }).strict(), r.body); return ScenarioResponseSchema.parse({ protocolVersion: 1, record: service.save(p.fixture.scenario, undefined, 0, p.fixture.origin ?? p.fixture.provenance) }); });
    route('get', '/:id/export', 'scenario.export', r => { const record = service.get(id(r)); return ScenarioExportSchema.parse({ protocolVersion: 1, fixture: { format: 'card-game-scenario', version: 1, scenario: record.scenario, provenance: { sourceId: record.id, revision: record.revision, instanceId: config.navigation.instanceId }, ...(record.importedFrom ? { origin: record.importedFrom } : {}) } }); });
    route('get', '/:id', 'scenario.read', r => ScenarioResponseSchema.parse({ protocolVersion: 1, record: service.get(id(r)) }));
    route('put', '/:id', 'scenario.update', r => { const p = parse(save, r.body); if (!p.expectedRevision)
        throw new AuthError(400, 'Expected revision required.'); return ScenarioResponseSchema.parse({ protocolVersion: 1, record: service.save(p.scenario, id(r), p.expectedRevision) }); });
    route('delete', '/:id', 'scenario.delete', r => { const p = parse(remove, r.body); service.delete(id(r), p.expectedRevision); return { protocolVersion: 1, ok: true }; });
    route('post', '/:id/launch', 'scenario.launch', (r, a) => { const p = parse(launch, r.body); return ScenarioRunResponseSchema.parse({ protocolVersion: 1, run: service.launch(id(r), p.expectedRevision, p.participants, a) }); });
    return router;
}
