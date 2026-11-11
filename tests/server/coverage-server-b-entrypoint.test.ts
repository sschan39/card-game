import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const mocks = vi.hoisted(() => {
  const created: { listen: ReturnType<typeof vi.fn>; close: ReturnType<typeof vi.fn>; options: unknown }[] = [];
  const createGameApplication = vi.fn((options: unknown) => {
    const listen = vi.fn(), close = vi.fn();
    listen.mockImplementation((_port: number, _host: string | undefined, callback?: () => void) => {
      callback?.();
    });
    created.push({ listen, close, options });
    return { server: { listen }, io: { close }, ready: Promise.resolve() };
  });
  return { created, createGameApplication, backupDatabase: vi.fn(async () => undefined), logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() } };
});

vi.mock('@server/application', () => ({ createGameApplication: mocks.createGameApplication }));
vi.mock('@server/stores/backup', () => ({ backupDatabase: mocks.backupDatabase }));
vi.mock('@card-game/engine/shared/game-logger', () => ({ serverLogger: mocks.logger }));

type EntryApplication = { listen: ReturnType<typeof vi.fn>; close: ReturnType<typeof vi.fn>; options: unknown };
type EntryResult = {
  application: EntryApplication | undefined;
  added: (signal: 'SIGINT' | 'SIGTERM') => Array<() => void>;
  exitCode: number | undefined;
  stop: () => void;
};

/** Ambient machine settings must never leak into the startup scenarios under test. */
const clearedEnvironment: Record<string, string | undefined> = {
  CONFIG_FILE: undefined,
  PORT: undefined,
  FRONTEND_MODE: undefined,
  INSPECTOR_ENABLED: undefined,
  FIXTURE_DECKS_ENABLED: undefined,
  DATABASE_PATH: undefined,
  ADMIN_AUDIT_PATH: undefined,
  ALLOWED_ORIGINS: undefined,
  DELTA_LOG_PATH: '',
};

function applyEnvironment(values: Record<string, string | undefined>): () => void {
  const saved = new Map<string, string | undefined>();
  for (const [key, value] of Object.entries(values)) {
    saved.set(key, process.env[key]);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  return () => {
    for (const [key, value] of saved) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  };
}

async function runEntry(args: string[], environment: Record<string, string | undefined> = {}): Promise<EntryResult> {
  const restoreEnvironment = applyEnvironment({ ...clearedEnvironment, ...environment });
  const argv = process.argv, exitCode = process.exitCode, known = mocks.created.length;
  const before = { SIGINT: process.listeners('SIGINT').slice(), SIGTERM: process.listeners('SIGTERM').slice() };
  const added = (signal: 'SIGINT' | 'SIGTERM') =>
    process.listeners(signal).filter(listener => !before[signal].includes(listener)) as Array<() => void>;
  process.argv = ['node', 'apps/server/dist/index.js', ...args];
  try {
    vi.resetModules();
    await import('@server/index');
    await new Promise(resolve => setImmediate(resolve));
    return {
      application: mocks.created.length > known ? mocks.created[mocks.created.length - 1] : undefined,
      added,
      exitCode: process.exitCode,
      stop: () => {
        for (const signal of ['SIGINT', 'SIGTERM'] as const)
          for (const listener of added(signal)) process.removeListener(signal, listener);
      },
    };
  } finally {
    process.argv = argv;
    restoreEnvironment();
    process.exitCode = exitCode;
  }
}

const effectiveConfig = (application: EntryApplication | undefined) =>
  (application?.options as { effectiveConfig: { profile: string; navigation: { instanceId: string; decks: string } } })
    .effectiveConfig;

describe('process entry point startup modes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.created.length = 0;
  });

  it('listens on the configured port and closes the server on a shutdown signal', async () => {
    const entry = await runEntry([]);
    await vi.waitFor(() => expect(entry.application?.listen).toHaveBeenCalled());
    const [port, host] = entry.application!.listen.mock.calls[0] as [number, string | undefined, () => void];
    expect(port).toBe(3000);
    expect(host).toBeUndefined();
    expect(effectiveConfig(entry.application).profile).toBe('test');
    expect(mocks.logger.info).toHaveBeenCalledWith('server:listening', 'Game server started', { port: 3000 });
    const shutdown = entry.added('SIGINT');
    expect(shutdown).toHaveLength(1);
    expect(entry.added('SIGTERM')).toHaveLength(1);
    shutdown[0]();
    expect(entry.application!.close).toHaveBeenCalledTimes(1);
    entry.stop();
  });

  it('selects the Vite navigation without binding a lab host', async () => {
    const entry = await runEntry(['--vite']);
    await vi.waitFor(() => expect(entry.application?.listen).toHaveBeenCalled());
    expect(entry.application!.listen.mock.calls[0][1]).toBeUndefined();
    expect(effectiveConfig(entry.application).navigation.decks).toContain('5175');
    entry.stop();
  });

  it('binds the packaged lab profile to loopback on its documented port', async () => {
    const entry = await runEntry(['--lab']);
    await vi.waitFor(() => expect(entry.application?.listen).toHaveBeenCalled());
    expect(entry.application!.listen.mock.calls[0][0]).toBe(3001);
    expect(entry.application!.listen.mock.calls[0][1]).toBe('127.0.0.1');
    expect(effectiveConfig(entry.application).navigation.instanceId).toBe('scenario-lab');
    entry.stop();
  });

  it('honours an explicit lab configuration file', async () => {
    const entry = await runEntry(['--lab'], { CONFIG_FILE: join(process.cwd(), 'deploy', 'profiles', 'scenario-lab.example.json') });
    await vi.waitFor(() => expect(entry.application?.listen).toHaveBeenCalled());
    expect(entry.application!.listen.mock.calls[0][1]).toBe('127.0.0.1');
    expect(effectiveConfig(entry.application).profile).toBe('development');
    entry.stop();
  });

  it('refuses to start a lab instance whose configuration is not a lab', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'card-game-entry-'));
    try {
      const configFile = join(directory, 'not-a-lab.json');
      writeFileSync(configFile, JSON.stringify({ lab: { enabled: false } }));
      const entry = await runEntry(['--lab'], { CONFIG_FILE: configFile });
      await vi.waitFor(() => expect(mocks.logger.error).toHaveBeenCalled());
      expect(entry.exitCode).toBe(1);
      expect(entry.application).toBeUndefined();
      expect(mocks.logger.error).toHaveBeenCalledWith(
        'server:startup:failed',
        'Lab startup requires explicit lab identity, scenarios and inspection.',
      );
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('backs the database up to the requested new destination', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'card-game-entry-'));
    try {
      const destination = join(directory, 'backup.sqlite');
      const entry = await runEntry(['backup', destination]);
      await vi.waitFor(() => expect(mocks.backupDatabase).toHaveBeenCalled());
      const [source, target] = mocks.backupDatabase.mock.calls[0] as [string, string];
      expect(source.endsWith(join('data', 'card-game.sqlite'))).toBe(true);
      expect(target).toBe(destination);
      expect(entry.application).toBeUndefined();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('reports a generic startup failure when the backup destination is missing', async () => {
    const entry = await runEntry(['backup']);
    await vi.waitFor(() => expect(mocks.logger.error).toHaveBeenCalled());
    expect(entry.exitCode).toBe(1);
    expect(entry.application).toBeUndefined();
    expect(mocks.logger.error).toHaveBeenCalledWith(
      'server:startup:failed',
      'Server configuration or authentication initialization failed',
    );
  });
});
