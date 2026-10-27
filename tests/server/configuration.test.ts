import { afterEach, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadServerConfig, mergeConfig, configRevision } from '@server/config';
import { gameConfig, triggerTestSetup, st01aTestSetup, workbookTestSetup, smallMechanicsTestSetup } from '@config';
import cards from '@library/cards';
import baseline from '../fixtures/config-baseline.json';
import { getBlueprint } from '@library/card-catalog';
import { createRoom } from '@engine/room-factory';
import { createGameApplication } from '@server/application';

const directories: string[] = [];
afterEach(() => directories.splice(0).forEach(path => rmSync(path, { recursive: true, force: true })));
function hash(value: unknown): string {
  const json = JSON.stringify(value, (_key, child) => child && typeof child === 'object' && !Array.isArray(child) ? Object.fromEntries(Object.entries(child).sort(([a],[b]) => a.localeCompare(b))) : child);
  return createHash('sha256').update(json).digest('hex');
}
describe('configuration ownership and preserved content', () => {
  it('preserves all authored definitions and every pre-extraction preset exactly', () => {
    expect(Object.keys(cards)).toHaveLength(baseline.cardCount); expect(hash(cards)).toBe(baseline.catalogHash);
    const presets = { gameConfig: gameConfig.setup, triggerTestSetup, st01aTestSetup, workbookTestSetup, smallMechanicsTestSetup };
    for (const [name, setup] of Object.entries(presets)) expect(hash(setup)).toBe(baseline.presets[name as keyof typeof baseline.presets]);
    for (const [id, card] of Object.entries(cards)) { expect((card as { id: string }).id).toBe(id); expect(getBlueprint(id).id).toBe(id); }
  });
  it('separates production defaults from local features and freezes effective values', () => {
    const development = loadServerConfig({}), production = loadServerConfig({ NODE_ENV: 'production' });
    expect(development.origins).toHaveLength(3); expect(production.origins).toEqual([]);
    expect(production.fixturesEnabled).toBe(false); expect(production.inspectionEnabled).toBe(false); expect(production.debugMode).toBe('off');
    expect(Object.isFrozen(production.auth.password)).toBe(true); expect(Object.isFrozen(production.origins)).toBe(true);
    expect(configRevision(loadServerConfig({}))).toBe(configRevision(development));
  });
  it('merges objects, replaces arrays and applies environment overrides last', () => {
    const config = loadServerConfig({ ALLOWED_ORIGINS: 'https://admin.example', PORT: '3333' }, { origins: ['https://old.example'], http: { pageSize: 40 }, auth: { maxSessions: 200 } });
    expect(config.origins).toEqual(['https://admin.example']); expect(config.http).toMatchObject({ port: 3333, pageSize: 40, bodyLimitBytes: 8192 }); expect(config.auth.maxSessions).toBe(200);
    expect(mergeConfig({ rows: [1, 2] }, { rows: [3] })).toEqual({ rows: [3] });
    expect(() => mergeConfig({}, JSON.parse('{"__proto__":{"polluted":true}}'))).toThrow('configuration key');
    expect(({} as { polluted?: boolean }).polluted).toBeUndefined();
  });
  it('reads bounded operator overrides while errors omit values and secret material', () => {
    const directory = mkdtempSync(join(tmpdir(), 'card-game-config-')); directories.push(directory);
    const filename = join(directory, 'settings.json'); writeFileSync(filename, JSON.stringify({ storage: { maxDecksPerAccount: 20 } }));
    expect(loadServerConfig({ CONFIG_FILE: filename }).storage.maxDecksPerAccount).toBe(20);
    writeFileSync(filename, JSON.stringify({ password: 'do-not-print-this-credential' }));
    try { loadServerConfig({ CONFIG_FILE: filename }); throw new Error('Expected invalid configuration'); } catch (error) { expect(String(error)).toContain('Invalid configuration'); expect(String(error)).not.toContain('do-not-print'); }
    writeFileSync(filename, ' '.repeat(65537)); expect(() => loadServerConfig({ CONFIG_FILE: filename })).toThrow('CONFIG_FILE');
  });
  it.each([
    [{ NODE_ENV: 'unknown' }, undefined], [{ INSPECTOR_ENABLED: 'yes-secret' }, undefined], [{ ALLOWED_ORIGINS: '*' }, undefined],
    [{ PORT: '' }, { http: { bodyLimitBytes: 0 } }], [{}, { profile: 'production' }], [{}, { auth: { password: { memoryCost: 1 } } }],
    [{}, { auth: { adminSessionTtlMs: 3600001 } }], [{}, { logging: { scanBytes: 1024 } }],
  ])('fails closed for invalid settings %#', (environment, override) => { expect(() => loadServerConfig(environment, override)).toThrow('Invalid configuration'); });
  it('snapshots gameplay rules and selected deck arrays without changing live rooms', () => {
    const setup = structuredClone(gameConfig.setup), settings = { setup, debugMode: 'off' as const }, selected = Array(60).fill('land-red');
    const room = createRoom('configured', 'player', selected, settings);
    setup.startingLife = 99; selected[0] = 'empire-servant';
    expect(room.players.player.life).toBe(20); expect(room.setup!.startingLife).toBe(20); expect(room.setup!.playerDecks!.player[0]).toBe('land-red'); expect(room.debugMode).toBe('off');
  });
  it('uses the single startup configuration without rereading an operator file', async () => {
    const config = loadServerConfig({ DELTA_LOG_PATH: '' }), app = createGameApplication({ effectiveConfig: config, environment: { CONFIG_FILE: 'does-not-exist' } });
    try { await app.ready; expect(app.config).toBe(config); await new Promise<void>(resolve => app.server.listen(0, '127.0.0.1', resolve)); }
    finally { await new Promise<void>(resolve => app.io.close(() => resolve())); }
  });
});
