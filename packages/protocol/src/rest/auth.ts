import { z } from 'zod';
import { PROTOCOL_VERSION } from '../version';

export const PASSWORD_LIMITS = { min: 15, max: 128 } as const;
const version = z.literal(PROTOCOL_VERSION);
const username = z.string().trim().toLowerCase().regex(/^[a-z0-9][a-z0-9_.-]{2,31}$/);
const password = z.string().refine(value => Array.from(value.normalize('NFC')).length >= PASSWORD_LIMITS.min && Array.from(value.normalize('NFC')).length <= PASSWORD_LIMITS.max,
  { message: `Use ${PASSWORD_LIMITS.min}–${PASSWORD_LIMITS.max} characters` });
export const SessionTokenSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
const roomId = z.string().min(1).max(128);
export const RegisterRequestSchema = z.object({ protocolVersion: version, username, password, roomId: roomId.optional() }).strict();
export const LoginRequestSchema = z.object({ protocolVersion: version, username, password: z.string().min(1).max(512), roomId: roomId.optional(), scope: z.enum(['game', 'admin']).default('game') }).strict()
  .refine(value => value.scope !== 'admin' || value.roomId === undefined, { message: 'Admin login does not link a game seat' });
export const LogoutRequestSchema = z.object({ protocolVersion: version }).strict();
export const GuestRequestSchema = z.object({ protocolVersion: version }).strict();
export const PublicAccountSchema = z.object({ id: z.string(), username, role: z.enum(['player', 'admin']) }).strict();
export const SessionInfoSchema = z.object({
  protocolVersion: version, sessionId: z.string(), expiresAt: z.number().int(), playerId: z.string(),
  scope: z.enum(['game', 'admin']),
  account: PublicAccountSchema.nullable(), roomId: roomId.optional(),
}).strict();
export const AuthResponseSchema = SessionInfoSchema.extend({ token: SessionTokenSchema });
export const LogoutResponseSchema = z.object({ protocolVersion: version, ok: z.literal(true) }).strict();
export const AuthErrorSchema = z.object({ protocolVersion: version, message: z.string() }).strict();
export const SocketAuthSchema = z.object({ protocolVersion: version, token: SessionTokenSchema, roomId: roomId.nullish(), playerId: z.unknown().optional() }).strict();
export type PublicAccount = z.infer<typeof PublicAccountSchema>;
export type SessionInfo = z.infer<typeof SessionInfoSchema>;
export type AuthResponse = z.infer<typeof AuthResponseSchema>;
