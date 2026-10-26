import { createHash } from 'node:crypto';
import { argon2id, hash, verify } from 'argon2';
import { PASSWORD_LIMITS } from '@card-game/protocol';
import { authConfig } from '../config';
import { AuthError } from './errors';
import breachedHashes from './breached-passwords.json';

const blocked = new Set<string>(breachedHashes);
export const normalizePassword = (password: string): string => password.normalize('NFC');
export function assertPasswordPolicy(password: string): void {
  const normalized = normalizePassword(password), length = Array.from(normalized).length;
  if (length < PASSWORD_LIMITS.min || length > PASSWORD_LIMITS.max) throw new AuthError(400, `Use ${PASSWORD_LIMITS.min}–${PASSWORD_LIMITS.max} password characters.`);
  if (blocked.has(createHash('sha256').update(normalized.toLowerCase()).digest('hex'))) throw new AuthError(400, 'Choose a password that is not commonly used or breached.');
}
export function hashPassword(password: string, parameters = authConfig.password): Promise<string> {
  assertPasswordPolicy(password);
  return hash(normalizePassword(password), { ...parameters, type: argon2id });
}
export async function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  try { return await verify(passwordHash, normalizePassword(password)); } catch { return false; }
}
