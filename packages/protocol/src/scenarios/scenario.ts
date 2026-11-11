import { z } from 'zod';
import { CardIdSchema } from '../decks/deck';
const utf8Size = (text: string) => Array.from(text).reduce((n, c) => {
    const codePoint = c.codePointAt(0)!;
    return n + (codePoint < 128 ? 1 : codePoint < 2048 ? 2 : codePoint < 65536 ? 3 : 4);
}, 0);
export const ScenarioCountsSchema = z.array(z.object({ cardId: CardIdSchema, quantity: z.number().int().min(1).max(250) }).strict()).max(64)
    .refine(entries => new Set(entries.map(e => e.cardId)).size === entries.length && entries.reduce((n, e) => n + e.quantity, 0) <= 250, 'Duplicate cards or zone too large.');
export const expandScenarioCards = (entries: readonly {
    cardId: string;
    quantity: number;
}[]) => entries.flatMap(e => Array.from({ length: e.quantity }, () => e.cardId));
const player = z.object({ life: z.number().int().min(1).max(1000), library: ScenarioCountsSchema,
    libraryOrder: z.array(CardIdSchema).max(250).optional(), hand: ScenarioCountsSchema, graveyard: ScenarioCountsSchema, battlefield: ScenarioCountsSchema }).strict()
    .refine(p => !p.libraryOrder || JSON.stringify([...p.libraryOrder].sort()) === JSON.stringify(expandScenarioCards(p.library).sort()), 'Order must match library composition.')
    .refine(p => expandScenarioCards(p.battlefield).length <= 40 && expandScenarioCards(p.hand).length <= 50, 'Initial board/hand too large.');
export const ScenarioSchema = z.object({ schemaVersion: z.literal(1), name: z.string().trim().min(1).max(80),
    rulesProfile: z.enum(['standard-v1', 'scorch-v1']).default('standard-v1'), players: z.tuple([player, player]), openingHandSize: z.number().int().min(0).max(30),
    firstPlayer: z.union([z.literal(0), z.literal(1)]), shuffle: z.enum(['fixed', 'seeded']), seed: z.number().int().min(0).max(4294967295),
}).strict().refine(s => s.players.every(p => expandScenarioCards(p.library).length >= s.openingHandSize && expandScenarioCards(p.hand).length + s.openingHandSize <= 50), 'Opening draw exceeds library/hand limit.').refine(s => utf8Size(JSON.stringify(s)) <= 24576, 'Scenario exceeds the 24 KiB setup limit.');
export type Scenario = z.infer<typeof ScenarioSchema>;
export const ScenarioProvenanceSchema = z.object({ sourceId: z.string().uuid().nullable(), revision: z.number().int().min(0), instanceId: z.string().min(1).max(32) }).strict();
export type ScenarioProvenance = z.infer<typeof ScenarioProvenanceSchema>;
export const ScenarioRecordSchema = z.object({ id: z.string().uuid(), revision: z.number().int().positive(), scenario: ScenarioSchema, createdAt: z.number().int(), updatedAt: z.number().int(), importedFrom: ScenarioProvenanceSchema.optional() }).strict();
export type ScenarioRecord = z.infer<typeof ScenarioRecordSchema>;
export const ScenarioFixtureSchema = z.object({ format: z.literal('card-game-scenario'), version: z.literal(1), scenario: ScenarioSchema,
    provenance: ScenarioProvenanceSchema, origin: ScenarioProvenanceSchema.optional() }).strict();
export const ScenarioResponseSchema = z.object({ protocolVersion: z.literal(1), record: ScenarioRecordSchema }).strict();
export const ScenarioPageSchema = z.object({ protocolVersion: z.literal(1), records: z.array(ScenarioRecordSchema), total: z.number().int(), offset: z.number().int(), limit: z.number().int() }).strict();
export const ScenarioRunSchema = z.object({ roomId: z.string().uuid(), scenarioId: z.string().uuid(), revision: z.number().int().positive(),
    snapshot: ScenarioSchema, participants: z.tuple([z.string().uuid(), z.string().uuid()]), createdAt: z.number().int(), actorId: z.string().uuid() }).strict();
export type ScenarioRun = z.infer<typeof ScenarioRunSchema>;
export const ScenarioRunResponseSchema = z.object({ protocolVersion: z.literal(1), run: ScenarioRunSchema }).strict();
export const ScenarioRunsSchema = z.object({ protocolVersion: z.literal(1), runs: z.array(ScenarioRunSchema) }).strict();
export const ScenarioExportSchema = z.object({ protocolVersion: z.literal(1), fixture: ScenarioFixtureSchema }).strict();
export function importScenario(text: string) { if (utf8Size(text) > 65536)
    throw new Error('Scenario import exceeds 64 KiB.'); return ScenarioFixtureSchema.parse(JSON.parse(text)); }
export function newScenario(): Scenario { const p = () => ({ life: 20, library: [{ cardId: 'land-red', quantity: 10 }], hand: [], graveyard: [], battlefield: [] }); return { schemaVersion: 1, rulesProfile: 'standard-v1', name: 'New scenario', players: [p(), p()], openingHandSize: 5, firstPlayer: 0, shuffle: 'fixed', seed: 1 }; }
export const ScenarioPresetsSchema = z.object({ protocolVersion: z.literal(1), fixtures: z.array(z.object({ name: z.string(), fixture: ScenarioFixtureSchema }).strict()).max(5) }).strict();
