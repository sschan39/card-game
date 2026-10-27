import { z } from 'zod';

const positive = (max: number) => z.number().int().min(1).max(max);
const rate = z.object({ windowMs: positive(86_400_000), limit: positive(100_000) }).strict();
export const AuthConfigSchema = z.object({
  password: z.object({ memoryCost: z.number().int().min(19456).max(262144), timeCost: z.number().int().min(2).max(10), parallelism: positive(4), hashLength: z.literal(32) }).strict(),
  sessionTtlMs: positive(86_400_000), adminSessionTtlMs: positive(3_600_000), guestTtlMs: positive(604_800_000),
  maxSessions: positive(100_000), maxAccounts: positive(1_000_000), maxPasswordOperations: positive(8), rateLimit: rate, guestRateLimit: rate,
}).strict();
const origin = z.string().refine(value => { try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) && url.origin === value && !url.username && !url.password; } catch { return false; } });
const rules = z.object({ startingLife: positive(10000), openingHandSize: z.number().int().min(0).max(100), firstPlayerDrawsOnFirstTurn: z.boolean(), landPlaysPerTurn: z.number().int().min(0).max(100), scorch: z.boolean() }).partial().strict();
export const ServerConfigSchema = z.object({
  profile: z.enum(['development', 'production', 'test']), auth: AuthConfigSchema,
  http: z.object({ port: z.number().int().min(0).max(65535), bodyLimitBytes: z.number().int().min(1024).max(65536), pageSize: positive(100) }).strict(),
  storage: z.object({ databasePath: z.string().min(1).max(4096), lockTimeoutMs: positive(5000), maxDecksPerAccount: positive(1000) }).strict(),
  rooms: z.object({ reconnectGraceMs: positive(300000), preset: z.enum(['development', 'trigger', 'st01a', 'workbook', 'small-mechanics']), rules }).strict(),
  logging: z.object({ deltaPath: z.string().max(4096), auditPath: z.string().min(1).max(4096), auditFlushMs: z.number().int().min(1000).max(60000), pageBytes: z.number().int().min(1024).max(1048576), maxLineBytes: z.number().int().min(128).max(262144), scanBytes: z.number().int().min(1024).max(4194304) }).strict(),
  origins: z.array(origin).max(100), inspectionEnabled: z.boolean(), fixturesEnabled: z.boolean(), debugMode: z.enum(['off', 'flow', 'stack']),
}).strict().refine(value => value.logging.maxLineBytes < value.logging.pageBytes && value.logging.pageBytes <= value.logging.scanBytes, { path: ['logging'], message: 'Invalid log read bounds' });
export type ServerConfig = z.infer<typeof ServerConfigSchema>;
export type AuthConfig = z.infer<typeof AuthConfigSchema>;
