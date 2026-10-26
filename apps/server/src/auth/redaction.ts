const sensitive = /password|passwd|passphrase|hash|token|authorization|cookie|secret|credential|digest/i;
/** Defense in depth for structured metadata. Auth callers also use fixed, non-secret messages. */
export function redactCredentials(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactCredentials);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, sensitive.test(key) ? '[REDACTED]' : redactCredentials(child)]));
}
