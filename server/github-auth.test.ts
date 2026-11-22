// @vitest-environment node
// @module-tag integration
import { createServer, request as httpRequest, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createGithubAuth } from './github-auth';
import { untilDone } from './test-support/until-done';

const device = {
  device_code: 'private-device-code',
  user_code: 'ABCD-EFGH',
  verification_uri: 'https://github.com/login/device',
  expires_in: 900,
  interval: 5,
};
const token = {
  access_token: 'ghu_private_token',
  token_type: 'bearer',
  expires_in: 28_800,
  refresh_token: 'ghr_private_refresh',
};
const servers: Server[] = [];
afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => {
          server.closeAllConnections();
          server.close(() => resolve());
        }),
    ),
  );
});

async function setup(responses: unknown[], clientId: string | undefined = 'Iv1.public') {
  let time = 1_000_000;
  const upstream = vi.fn(async (_url: Parameters<typeof fetch>[0], _init?: RequestInit) => {
    const next = responses.shift();
    if (next instanceof Error) throw next;
    return Response.json(await next);
  });
  const auth = createGithubAuth({ clientId, fetch: upstream as typeof fetch, now: () => time });
  const server = createServer((req, res) => {
    void auth.handle(req, res, 'studio-token', ['http://localhost']).then((handled) => {
      if (!handled) {
        res.statusCode = 404;
        res.end();
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  servers.push(server);
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return {
    auth,
    upstream,
    advance: (ms: number) => {
      time += ms;
    },
    request: async (route: string, body?: unknown, headers: Record<string, string> = {}) => {
      return new Promise<{ status: number; body: Record<string, unknown> }>((resolve, reject) => {
        const req = httpRequest(
          `${base}/__studio/github/${route}`,
          {
            method: route === 'status' ? 'GET' : 'POST',
            headers: { origin: 'http://localhost', 'x-studio-token': 'studio-token', ...headers },
          },
          (res) => {
            let content = '';
            res.on('data', (chunk) => {
              content += chunk;
            });
            res.on('end', () => resolve({ status: res.statusCode ?? 0, body: JSON.parse(content) }));
            res.on('error', reject);
          },
        );
        req.on('error', reject);
        req.end(route !== 'status' ? (typeof body === 'string' ? body : JSON.stringify(body ?? {})) : undefined);
      });
    },
  };
}

describe('GitHub device authentication HTTP outcome', () => {
  it('connects through the official device endpoints while keeping all secrets server-only, then expires', async () => {
    const h = await setup([device, { error: 'authorization_pending' }, token, { login: 'octocat' }]);
    expect((await h.request('status')).body).toEqual({ ok: true, configured: true, connected: false });
    const start = await h.request('device');
    expect(start.body).toEqual({
      ok: true,
      userCode: 'ABCD-EFGH',
      verificationUri: device.verification_uri,
      expiresAt: 1_900_000,
      interval: 5,
    });
    expect((await h.request('poll')).body.status).toBe('pending');
    expect(h.upstream).toHaveBeenCalledTimes(1);
    h.advance(5000);
    expect((await h.request('poll')).body.status).toBe('pending');
    h.advance(5000);
    expect((await h.request('poll')).body).toEqual({ ok: true, status: 'connected', login: 'octocat' });
    expect(h.auth.getToken()).toBe(token.access_token);
    const status = await h.request('status');
    expect(status.body).toEqual({ ok: true, configured: true, connected: true, login: 'octocat' });
    expect(JSON.stringify([start, status])).not.toMatch(/private/);
    expect(h.upstream.mock.calls.map(([url]) => url)).toEqual([
      'https://github.com/login/device/code',
      'https://github.com/login/oauth/access_token',
      'https://github.com/login/oauth/access_token',
      'https://api.github.com/user',
    ]);
    for (const [, init] of h.upstream.mock.calls) {
      expect(init?.redirect).toBe('error');
      expect(init?.signal).toBeInstanceOf(AbortSignal);
    }
    expect(String(h.upstream.mock.calls[0]?.[1]?.body)).toBe('client_id=Iv1.public');
    const grant = h.upstream.mock.calls[1]?.[1]?.body as URLSearchParams;
    expect(Object.fromEntries(grant)).toEqual({
      client_id: 'Iv1.public',
      device_code: device.device_code,
      grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
    });
    expect(h.upstream.mock.calls[3]?.[1]?.headers).toMatchObject({ Authorization: `Bearer ${token.access_token}` });
    h.advance(28_800_000);
    expect(h.auth.getToken()).toBeUndefined();
    expect((await h.request('status')).body.connected).toBe(false);
  });

  it('enforces slow_down and only allows one outstanding poll', async () => {
    let complete: (value: unknown) => void = () => {};
    const delayed = new Promise((resolve) => {
      complete = resolve;
    });
    const h = await setup([device, delayed, { error: 'authorization_pending' }]);
    await h.request('device');
    h.advance(5000);
    const first = h.request('poll');
    await untilDone(() => expect(h.upstream).toHaveBeenCalledTimes(2));
    h.advance(5000);
    expect((await h.request('poll')).body.status).toBe('pending');
    expect(h.upstream).toHaveBeenCalledTimes(2);
    complete({ error: 'slow_down', interval: 12 });
    expect((await first).body.interval).toBe(12);
    h.advance(11_999);
    expect((await h.request('poll')).body.interval).toBe(12);
    expect(h.upstream).toHaveBeenCalledTimes(2);
    h.advance(1);
    await h.request('poll');
    expect(h.upstream).toHaveBeenCalledTimes(3);
  });

  it.each(['device', 'poll', 'user'] as const)('disconnect invalidates an outstanding %s response', async (stage) => {
    let complete: (value: unknown) => void = () => {};
    const delayed = new Promise((resolve) => {
      complete = resolve;
    });
    const h = await setup(
      stage === 'device'
        ? [delayed]
        : stage === 'poll'
          ? [device, delayed, { login: 'octocat' }]
          : [device, token, delayed],
    );
    let pending: ReturnType<typeof h.request>;
    if (stage === 'device') pending = h.request('device');
    else {
      await h.request('device');
      h.advance(5000);
      pending = h.request('poll');
    }
    await untilDone(() => expect(h.upstream).toHaveBeenCalledTimes(stage === 'device' ? 1 : stage === 'poll' ? 2 : 3));
    await h.request('disconnect');
    complete(stage === 'device' ? device : stage === 'poll' ? token : { login: 'octocat' });
    await pending;
    expect(h.auth.getToken()).toBeUndefined();
    expect((await h.request('status')).body.connected).toBe(false);
  });

  it('a new connection attempt supersedes an old device response', async () => {
    let complete: (value: unknown) => void = () => {};
    const h = await setup([
      new Promise((resolve) => {
        complete = resolve;
      }),
      device,
    ]);
    const old = h.request('device');
    await untilDone(() => expect(h.upstream).toHaveBeenCalledTimes(1));
    expect((await h.request('device')).status).toBe(200);
    complete({ ...device, user_code: 'OLDX-CODE' });
    expect((await old).status).toBe(409);
    expect(h.auth.getToken()).toBeUndefined();
  });

  it.each([[{ ...token, token_type: 'invalid' }], [token, { login: 'invalid login with ghu_private_token' }]])(
    'rejects malformed token or identity without leaking upstream fields',
    async (...responses) => {
      const h = await setup([device, ...responses]);
      await h.request('device');
      h.advance(5000);
      const result = await h.request('poll');
      expect(result.status).toBe(502);
      expect(JSON.stringify(result)).not.toContain('private');
      expect(h.auth.getToken()).toBeUndefined();
    },
  );

  it.each(['expired_token', 'access_denied'])('clears the device code on %s', async (error) => {
    const h = await setup([device, { error }]);
    await h.request('device');
    h.advance(5000);
    expect((await h.request('poll')).body.status).toBe(error === 'access_denied' ? 'denied' : 'expired');
    expect((await h.request('poll')).body.status).toBe('expired');
    expect(h.upstream).toHaveBeenCalledTimes(2);
  });

  it('expires the device locally and never sends an expired grant', async () => {
    const h = await setup([device]);
    await h.request('device');
    h.advance(900_000);
    expect((await h.request('poll')).body.status).toBe('expired');
    expect(h.upstream).toHaveBeenCalledTimes(1);
  });

  it('accepts only a public client ID and gates every route before contacting GitHub', async () => {
    const h = await setup([device]);
    const unconfigured = await setup([device], '');
    expect((await unconfigured.request('device')).status).toBe(409);
    expect((await unconfigured.request('device', { clientId: 'Iv1.public' })).status).toBe(200);
    expect((await h.request('device', { token: 'private-token' })).status).toBe(400);
    expect((await h.request('device', '{')).status).toBe(400);
    expect((await h.request('device', { clientId: 'x'.repeat(1500) })).status).toBe(400);
    expect((await h.request('disconnect', { force: true })).status).toBe(400);
    for (const route of ['device', 'poll', 'disconnect', 'status']) {
      expect((await h.request(route, {}, { origin: 'https://evil.example' })).status).toBe(403);
      expect((await h.request(route, {}, { 'x-studio-token': 'wrong' })).status).toBe(401);
    }
    expect(h.upstream).not.toHaveBeenCalled();
  });

  it.each([
    new Error('ghu_private_token private-device-code'),
    { ...device, verification_uri: 'https://evil.example' },
    { ...device, interval: 0 },
  ])('redacts upstream failures and rejects malformed device responses', async (response) => {
    const h = await setup([response]);
    const result = await h.request('device');
    expect(result.status).toBe(502);
    expect(JSON.stringify(result)).not.toMatch(/private|evil/);
    expect(h.auth.getToken()).toBeUndefined();
  });
});
