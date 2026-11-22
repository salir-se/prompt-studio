// @vitest-environment node
// @module-tag pure
import { request, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, expect, it } from 'vitest';
import { DEFAULT_MANIFEST } from '../src/manifest/default-manifest';
import { createHttpServer } from './app';
import type { ControlRoutes } from './control-routes';

let server: Server;
afterEach(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});
function get(path: string, headers: Record<string, string> = {}) {
  return new Promise<{ status: number; body: string }>((resolve, reject) => {
    const req = request(
      { hostname: '127.0.0.1', port: (server.address() as AddressInfo).port, path, headers },
      (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => {
          body += chunk;
        });
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body }));
      },
    );
    req.setTimeout(1000, () => req.destroy(new Error('Server did not answer')));
    req.on('error', reject);
    req.end();
  });
}
async function start(control?: ControlRoutes) {
  server = createHttpServer(
    {
      repoRoot: '/tmp',
      staticDir: '/tmp',
      host: '127.0.0.1',
      port: 0,
      allowedOrigins: ['http://localhost:5273'],
      verifyBudget: 20,
    },
    'test-token',
    { status: 'ok', source: 'app', manifest: DEFAULT_MANIFEST },
    control,
  );
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
}
it('rejects a malformed unauthenticated target and keeps the real HTTP server healthy', async () => {
  await start();
  expect((await get('//[')).status).toBe(400);
  expect(await get('/health')).toEqual({ status: 200, body: JSON.stringify({ ok: true }) });
  expect((await get('/__studio/github/status')).status).toBe(401);
  expect(
    (await get('/__studio/github/status', { origin: 'https://untrusted.example', 'x-studio-token': 'test-token' }))
      .status,
  ).toBe(403);
});

it('contains unexpected route rejections without leaking their details or stopping health requests', async () => {
  await start({
    handle: async () => {
      throw new Error('private-upstream-details');
    },
    dispose: async () => {},
  });
  expect(await get('/__control/command')).toEqual({
    status: 500,
    body: JSON.stringify({ ok: false, error: 'Internal error.' }),
  });
  expect((await get('/health')).status).toBe(200);
});
