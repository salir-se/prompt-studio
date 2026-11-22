// @vitest-environment node
// @module-tag pure
/**
 * Outcome test (testing-strategy.md "Outcome tests"): a person opens their own prompt
 * repository, edits more than one prompt, restores an earlier version of one of them,
 * and sends the result to a branch.
 *
 * Real entrypoint: the studio HTTP server (`createHttpServer`) and git on a local
 * checkout. The file URL stands in for GitHub. Nothing here asserts a skip or a no-op.
 */
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { STUDIO_TOKEN_HEADER } from '../src/bridge/fs-bridge';
import { DEFAULT_MANIFEST } from '../src/manifest/default-manifest';
import type { ResolvedManifest } from '../src/manifest/resolve-manifest';
import { createHttpServer } from './app';
import type { StudioServerConfig } from './config';
import { loopbackFetch as fetch } from './loopback-fetch';

const execFileAsync = promisify(execFile);
const TOKEN = 'test-boot-token';
const GITHUB_TOKEN = 'ghp-should-never-appear-in-a-response';
const GIT = ['-c', 'user.name=Prompt Studio', '-c', 'user.email=studio@salir.local', '--no-pager'] as const;

let root: string;
let server: Server;
let baseUrl: string;

async function git(args: string[], cwd?: string): Promise<string> {
  const { stdout } = await execFileAsync('git', [...GIT, ...args], { cwd });
  return String(stdout);
}

async function startServer(): Promise<void> {
  const config: StudioServerConfig = {
    repoRoot: root,
    staticDir: root,
    host: '127.0.0.1',
    port: 0,
    allowedOrigins: ['http://127.0.0.1:5273'],
    verifyBudget: 20,
    promptRepoDir: path.join(root, 'workspace'),
  };
  const resolved: ResolvedManifest = { status: 'ok', manifest: DEFAULT_MANIFEST, source: 'app' };
  server = createHttpServer(config, TOKEN, resolved);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

async function studio(pathname: string, init: { method?: string; body?: string } = {}) {
  return fetch(`${baseUrl}${pathname}`, {
    method: init.method,
    body: init.body,
    headers: { [STUDIO_TOKEN_HEADER]: TOKEN },
  });
}

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'prompt-studio-outcome-'));
  await mkdir(path.join(root, 'static'), { recursive: true });
  await writeFile(path.join(root, 'static', 'index.html'), '<!doctype html><title>Studio</title>');
  await startServer();
});

afterEach(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await rm(root, { recursive: true, force: true });
});

