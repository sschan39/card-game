import { SocketAuthSchema, type ClientLocale } from '@card-game/protocol';
import type { AuthService } from '../auth/service';
import type { SessionRecord } from '../auth/account-store';

export interface SocketIdentity {
  session: SessionRecord; playerId: string; roomId: string | null;
  /** Interface language this connection asked for; card text is projected in it. */
  locale: ClientLocale;
  rejoinDenied?: true;
}
/**
 * Validate the handshake and derive the seat it belongs to.
 *
 * The locale is a preference, never an authorisation input: an old client that does
 * not send one keeps the default, and an unknown tag is rejected by the schema.
 */
export function authenticateHandshake(auth: AuthService, input: unknown): SocketIdentity {
  const parsed = SocketAuthSchema.safeParse(input);
  if (!parsed.success) throw new Error('A valid session is required. Reload or sign in again.');
  const session = auth.sessions.validate(parsed.data.token);
  if (!session) throw new Error('Session expired or revoked. Sign in again.');
  if (session.scope !== 'game' || session.kind === 'browser') throw new Error('Use a game session for the game connection.');
  const requestedRoom = parsed.data.roomId ?? null;
  const roomId = requestedRoom && auth.info(session, requestedRoom).roomId ? requestedRoom : null;
  const locale = parsed.data.locale ?? 'en';
  return {
    session, playerId: auth.playerId(session, roomId), locale, roomId,
    ...(requestedRoom && !roomId ? { rejoinDenied: true as const } : {}),
  };
}
