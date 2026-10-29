import { readFileSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import auth from './auth.json';
import http from './http.json';
import storage from './storage.json';
import rooms from './rooms.json';
import logging from './logging.json';
import navigation from './navigation.json';
import viteNavigation from './navigation.vite.json';
import development from './profiles/development.json';
import production from './profiles/production.json';
import test from './profiles/test.json';
import { AuthConfigSchema, ServerConfigSchema, type ServerConfig } from './schema';
export type { AuthConfig, ServerConfig } from './schema';

export class ConfigurationError extends Error {}
const checkedAuth = AuthConfigSchema.safeParse(auth);
if (!checkedAuth.success) throw new ConfigurationError('Invalid configuration: auth defaults');
export const authConfig = checkedAuth.data;
export const storageDefaults = Object.freeze(storage);
function freeze<T>(value: T): T {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value;
}
const profiles = { development, production, test };
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
/** Arrays replace. Dangerous/unknown keys never become silently accepted settings. */
export function mergeConfig(base: unknown, override: unknown): unknown {
  if (!object(override) || !object(base)) return structuredClone(override);
  const result = structuredClone(base);
  for (const [key, value] of Object.entries(override)) {
    if (['__proto__', 'constructor', 'prototype'].includes(key)) throw new ConfigurationError('Invalid configuration key');
    result[key] = object(value) && object(result[key]) ? mergeConfig(result[key], value) : structuredClone(value);
  }
  return result;
}
function booleanSetting(name: string, value: string | undefined): boolean | undefined {
  if (value === undefined) return;
  if (value !== 'true' && value !== 'false') throw new ConfigurationError('Invalid configuration: ' + name);
  return value === 'true';
}
export function loadServerConfig(environment: NodeJS.ProcessEnv = process.env, override?: unknown): ServerConfig {
  const profile = environment.NODE_ENV ?? 'development';
  if (!Object.prototype.hasOwnProperty.call(profiles, profile)) throw new ConfigurationError('Invalid configuration: NODE_ENV');
  let value: unknown = { profile, auth, http, storage, rooms, logging, navigation: profile === 'production' ? { ...navigation, instanceId: 'live-game', purpose: 'live', label: 'Live game', home: '/home', play: '/play', decks: '/deck-builder/', admin: null } : navigation, ...profiles[profile as keyof typeof profiles] };
  const frontendMode = environment.FRONTEND_MODE ?? 'built';
  if (!['built', 'vite'].includes(frontendMode) || profile === 'production' && frontendMode === 'vite') throw new ConfigurationError('Invalid configuration: FRONTEND_MODE');
  if (frontendMode === 'vite') value = mergeConfig(value, { navigation: viteNavigation });
  if (environment.CONFIG_FILE) {
    try {
      if (!statSync(environment.CONFIG_FILE).isFile() || statSync(environment.CONFIG_FILE).size > 65536) throw new Error();
      value = mergeConfig(value, JSON.parse(readFileSync(environment.CONFIG_FILE, 'utf8')));
    } catch { throw new ConfigurationError('Invalid configuration: CONFIG_FILE'); }
  }
  if (override !== undefined) value = mergeConfig(value, override);
  const overrides: Record<string, unknown> = {};
  if (environment.PORT !== undefined) overrides.http = { port: Number(environment.PORT) };
  if (environment.DATABASE_PATH !== undefined) overrides.storage = { databasePath: environment.DATABASE_PATH };
  const paths = { ...(environment.DELTA_LOG_PATH !== undefined ? { deltaPath: environment.DELTA_LOG_PATH } : {}), ...(environment.ADMIN_AUDIT_PATH ? { auditPath: environment.ADMIN_AUDIT_PATH } : {}) };
  if (Object.keys(paths).length) overrides.logging = paths;
  if (environment.ALLOWED_ORIGINS !== undefined) overrides.origins = environment.ALLOWED_ORIGINS.split(',').map(entry => entry.trim()).filter(Boolean);
  const inspection = booleanSetting('INSPECTOR_ENABLED', environment.INSPECTOR_ENABLED), fixtures = booleanSetting('FIXTURE_DECKS_ENABLED', environment.FIXTURE_DECKS_ENABLED);
  if (inspection !== undefined) overrides.inspectionEnabled = inspection;
  if (fixtures !== undefined) overrides.fixturesEnabled = fixtures;
  value = mergeConfig(value, overrides);
  const parsed = ServerConfigSchema.safeParse(value);
  if (!parsed.success) throw new ConfigurationError('Invalid configuration: ' + [...new Set(parsed.error.issues.map(issue => issue.path.join('.') || 'root'))].join(', '));
  if (parsed.data.profile !== profile) throw new ConfigurationError('Invalid configuration: profile');
  return freeze(parsed.data);
}
export function allowedOrigins(environment: NodeJS.ProcessEnv = process.env): ReadonlySet<string> { return new Set(loadServerConfig(environment).origins); }
export function configRevision(config: ServerConfig): string { return createHash('sha256').update(JSON.stringify(config)).digest('hex').slice(0, 12); }
