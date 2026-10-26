import { afterEach, describe, expect, it, vi } from 'vitest';
const { handlers, disconnect } = vi.hoisted(() => ({ handlers: new Map<string, (data: any) => void>(), disconnect: vi.fn() }));
vi.mock('socket.io-client', () => ({ io: () => ({ on: (event: string, handler: (data: any) => void) => handlers.set(event, handler), disconnect }) }));
import '@client/socket';
import { useGameStore } from '@client/store/gameStore';
import { clientLogger } from '@client/logger';
import { clientFlags as gameConfig } from '@card-game/protocol';
import { useAuthStore } from '@client/auth-state';
afterEach(() => vi.restoreAllMocks());
describe('socket rejection feedback', () => {
  it('shows correlated errors even when their console trace is switched off', () => {
    const original = gameConfig.logging.actions; gameConfig.logging.actions = false;
    try {
      const warn = vi.spyOn(clientLogger, 'warn');
      handlers.get('error')!({ protocolVersion: 1, message: 'Not your priority', action: 'choose', commandId: 'c' });
      expect(useGameStore.getState().error).toBe('Not your priority'); expect(warn).not.toHaveBeenCalled();
    } finally { gameConfig.logging.actions = original; }
  });
  it('keeps transport failures visible independently of normal tracing', () => {
    const error = vi.spyOn(clientLogger, 'error');
    handlers.get('connect_error')!(new Error('offline'));
    expect(error).toHaveBeenCalledWith('connection:failed', 'offline');
    expect(useGameStore.getState().error).toContain('offline');
  });
  it('accepts authoritative identity and ignores stale session-ended messages after a newer login', () => {
    const session = { protocolVersion: 1 as const, scope: 'game' as const, sessionId: 'current', token: 'A'.repeat(43), expiresAt: Date.now() + 60_000, playerId: 'placeholder', account: null };
    useAuthStore.getState().setSession(session);
    const { token, ...info } = session;
    handlers.get('sessionReady')!({ ...info, playerId: 'server-owned-seat' });
    expect(useGameStore.getState().myPlayerId).toBe('server-owned-seat');
    handlers.get('sessionEnded')!({ protocolVersion: 1, sessionId: 'old', reason: 'rotated' });
    expect(useAuthStore.getState().session?.sessionId).toBe('current');
    handlers.get('sessionEnded')!({ protocolVersion: 1, sessionId: 'current', reason: 'logout' });
    expect(useAuthStore.getState().session).toBeNull(); expect(disconnect).toHaveBeenCalled();
  });
});
