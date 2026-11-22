// @vitest-environment node
// @module-tag pure
import { mkdtemp, rm } from 'node:fs/promises';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { DEFAULT_MANIFEST } from '../src/manifest/default-manifest';
import { projectCommand, studioJson } from '../src/prompt-repo/prompt-repo-client';
import { createHttpServer } from './app';
import { loopbackFetch } from './loopback-fetch';

let root: string;
let server: Server;
let origin: string;
let port = 0;
let token = 'first-boot';
let metaToken = token;
const requests: { pathname: string; init: RequestInit | undefined; status: number }[] = [];

async function boot() {
  const allowedOrigins: string[] = [];
  server = createHttpServer(
    {
      repoRoot: root,
      staticDir: root,
      promptRepoDir: path.join(root, 'projects'),
      host: '127.0.0.1',
      port,
      allowedOrigins,
      verifyBudget: 0,
    },
    token,
    { status: 'ok', manifest: DEFAULT_MANIFEST, source: 'app' },
  );
  await new Promise<void>((resolve) => server.listen(port, '127.0.0.1', resolve));
  port = (server.address() as AddressInfo).port;
  origin = `http://127.0.0.1:${port}`;
  allowedOrigins.push(origin, `http://localhost:${port}`);
}
async function restart() {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  token = 'second-boot';
  await boot();
  requests.length = 0;
}

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'studio-session-'));
  port = 0;
  token = metaToken = 'first-boot';
  requests.length = 0;
  vi.stubGlobal('document', {
    querySelector: () => ({
      getAttribute: () => metaToken,
      setAttribute: (_name: string, value: string) => {
        metaToken = value;
      },
    }),
  });
  await boot();
  vi.stubGlobal(
    'fetch',
    vi.fn(async (pathname: string, init?: RequestInit) => {
      // Browser POSTs supply their page's Origin; use real HTTP and persistent project storage.
      const response = await loopbackFetch(`${origin}${pathname}`, {
        method: init?.method,
        body: init?.body as string | undefined,
        headers: { origin, connection: 'close', ...Object.fromEntries(new Headers(init?.headers)) },
      });
      requests.push({ pathname, init, status: response.status });
      return new Response(await response.text(), { status: response.status });
    }),
  );
});
afterEach(async () => {
  vi.unstubAllGlobals();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await rm(root, { recursive: true, force: true });
});

it('#2518: an old client saves unchanged instructions after a server restart and reads back the source', async () => {
  // Given: an open client and a project persisted across a token-rotating restart.
  const project = await projectCommand('new', { name: 'Restart recovery' });
  const patch = {
    projectId: project.projectId,
    revision: project.revision,
    mutationId: 'same-save',
    documents: [{ path: 'prompts/task.md', text: '# Task\nKeep my unsaved instructions.\n' }],
  };
  await restart();
  // When: the old client saves without reloading or changing its project/revision/body.
  const saved = await projectCommand('draft', patch);
  // Then: only authentication is refreshed, and the identical save is retried once.
  expect(requests.map(({ pathname, status }) => [pathname, status])).toEqual([
    ['/__studio/prompt-repo/draft', 401],
    ['/__studio/session', 200],
    ['/__studio/prompt-repo/draft', 200],
  ]);
  expect(requests[0].init?.body).toBe(JSON.stringify(patch));
  expect(requests[2].init?.body).toBe(requests[0].init?.body);
  expect(requests[2].init?.method).toBe('POST');
  expect(new Headers(requests[0].init?.headers).get('x-studio-token')).toBe('first-boot');
  expect(new Headers(requests[2].init?.headers).get('x-studio-token')).toBe('second-boot');
  expect(metaToken).toBe('second-boot');
  expect(saved.projectId).toBe(project.projectId);
  expect(saved.revision).toBe(project.revision + 1);
  // And: a fresh server read returns the exact saved Markdown, with no draft loss.
  const readback = await studioJson<{ documents: unknown[] }>('/__studio/prompt-repo');
  expect(readback.documents).toEqual(expect.arrayContaining([expect.objectContaining(patch.documents[0])]));
});

it.each(['project', 'revision'] as const)('#2518: refresh preserves the %s conflict fence', async (conflict) => {
  // Given: the old editor's project identity or revision is no longer current.
  const project = await projectCommand('new', { name: 'Original' });
  if (conflict === 'project') await projectCommand('new', { name: 'Other' });
  else
    await projectCommand('draft', {
      projectId: project.projectId,
      revision: project.revision,
      documents: [{ path: 'prompts/task.md', text: 'Another editor' }],
    });
  await restart();
  // When: its unchanged stale save is retried with the current token.
  await expect(
    projectCommand('draft', {
      projectId: project.projectId,
      revision: project.revision,
      documents: [{ path: 'prompts/task.md', text: 'Must not overwrite' }],
    }),
  ).rejects.toThrow();
  // Then: the real route still rejects it, without another refresh or retry.
  expect(requests.map(({ status }) => status)).toEqual([401, 200, 409]);
  const latest = await studioJson('/__studio/prompt-repo');
  expect(JSON.stringify(latest)).not.toContain('Must not overwrite');
});

it('#2518: refresh exposes no token to missing, untrusted or cross-origin callers', async () => {
  // Given: both loopback names are allowed for saves, but refresh is same-origin only.
  for (const rejectedOrigin of [undefined, 'null', 'http://untrusted.example', `http://localhost:${port}`]) {
    // When: a caller without a matching trusted Origin asks for the per-boot token.
    const response = await loopbackFetch(`${origin}/__studio/session`, {
      method: 'POST',
      headers: rejectedOrigin ? { origin: rejectedOrigin } : {},
    });
    // Then: denial reveals no token and no CORS permission.
    expect(response.status).toBe(403);
    expect(await response.text()).not.toContain(token);
    expect(response.headers.get('access-control-allow-origin')).toBeNull();
  }
  // And: an untrusted save stays forbidden even with the current token.
  const denied = await loopbackFetch(`${origin}/__studio/prompt-repo/draft`, {
    method: 'POST',
    headers: { origin: 'http://untrusted.example', 'x-studio-token': token },
    body: '{}',
  });
  expect(denied.status).toBe(403);
});

it.each(['127.0.0.1', 'localhost'])(
  '#2518: the allowed local hostname %s can refresh without caching',
  async (host) => {
    // Given: a save-route allowlist includes both local browser hostnames.
    const response = await loopbackFetch(`${origin}/__studio/session`, {
      method: 'POST',
      headers: { origin: `http://${host}:${port}`, host: `${host}:${port}` },
    });
    // Then: only that same origin receives this boot's token, and intermediaries cannot cache it.
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, token });
    expect(response.headers.get('cache-control')).toBe('no-store');
  },
);
