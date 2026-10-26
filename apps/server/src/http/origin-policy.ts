import type { RequestHandler } from 'express';
import { PROTOCOL_VERSION } from '@card-game/protocol';

export const originAllowed = (origins: ReadonlySet<string>, origin: unknown): boolean => origin === undefined || typeof origin === 'string' && origins.has(origin);
export function originPolicy(origins: ReadonlySet<string>): RequestHandler {
  return (request, response, next) => {
    const origin = request.headers.origin;
    response.vary('Origin');
    if (!originAllowed(origins, origin)) { response.status(403).json({ protocolVersion: PROTOCOL_VERSION, message: 'Origin is not allowed.' }); return; }
    if (origin) response.setHeader('Access-Control-Allow-Origin', origin);
    response.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    response.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (request.method === 'OPTIONS') { response.status(204).end(); return; }
    next();
  };
}
