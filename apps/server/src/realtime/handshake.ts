import { SocketAuthSchema } from '@card-game/protocol';
import type { AuthService } from '../auth/service';
import type { SessionRecord } from '../auth/account-store';

export interface SocketIdentity { session: SessionRecord; playerId: string; roomId: string | null; rejoinDenied?: true }
export function authenticateHandshake(auth: AuthService, input: unknown): SocketIdentity {
  const parsed = SocketAuthSchema.safeParse(input);
  if (!parsed.success) throw new Error('A valid session is required. Reload or sign in again.');
  const session = auth.sessions.validate(parsed.data.token);
  if (!session) throw new Error('Session expired or revoked. Sign in again.');
  if (session.scope !== 'game' || session.kind === 'browser') throw new Error('Use a game session for the game connection.');
  const requestedRoom = parsed.data.roomId ?? null;
  const roomId = requestedRoom && auth.info(session, requestedRoom).roomId ? requestedRoom : null;
  return { session, playerId: auth.playerId(session, roomId), roomId, ...(requestedRoom && !roomId ? { rejoinDenied: true as const } : {}) };
}
