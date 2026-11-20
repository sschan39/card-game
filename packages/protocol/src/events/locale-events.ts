import { z } from 'zod';
import { PROTOCOL_VERSION } from '../version';

/**
 * Interface languages a client may ask for.
 *
 * This list is the wire contract, deliberately written here rather than imported
 * from the engine: clients cannot depend on engine modules, and the protocol must
 * stay type-only towards the engine.
 */
export const LOCALE_CODES = ['en', 'zh-Hant'] as const;
export const LocaleCodeSchema = z.enum(LOCALE_CODES);
export type ClientLocale = (typeof LOCALE_CODES)[number];

/** Ask the server to project this connection's card text in another language. */
export const SetLocaleRequestSchema = z.object({
  protocolVersion: z.literal(PROTOCOL_VERSION),
  locale: LocaleCodeSchema,
}).strict();
export type SetLocaleRequest = z.infer<typeof SetLocaleRequestSchema>;

/** Acknowledgement: the language this connection will be projected in from now on. */
export const LocaleChangedSchema = z.object({
  protocolVersion: z.literal(PROTOCOL_VERSION),
  locale: LocaleCodeSchema,
}).strict();
export type LocaleChanged = z.infer<typeof LocaleChangedSchema>;
