// @vitest-environment node
// @module-tag pure
import { mkdtemp, rm } from 'node:fs/promises';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { DEFAULT_MANIFEST } from '../src/manifest/default-manifest';
import { createHttpServer } from './app';
import { loopbackFetch } from './loopback-fetch';

let directory = '';
let server: Server;
afterEach(async () => {
  if (server) {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  if (directory) await rm(directory, { recursive: true, force: true });
});
async function start() {
  const config = {
    repoRoot: directory,
    staticDir: directory,
    host: '127.0.0.1',
    port: 0,
    allowedOrigins: [],
    verifyBudget: 20,
    promptRepoDir: path.join(directory, 'workspace'),
  };
  server = createHttpServer(config, 'token', { status: 'ok', source: 'app', manifest: DEFAULT_MANIFEST });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
}
async function send(suffix: string, body?: unknown) {
  const response = await loopbackFetch(
    `http://127.0.0.1:${(server.address() as AddressInfo).port}/__studio/${suffix}`,
    {
      method: body === undefined ? 'GET' : 'POST',
      headers: { 'x-studio-token': 'token' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    },
  );
  return { status: response.status, body: await response.json() };
}
async function setup() {
  directory = await mkdtemp(path.join(tmpdir(), 'studio-project-tags-'));
  await start();
  const created = await send('prompt-repo/new', { name: 'Tagged versions' });
  const saved = await send('prompt-repo/draft', {
    projectId: created.body.projectId,
    revision: created.body.revision,
    documents: [{ path: 'prompts/test.md', text: 'First saved draft' }],
  });
  expect(saved.status).toBe(200);
  return { projectId: saved.body.projectId as string, revision: saved.body.revision as number };
}

it('commits saved prompt edits to a real Git tag and recovers immutable comparison versions after restart', async () => {
  const identity = await setup();
  const tagged = await send('prompt-repo/tags', { ...identity, name: 'v1' });
  expect(tagged.status).toBe(200);
  expect(tagged.body).toMatchObject({ ...identity, tag: 'v1', commit: expect.stringMatching(/^[a-f0-9]{40}$/) });
  const saved = await send('prompt-repo/draft', {
    ...identity,
    documents: [{ path: 'prompts/test.md', text: 'Second saved draft' }],
  });
  expect(saved.status).toBe(200);
  const secondIdentity = { projectId: saved.body.projectId, revision: saved.body.revision };
  expect((await send('prompt-repo/tags', { ...secondIdentity, name: 'v2' })).status).toBe(200);
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await start();
  const versions = await send(`run/versions?projectId=${identity.projectId}&promptPath=prompts/test.md`);
  expect(versions.status).toBe(200);
  expect(versions.body.versions).toEqual([
    { id: 'tag:v1', label: 'v1', source: 'First saved draft', commit: tagged.body.commit },
    { id: 'tag:v2', label: 'v2', source: 'Second saved draft', commit: expect.any(String) },
  ]);
  expect((await send('prompt-repo')).body.documents[0].text).toBe('Second saved draft');
});

it('rejects duplicate, stale, malformed and unsupported tag requests without losing drafts or moving the existing tag', async () => {
  const identity = await setup();
  const first = await send('prompt-repo/tags', { ...identity, name: 'v1' });
  expect(first.status).toBe(200);
  const saved = await send('prompt-repo/draft', {
    ...identity,
    documents: [{ path: 'prompts/test.md', text: 'Uncommitted newer draft' }],
  });
  const current = { projectId: identity.projectId, revision: saved.body.revision };
  expect((await send('prompt-repo/tags', { ...current, name: 'v1' })).status).toBe(400);
  expect((await send('prompt-repo/tags', { ...identity, name: 'stale' })).status).toBe(409);
  for (const name of [
    '../escape',
    'a..b',
    'a.lock/child',
    'bad name',
    'refs/heads/unsafe',
    'trailing/',
    'bad@{tag',
    '',
  ]) {
    expect((await send('prompt-repo/tags', { ...current, name })).status, name).toBe(400);
  }
  expect((await send('prompt-repo/tags', { ...current, name: 'unexpected', force: true })).status).toBe(400);
  const versions = await send(`run/versions?projectId=${identity.projectId}&promptPath=prompts/test.md`);
  expect(versions.body.versions).toEqual([
    { id: 'tag:v1', label: 'v1', source: 'First saved draft', commit: first.body.commit },
  ]);
  expect((await send('prompt-repo')).body.documents[0].text).toBe('Uncommitted newer draft');
});
