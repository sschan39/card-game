import { afterEach, describe, expect, it } from 'vitest';
import express from 'express';
import type { Server } from 'node:http';
import { createDebugRouter, type InspectorIdentity } from '@server/projection/debug-channel';
import { createTestRoom } from '../helpers/test-room-factory';

const servers: Server[] = [];
afterEach(async () => { await Promise.all(servers.splice(0).map(server => new Promise<void>(resolve => server.close(() => resolve())))); });
async function inspect(enabled: boolean, identity?: InspectorIdentity | null, path = 'room') {
  const app = express(), room = createTestRoom({ roomId: 'room' });
  app.use('/api/debug', createDebugRouter({ enabled: () => enabled, findRoom: id => id === room.roomId ? room : undefined,
    ...(identity !== undefined ? { authorize: () => identity } : {}) }));
  const server = app.listen(0, '127.0.0.1'); servers.push(server);
  await new Promise<void>(resolve => server.once('listening', resolve));
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('Missing port');
  return fetch(`http://127.0.0.1:${address.port}/api/debug/room/${path}`);
}
describe('authoritative inspector boundary', () => {
  it('fails closed when no authenticator is installed', async () => { expect((await inspect(true)).status).toBe(401); });
  it('requires an inspection role', async () => { expect((await inspect(true, { accountId: 'a', roles: ['player'] })).status).toBe(403); });
  it.each(['admin', 'inspector'])('permits authenticated %s inspection', async role => {
    const response = await inspect(true, { accountId: 'a', roles: [role] });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ protocolVersion: 1, room: { roomId: 'room', continuousEffectPool: [] } });
  });
  it('requires debug enablement even with a role', async () => { expect((await inspect(false, { accountId: 'a', roles: ['admin'] })).status).toBe(404); });
  it('does not expose absent room state', async () => { expect((await inspect(true, { accountId: 'a', roles: ['admin'] }, 'missing')).status).toBe(404); });
});
