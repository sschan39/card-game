import { afterEach, describe, expect, it, vi } from 'vitest';
import { clientLogger } from '@client/logger';

afterEach(() => { vi.restoreAllMocks(); });

describe('client diagnostics logger', () => {
  it('writes leveled, prefixed console entries with optional details', () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});

    clientLogger.info('delta:applied', 'Applied', { seq: 4 });
    clientLogger.warn('transport', 'Offline');
    const failure = new Error('boom');
    clientLogger.error('socket', 'Failed', failure);

    expect(info).toHaveBeenCalledWith('[client:delta:applied] Applied', { seq: 4 });
    expect(warn).toHaveBeenCalledWith('[client:transport] Offline', '');
    expect(error).toHaveBeenCalledWith('[client:socket] Failed', failure);
  });
});
