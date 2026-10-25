import { afterEach, describe, expect, it, vi } from 'vitest';
const handlers = vi.hoisted(() => new Map<string, (data: any) => void>());
vi.mock('socket.io-client', () => ({ io: () => ({ on: (event: string, handler: (data: any) => void) => handlers.set(event, handler) }) }));
import '@client/socket';
import { useGameStore } from '@client/store/gameStore';
import { clientLogger } from '@rules/game-logger';
import { gameConfig } from '@config';
afterEach(() => vi.restoreAllMocks());
describe('socket rejection feedback', () => {
  it('shows correlated errors even when their console trace is switched off', () => {
    const original = gameConfig.logging.actions; gameConfig.logging.actions = false;
    try {
      const warn = vi.spyOn(clientLogger, 'warn');
      handlers.get('error')!({ message: 'Not your priority', action: 'choose', commandId: 'c' });
      expect(useGameStore.getState().error).toBe('Not your priority'); expect(warn).not.toHaveBeenCalled();
    } finally { gameConfig.logging.actions = original; }
  });
  it('keeps transport failures visible independently of normal tracing', () => {
    const error = vi.spyOn(clientLogger, 'error');
    handlers.get('connect_error')!(new Error('offline'));
    expect(error).toHaveBeenCalledWith('connection:failed', 'offline');
    expect(useGameStore.getState().error).toContain('offline');
  });
});
