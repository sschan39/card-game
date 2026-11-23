import { z } from 'zod';
import { PROTOCOL_VERSION } from '../version';
import { PublicAccountSchema, RegisterRequestSchema } from './auth';
import { PageQuerySchema } from '../decks/deck';

const version = z.literal(PROTOCOL_VERSION);
export const AdminAccountRoleSchema = z.enum(['player', 'tester', 'admin']);
export const AdminAccountSchema = PublicAccountSchema.extend({
  username: z.string().regex(/^[a-z0-9][a-z0-9_.-]{2,63}$/),
  role: AdminAccountRoleSchema, disabled: z.boolean(), createdAt: z.number().int().optional(),
});
export type AdminAccount = z.infer<typeof AdminAccountSchema>;
const adminAccountPage = z.object({ protocolVersion: version, accounts: z.array(AdminAccountSchema), offset: z.number().int(), limit: z.number().int() }).strict();
export const AdminAccountsResponseSchema = z.union([
  adminAccountPage.extend({ total: z.number().int() }),
  adminAccountPage.extend({ nextOffset: z.number().int().nonnegative().nullable() }),
]);
export const AdminIdentityResponseSchema = z.object({ protocolVersion: version, account: PublicAccountSchema }).strict();
export const CreateAdminAccountRequestSchema = RegisterRequestSchema.omit({ roomId: true }).extend({ role: AdminAccountRoleSchema });
export const UpdateAdminAccountRequestSchema = z.object({
  protocolVersion: version, role: AdminAccountRoleSchema.optional(), disabled: z.boolean().optional(),
}).strict().refine(value => value.role !== undefined || value.disabled !== undefined);
export const DisableAccountRequestSchema = z.object({ protocolVersion: version }).strict();
export const AdminAccountResponseSchema = z.object({ protocolVersion: version, account: AdminAccountSchema }).strict();
export const AdminRoomsResponseSchema = z.object({ protocolVersion: version, rooms: z.array(z.object({ roomId: z.string(), status: z.string(), phase: z.string(), turnNumber: z.number().int(), players: z.number().int() }).strict()), total: z.number().int(), offset: z.number().int(), limit: z.number().int() }).strict();
export const AdminRoomResponseSchema = z.object({ protocolVersion: version, room: z.record(z.string(), z.unknown()) }).strict();
export const AuditActionSchema = z.enum(['admin.identity', 'admin.denied', 'admin.unavailable', 'rooms.list', 'room.inspect', 'logs.read', 'accounts.list', 'account.create', 'account.update', 'account.disable', 'config.read', 'scenario.list', 'scenario.read', 'scenario.create', 'scenario.update', 'scenario.delete', 'scenario.export', 'scenario.launch', 'scenario.reset', 'scenario.runs', 'scenario.denied', 'scenario.unavailable', 'scenario.stop']);
export const AuditRecordSchema = z.object({ id: z.string().uuid(), timestamp: z.number().int(), actorId: z.string().nullable(), action: AuditActionSchema, target: z.string().max(128), outcome: z.enum(['success', 'denied', 'not_found', 'unavailable']) }).strict();
export type AuditRecord = z.infer<typeof AuditRecordSchema>;
export const LogQuerySchema = z.object({ cursor: z.string().min(1).max(2048).optional(), offset: z.coerce.number().int().min(0).max(Number.MAX_SAFE_INTEGER).default(0), limit: PageQuerySchema.shape.limit }).strict()
  .refine(value => !value.cursor || value.offset === 0, { message: 'Use a cursor or initial offset' });
export const AdminLogsResponseSchema = z.object({ protocolVersion: version, entries: z.array(z.object({ offset: z.number().int(), value: z.unknown() }).strict()), nextCursor: z.string().nullable(), eof: z.boolean(), bytesRead: z.number().int(), skipped: z.number().int() }).strict();
export type AdminLogPage = z.infer<typeof AdminLogsResponseSchema>;
export const AdminConfigResponseSchema = z.object({ protocolVersion: version, revision: z.string(), profile: z.string(), inspectionEnabled: z.boolean(), fixturesEnabled: z.boolean(), debugMode: z.string(), reconnectGraceMs: z.number().int(), sessionTtlMs: z.number().int(), adminSessionTtlMs: z.number().int(), pageSize: z.number().int(), maxDecksPerAccount: z.number().int(), auditExportPending: z.boolean() }).strict();
