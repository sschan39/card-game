import { z } from 'zod';
import { PROTOCOL_VERSION } from '../version';
import { SessionInfoSchema } from './auth';

export const NavigationDestinationSchema = z.string().max(2048).refine(value => {
  if (value.startsWith('/') && !value.startsWith('//') && !/[\\\s?#]/.test(value)) return true;
  return z.url().safeParse(value).success && /^https?:\/\/[^/?#@\\\s]+(?:\/[^?#\\\s]*)?$/.test(value);
});
export const NavigationConfigSchema = z.object({
  instanceId: z.string().regex(/^[a-z0-9][a-z0-9-]{0,31}$/),
  purpose: z.enum(['development', 'live', 'lab']), label: z.string().min(1).max(60),
  home: NavigationDestinationSchema, play: NavigationDestinationSchema, decks: NavigationDestinationSchema,
  admin: NavigationDestinationSchema.nullable(), lab: NavigationDestinationSchema.nullable(),
  extraPages: z.array(z.object({ id: z.string().regex(/^[a-z][a-z0-9-]{0,31}$/), label: z.string().min(1).max(60), workspace: z.enum(['home', 'play', 'decks', 'admin']), href: NavigationDestinationSchema, adminOnly: z.boolean().default(false) }).strict()).max(32).default([]),
}).strict().refine(value => new Set(value.extraPages.map(page => page.id)).size === value.extraPages.length && value.extraPages.every(page => !['home', 'play', 'decks', 'admin', 'lab'].includes(page.id)), { message: 'Navigation page IDs must be unique.' }).refine(value => !value.admin?.startsWith('http') || [value.home, value.play, value.decks].every(url => url.startsWith('http')), { message: 'Separate admin hosting requires absolute public destinations.' });
export const PlatformResponseSchema = z.object({ protocolVersion: z.literal(PROTOCOL_VERSION), navigation: NavigationConfigSchema,
  capabilities: z.object({ scenarios: z.literal(false) }).strict(),
}).strict();
export type PlatformInfo = z.infer<typeof PlatformResponseSchema>;
export const BrowserIdentitySchema = z.object({ protocolVersion: z.literal(PROTOCOL_VERSION), session: SessionInfoSchema.nullable(), csrf: z.string().regex(/^[A-Za-z0-9_-]{43}$/).nullable() }).strict().refine(value => value.session ? value.session.scope === 'game' && value.session.account !== null && value.csrf !== null : value.csrf === null);
export type BrowserIdentity = z.infer<typeof BrowserIdentitySchema>;
export const BrowserTabRequestSchema = z.object({ protocolVersion: z.literal(PROTOCOL_VERSION), roomId: z.string().min(1).max(128).optional() }).strict();
export const RoomResumeResponseSchema = z.object({ protocolVersion: z.literal(PROTOCOL_VERSION), sessionId: z.string().min(1).max(128), roomId: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/), playerId: z.string().min(1).max(128) }).strict();