describe('prompt repository outcome', () => {
  it('opens, edits and recovers a graph-referenced project asset through authenticated HTTP', async () => {
    const imported = await studio('/__studio/prompt-repo/import', {
      method: 'POST',
      body: JSON.stringify({
        format: 'prompt-studio-project-files@1',
        name: 'References',
        files: [
          { path: 'prompts/task.md', base64: Buffer.from('# Task\nRead @docs/rules.md').toString('base64') },
          { path: 'docs/rules.md', base64: Buffer.from('Original rules').toString('base64') },
          { path: 'image.bin', base64: Buffer.from([0, 255, 7]).toString('base64') },
        ],
      }),
    });
    expect(imported.status).toBe(200);
    const project = (await imported.json()) as { projectId: string; revision: number; files: string[] };
    expect(project.files).toContain('docs/rules.md');
    const query = new URLSearchParams({
      projectId: project.projectId,
      revision: String(project.revision),
      path: 'docs/rules.md',
    });
    const opened = await studio(`/__studio/prompt-repo/file?${query}`);
    expect(opened.status).toBe(200);
    const file = (await opened.json()) as { hash: string };
    const saved = await studio('/__studio/prompt-repo/draft', {
      method: 'POST',
      body: JSON.stringify({
        projectId: project.projectId,
        revision: project.revision,
        files: [{ path: 'docs/rules.md', text: 'Revised rules', expectedHash: file.hash }],
      }),
    });
    expect(saved.status).toBe(200);
    const latest = (await saved.json()) as { projectId: string; revision: number };
    const stale = await studio('/__studio/prompt-repo/draft', {
      method: 'POST',
      body: JSON.stringify({
        projectId: latest.projectId,
        revision: latest.revision,
        files: [{ path: 'docs/rules.md', text: 'Stale overwrite', expectedHash: file.hash }],
      }),
    });
    expect(stale.status).toBe(409);
    expect(await stale.json()).toMatchObject({ error: expect.stringContaining('changed since') });
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await startServer();
    query.set('revision', String(latest.revision));
    expect(await (await studio(`/__studio/prompt-repo/file?${query}`)).json()).toMatchObject({ text: 'Revised rules' });
    query.set('path', '../outside');
    expect((await studio(`/__studio/prompt-repo/file?${query}`)).status).toBe(400);
    query.delete('path');
    const archive = (await (await studio(`/__studio/prompt-repo/export?${query}`)).json()) as {
      files: { path: string; base64: string }[];
    };
    expect(archive.files.find((entry) => entry.path === 'image.bin')?.base64).toBe(
      Buffer.from([0, 255, 7]).toString('base64'),
    );
  });
  it('recovers an accepted draft receipt and never acknowledges a rejected stale no-op draft', async () => {
    const created = await studio('/__studio/prompt-repo/new', {
      method: 'POST',
      body: JSON.stringify({ name: 'Receipts' }),
    });
    const initial = (await created.json()) as {
      projectId: string;
      revision: number;
      definitions: Record<string, unknown>;
    };
    const accepted = await studio('/__studio/prompt-repo/draft', {
      method: 'POST',
      body: JSON.stringify({
        projectId: initial.projectId,
        revision: initial.revision,
        mutationId: 'tab-b-definitions',
        definitions: {
          ...initial.definitions,
          tools: [{ name: 'search', description: 'Find facts', inputSchema: {} }],
        },
      }),
    });
    expect(accepted.status).toBe(200);
    const receipt = { mutationId: 'tab-b-definitions', revision: initial.revision + 1 };
    expect(await accepted.json()).toMatchObject({ lastDraft: receipt, revision: receipt.revision });
    const rejected = await studio('/__studio/prompt-repo/draft', {
      method: 'POST',
      body: JSON.stringify({
        projectId: initial.projectId,
        revision: initial.revision,
        mutationId: 'tab-a-no-op',
        documents: [],
      }),
    });
    expect(rejected.status).toBe(409);
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await startServer();
    expect(await (await studio('/__studio/prompt-repo')).json()).toMatchObject({
      lastDraft: receipt,
      revision: receipt.revision,
      definitions: { tools: [{ name: 'search' }] },
    });
  });
  it('creates and recovers durable drafts, rejects stale writes, and preserves binary project files', async () => {
    const created = await studio('/__studio/prompt-repo/new', {
      method: 'POST',
      body: JSON.stringify({ name: 'Fresh' }),
    });
    expect(created.status).toBe(200);
    const initial = (await created.json()) as { projectId: string; revision: number };
    const project = { projectId: initial.projectId, revision: initial.revision };
    const draft = await studio('/__studio/prompt-repo/draft', {
      method: 'POST',
      body: JSON.stringify({ ...project, documents: [{ path: 'prompts/hello.md', text: 'Hello' }] }),
    });
    expect(draft.status).toBe(200);
    const stale = await studio('/__studio/prompt-repo/draft', {
      method: 'POST',
      body: JSON.stringify({ ...project, documents: [{ path: 'prompts/hello.md', text: 'Lost update' }] }),
    });
    expect(stale.status).toBe(409);
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await startServer();
    const recovered = await studio('/__studio/prompt-repo');
    const state = (await recovered.json()) as { projectId: string; documents: { text: string }[] };
    expect(state.projectId).toBe(project.projectId);
    expect(state.documents[0]?.text).toBe('Hello');
  });
  it('edits and restores an isolated local copy without modifying the source repository', async () => {
    // Given: the person's repository already has two prompts on a local stand-in for GitHub
    const source = path.join(root, 'source');
    const bare = path.join(root, 'bare.git');
    await mkdir(path.join(source, 'prompts'), { recursive: true });
    await git(['init', '-b', 'main'], source);
    await writeFile(path.join(source, 'prompts', 'scout.md'), 'Hello from scout\n');
    await writeFile(path.join(source, 'prompts', 'closer.md'), 'Hello from closer\n');
    await git(['add', 'prompts'], source);
    await git(['commit', '-m', 'start'], source);
    await git(['clone', '--bare', source, bare]);

    // When: they open it, change both prompts, restore the earlier scout text, and send it
    const opened = await studio('/__studio/prompt-repo/open', {
      method: 'POST',
      body: JSON.stringify({ url: `file://${bare}`, token: GITHUB_TOKEN }),
    });
    const openedBody = (await opened.json()) as {
      ok: boolean;
      open: boolean;
      projectId: string;
      revision: number;
      error?: string;
      documents: { path: string; text: string }[];
    };
    const historyQuery = new URLSearchParams({
      projectId: openedBody.projectId,
      revision: String(openedBody.revision),
      path: 'prompts/scout.md',
    });
    const history = await studio(`/__studio/prompt-repo/history?${historyQuery}`);
    const versions = ((await history.json()) as { versions: { commit: string }[] }).versions;
    const earliest = versions[versions.length - 1]?.commit ?? '';
    const saved = await studio('/__studio/prompt-repo/save', {
      method: 'POST',
      body: JSON.stringify({
        message: 'Tighten both prompts',
        documents: [
          { path: 'prompts/scout.md', text: 'Scout, revised\n' },
          { path: 'prompts/closer.md', text: 'Closer, revised\n' },
        ],
      }),
    });
    const restored = await studio('/__studio/prompt-repo/restore', {
      method: 'POST',
      body: JSON.stringify({ path: 'prompts/scout.md', commit: earliest }),
    });
    const restoredBody = (await restored.json()) as { text: string };
    const pushed = await studio('/__studio/prompt-repo/push', { method: 'POST' });
    const pushedBody = await pushed.json();
    const served = await studio('/__studio/file?path=prompts/scout.md');
    const servedBody = (await served.json()) as { text: string };

    // Then: the branch has the restored scout prompt and the revised closer prompt
    expect(opened.status).toBe(200);
    expect(openedBody.open).toBe(true);
    expect(openedBody.documents.map((document) => document.text).sort()).toEqual([
      'Hello from closer\n',
      'Hello from scout\n',
    ]);
    expect(saved.status).toBe(200);
    expect(restored.status).toBe(200);
    expect(restoredBody.text).toBe('Hello from scout\n');
    expect(pushed.status).toBe(400);
    expect(pushedBody).toEqual({ ok: false, error: 'Use Publish to create a new branch and open a pull request.' });
    expect(await git(['--git-dir', bare, 'show', 'main:prompts/scout.md'])).toBe('Hello from scout\n');
    expect(await git(['--git-dir', bare, 'show', 'main:prompts/closer.md'])).toBe('Hello from closer\n');
    const latest = (await (await studio('/__studio/prompt-repo')).json()) as { projectId: string; revision: number };
    const identity = new URLSearchParams({ projectId: latest.projectId, revision: String(latest.revision) });
    const exported = (await (await studio(`/__studio/prompt-repo/export?${identity}`)).json()) as {
      files: { path: string; base64: string }[];
    };
    expect(
      Buffer.from(exported.files.find((file) => file.path === 'prompts/closer.md')?.base64 ?? '', 'base64').toString(),
    ).toBe('Closer, revised\n');
    expect(servedBody.text).toBe('Hello from scout\n');
    // And: the GitHub access code never comes back in a response
    expect(JSON.stringify({ openedBody, restoredBody, pushedBody, servedBody })).not.toContain(GITHUB_TOKEN);
  });
});
