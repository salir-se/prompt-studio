// @vitest-environment node
// @module-tag pure
import { mkdtemp, rm } from 'node:fs/promises';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { STUDIO_TOKEN_HEADER } from '../src/bridge/fs-bridge';
import { DEFAULT_MANIFEST } from '../src/manifest/default-manifest';
import { createHttpServer } from './app';
import { loopbackFetch } from './loopback-fetch';

let directory: string;
let server: Server;
let url: string;
async function request(suffix: string, body?: unknown) {
  return loopbackFetch(`${url}/__studio/prompt-repo${suffix}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { [STUDIO_TOKEN_HEADER]: 'export-test' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
beforeEach(async () => {
  directory = await mkdtemp(path.join(tmpdir(), 'studio-export-'));
  server = createHttpServer(
    {
      repoRoot: directory,
      staticDir: directory,
      host: '127.0.0.1',
      port: 0,
      allowedOrigins: [],
      verifyBudget: 20,
      promptRepoDir: directory,
    },
    'export-test',
    { status: 'ok', manifest: DEFAULT_MANIFEST, source: 'app' },
  );
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterEach(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await rm(directory, { recursive: true, force: true });
});

it('exports the requested saved revision and refuses a different tab’s active project', async () => {
  const first = await (await request('/new', { name: 'First project' })).json();
  const query = new URLSearchParams({ projectId: first.projectId, revision: String(first.revision) });
  const exported = await request(`/export?${query}`);
  expect(exported.status).toBe(200);
  expect(await exported.json()).toMatchObject({ ok: true, name: 'First project', files: expect.any(Array) });

  await request('/new', { name: 'Second project' });
  const wrongProject = await request(`/export?${query}`);
  expect(wrongProject.status).toBe(409);
  const body = await wrongProject.json();
  expect(body.ok).toBe(false);
  expect(body).not.toHaveProperty('files');
  expect(JSON.stringify(body)).not.toContain('Second project');
});

it('refuses an older revision of the same project', async () => {
  const first = await (await request('/new', { name: 'First project' })).json();
  const query = new URLSearchParams({ projectId: first.projectId, revision: String(first.revision) });
  const saved = await request('/draft', {
    projectId: first.projectId,
    revision: first.revision,
    documents: [{ path: 'prompts/first.md', text: 'Saved first project' }],
  });
  expect(saved.status).toBe(200);
  const current = await saved.json();
  const currentQuery = new URLSearchParams({ projectId: current.projectId, revision: String(current.revision) });
  const exported = await (await request(`/export?${currentQuery}`)).json();
  const prompt = exported.files.find((file: { path: string }) => file.path === 'prompts/first.md');
  expect(Buffer.from(prompt.base64, 'base64').toString()).toBe('Saved first project');
  expect((await request(`/export?${query}`)).status).toBe(409);
});

it.each(['', '?projectId=x', '?projectId=x&revision=', '?projectId=x&revision=NaN', '?projectId=x&revision=-1'])(
  'requires a complete valid export identity: %s',
  async (query) => {
    await request('/new', { name: 'Private project' });
    const response = await request(`/export${query}`);
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(await response.json()).not.toHaveProperty('files');
  },
);

it('fences history by selected project and revision after another editor switches projects', async () => {
  const first = await (await request('/new', { name: 'First history' })).json();
  const query = new URLSearchParams({ projectId: first.projectId, revision: String(first.revision) });
  expect((await request(`/history?${query}`)).status).toBe(200);
  expect((await request('/history')).status).toBe(400);
  await request('/save', { projectId: first.projectId, revision: first.revision, message: 'Next' });
  expect((await request(`/history?${query}`)).status).toBe(409);
  await request('/new', { name: 'Second history' });
  const response = await request(`/history?${query}`);
  expect(response.status).toBe(409);
  expect(await response.json()).not.toHaveProperty('versions');
});
