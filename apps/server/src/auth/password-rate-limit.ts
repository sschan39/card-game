import { rateLimit } from 'express-rate-limit';
import { PROTOCOL_VERSION } from '@card-game/protocol';
import type { AuthConfig } from '../config';

/** One bucket per application, shared by public-cookie and legacy/admin password routes. */
export const createPasswordLimiter = (config: AuthConfig) => rateLimit({ ...config.rateLimit, standardHeaders: 'draft-8', legacyHeaders: false,
  handler: (_request, response) => response.status(429).json({ protocolVersion: PROTOCOL_VERSION, message: 'Too many authentication attempts. Try again later.' }) });
