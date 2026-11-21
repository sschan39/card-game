import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { newScenario, ScenarioSchema, PlatformResponseSchema } from '@card-game/protocol';
import Scenarios from '@admin/pages/Scenarios';
import { AdminApi } from '@admin/api';
import { allowAdminRoute, setAdminRouteBlocker, resolveRoute } from '@admin/router';
import { BuilderTransfer, CardCountControls } from '@card-game/ui';
afterEach(() => { vi.unstubAllGlobals(); setAdminRouteBlocker(null); });
const platform = (enabled: boolean) => PlatformResponseSchema.parse({ protocolVersion: 1, navigation: { instanceId: 'ui-lab', purpose: 'lab', label: 'UI Lab', home: '/home', play: '/play', decks: '/deck-builder/', admin: '/admin/', lab: null, extraPages: [] }, capabilities: { scenarios: enabled } });
describe('scenario admin presentation and request boundaries', () => {
    it('shows a safe unavailable page without advertising an editor on disabled/live instances', () => {
        const api = new AdminApi(() => null, () => { });
        const html = renderToStaticMarkup(<Scenarios api={api} platform={platform(false)}/>);
        expect(html).toContain('Test Lab unavailable');
        expect(html).not.toContain('Save scenario');
        expect(resolveRoute('#scenarios')).toBe('scenarios');
        expect(resolveRoute('#test-rooms')).toBe('test-rooms');
    });
    it('renders supported setup/participant controls, safe draft recovery and separate test-room view', () => {
        const draft = { ...newScenario(), name: '<script>bad()</script>' };
        vi.stubGlobal('sessionStorage', { getItem: () => JSON.stringify({ scenario: draft }), setItem: () => { } });
        const api = new AdminApi(() => null, () => { }), html = renderToStaticMarkup(<Scenarios api={api} platform={platform(true)}/>);
        expect(html).toContain('Scenario Builder');
        expect(html).toContain('UI Lab');
        expect(html).toContain('Starting zone');
        expect(html).toContain('Gameplay seed');
        expect(html).toContain('assigned lab accounts');
        expect(html).toContain('Play both seats');
        expect(html).toContain('Start with an empty board');
        expect(html).not.toContain('<script>bad()');
        expect(html).toContain('&lt;script&gt;');
        expect(renderToStaticMarkup(<Scenarios api={api} platform={platform(true)} roomsOnly/>)).not.toContain('Save scenario');
    });
    it('guards unsaved route changes and bounds shared editor controls', () => {
        setAdminRouteBlocker(() => false);
        expect(allowAdminRoute()).toBe(false);
        setAdminRouteBlocker(null);
        expect(allowAdminRoute()).toBe(true);
        const html = renderToStaticMarkup(<CardCountControls label="fixture" quantity={0} canAdd={false} onChange={() => { }}/>);
        expect(html.match(/disabled/g)).toHaveLength(2);
        expect(renderToStaticMarkup(<BuilderTransfer text="" onText={() => { }} onImport={() => { }} onExport={() => { }}/>)).toContain('maxLength="65536"');
    });
    it('preserves server errors and cancellation signals for admin writes without sending credentials elsewhere', async () => {
        const session = { protocolVersion: 1, sessionId: 'session', token: 'a'.repeat(43), expiresAt: Date.now() + 10000, scope: 'admin', playerId: 'actor', account: { id: 'id', username: 'operator', role: 'admin' } };
        const fetcher = vi.fn(async () => new Response(JSON.stringify({ protocolVersion: 1, message: 'Scenario changed. Reload before saving.' }), { status: 409 }));
        const api = new AdminApi(() => session as any, () => { }, fetcher);
        const controller = new AbortController();
        await expect(api.mutate('/api/admin/scenarios/example', 'PUT', { protocolVersion: 1 }, ScenarioSchema, controller.signal)).rejects.toThrow('Scenario changed');
        expect(fetcher.mock.calls[0][1]).toMatchObject({ signal: controller.signal, headers: { Authorization: 'Bearer ' + session.token } });
        await expect(api.mutate('https://other.example/', 'POST', {}, ScenarioSchema)).rejects.toThrow('Invalid administrator');
    });
});
