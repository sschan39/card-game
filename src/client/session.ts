/**
 * src/client/session.ts
 * Stable per-tab identity + room persistence helpers.
 *
 * The player's identity must survive page refreshes and socket reconnects,
 * but a brand-new tab should be a DIFFERENT player (so two tabs on one machine
 * can play against each other). sessionStorage is per-tab, which matches this
 * exactly — localStorage would make two tabs collide on the same identity.
 */

const PLAYER_ID_KEY = 'cardgame.playerId';
const ROOM_ID_KEY = 'cardgame.roomId';

/** Generate a UUIDv4 (crypto.randomUUID when available, else Math.random fallback). */
function generateUuid(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  // Fallback for non-secure contexts / older browsers.
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/** Get the stable player id, creating and persisting it on first access. */
export function getOrCreatePlayerId(): string {
  let id = sessionStorage.getItem(PLAYER_ID_KEY);
  if (!id) {
    id = generateUuid();
    sessionStorage.setItem(PLAYER_ID_KEY, id);
  }
  return id;
}

/** Get the persisted room id, or null if none. */
export function getStoredRoomId(): string | null {
  return sessionStorage.getItem(ROOM_ID_KEY);
}

/** Persist the room id. */
export function setStoredRoomId(roomId: string): void {
  sessionStorage.setItem(ROOM_ID_KEY, roomId);
}

/** Clear the persisted room id (e.g. on room destroy / rejoin failure). */
export function clearStoredRoomId(): void {
  sessionStorage.removeItem(ROOM_ID_KEY);
}