import { describe, expect, it } from 'vitest';
import { loadServerConfig, mergeConfig } from '@server/config';

describe('server configuration override boundaries', () => {
  it('replaces a whole subtree when either side of a merge is not a plain object', () => {
    expect(mergeConfig({ value: 1 }, [1, 2])).toEqual([1, 2]);
    expect(mergeConfig('base', { value: 1 })).toEqual({ value: 1 });
    expect(mergeConfig({ value: 1 }, null)).toBeNull();
  });

  it('applies storage, diagnostic log, fixture and page overrides from the environment', () => {
    const config = loadServerConfig({
      DATABASE_PATH: 'data/override.sqlite',
      DELTA_LOG_PATH: 'data/override-deltas.jsonl',
      ADMIN_AUDIT_PATH: 'data/override-audit.jsonl',
      FIXTURE_DECKS_ENABLED: 'true',
    });
    expect(config.storage.databasePath).toBe('data/override.sqlite');
    expect(config.logging.deltaPath).toBe('data/override-deltas.jsonl');
    expect(config.logging.auditPath).toBe('data/override-audit.jsonl');
    expect(config.fixturesEnabled).toBe(true);
  });

  it('rejects a declared profile that does not match the startup environment', () => {
    expect(() => loadServerConfig({ NODE_ENV: 'test' }, { profile: 'development' })).toThrow('Invalid configuration: profile');
  });

  it('accepts same-origin HTTPS production destinations without a separate admin app', () => {
    const navigation = {
      home: 'https://game.example/home',
      play: 'https://game.example/play',
      decks: 'https://game.example/deck-builder/',
      admin: null,
    };
    const config = loadServerConfig({ NODE_ENV: 'production' }, { navigation });
    expect(config.navigation.admin).toBeNull();
    expect(config.navigation.home).toBe(navigation.home);
  });
});
