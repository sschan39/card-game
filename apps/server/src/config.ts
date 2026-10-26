/** Password costs and operational limits are server-only; no credentials enter protocol. */
export const authConfig = {
  password: { memoryCost: 19_456, timeCost: 2, parallelism: 1, hashLength: 32 },
  sessionTtlMs: 8 * 60 * 60 * 1000,
  adminSessionTtlMs: 15 * 60 * 1000,
  guestTtlMs: 24 * 60 * 60 * 1000,
  maxSessions: 1000,
  maxAccounts: 10_000,
  maxPasswordOperations: 2,
  rateLimit: { windowMs: 15 * 60 * 1000, limit: 20 },
  guestRateLimit: { windowMs: 15 * 60 * 1000, limit: 100 },
};
export type AuthConfig = typeof authConfig;

export function allowedOrigins(environment: NodeJS.ProcessEnv = process.env): ReadonlySet<string> {
  const origins: string[] = environment.NODE_ENV === 'production' ? [] : ['http://localhost:3000', 'http://localhost:5173', 'http://localhost:5174'];
  for (const entry of (environment.ALLOWED_ORIGINS ?? '').split(',').map(value => value.trim()).filter(Boolean)) {
    const url = new URL(entry);
    if (!['http:', 'https:'].includes(url.protocol) || url.origin !== entry || url.username || url.password) throw new Error('Invalid allowed origin configuration');
    origins.push(url.origin);
  }
  return new Set(origins);
}
