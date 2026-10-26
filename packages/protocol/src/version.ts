export const PROTOCOL_VERSION = 1 as const;
export interface Versioned { protocolVersion: typeof PROTOCOL_VERSION }
export function isProtocolMessage(value: unknown): value is Versioned & Record<string, unknown> {
  return typeof value === 'object' && value !== null && (value as { protocolVersion?: unknown }).protocolVersion === PROTOCOL_VERSION;
}
