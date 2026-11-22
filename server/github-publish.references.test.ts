// @vitest-environment node
// @module-tag pure
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import * as git from 'isomorphic-git';
import { afterEach, expect, it } from 'vitest';
import { DEFAULT_MANIFEST } from '../src/manifest/default-manifest';
import { MemoryRepository, RepositoryStore } from '../src/prompt-repo/memory-repository';
import { loopbackFetch } from './loopback-fetch';
import { createPromptRepoHandler } from './prompt-repo-routes';

let directory: string;
let server: Server;
afterEach(async () => {
  if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
  if (directory) await rm(directory, { recursive: true, force: true });
});
function command(args: string[], input?: Buffer) {
  const result = spawnSync('git', args, { input, maxBuffer: 8 * 1024 * 1024 });
  if (result.status !== 0) throw new Error(result.stderr.toString());
  return result.stdout;
}
function packet(text: string) {
  return Buffer.from(`${(Buffer.byteLength(text) + 4).toString(16).padStart(4, '0')}${text}`);
}

it.each([false, true])('preserves supplied skill references on first publication (conflict=%s)', async (conflict) => {
  directory = await mkdtemp(path.join(tmpdir(), 'studio-publish-references-'));
  const source = path.join(directory, 'source');
  const bare = path.join(directory, 'remote.git');
  await mkdir(source);
  await git.init({ fs, dir: source, defaultBranch: 'main' });
  await writeFile(path.join(source, 'README.md'), 'Remote project');
  await git.add({ fs, dir: source, filepath: 'README.md' });
  if (conflict) {
    await mkdir(path.join(source, 'skills/summary/references'), { recursive: true });
    await writeFile(path.join(source, 'skills/summary/references/rules.md'), 'Remote rules');
    await git.add({ fs, dir: source, filepath: 'skills/summary/references/rules.md' });
  }
  await git.commit({ fs, dir: source, message: 'Initial', author: { name: 'Test', email: 'test@example.com' } });
  command(['clone', '--bare', source, bare]);
  const transport: git.HttpClient = {
    async request(request) {
      const url = new URL(request.url);
      expect(url.origin).toBe('https://github.com');
      const advertise = url.pathname.endsWith('/info/refs');
      const service = advertise ? url.searchParams.get('service')! : path.basename(url.pathname);
      const input: Buffer[] = [];
      if (request.body) for await (const part of request.body) input.push(Buffer.from(part));
      const result = command(
        [service.replace('git-', ''), '--stateless-rpc', ...(advertise ? ['--advertise-refs'] : []), bare],
        Buffer.concat(input),
      );
      const body = advertise ? Buffer.concat([packet(`# service=${service}\n`), Buffer.from('0000'), result]) : result;
      return {
        url: request.url,
        method: request.method,
        statusCode: 200,
        statusMessage: 'OK',
        headers: { 'content-type': `application/x-${service}-${advertise ? 'advertisement' : 'result'}` },
        body: (async function* () {
          yield body;
        })(),
      };
    },
  };
  const repository = new MemoryRepository('Adopted skill');
  await repository.initialize();
  const documents = [
    { path: 'skills/summary/SKILL.md', text: 'Read @references/rules.md and @scripts/check.py' },
    { path: 'skills/summary/references/rules.md', text: 'Preserve evidence.\r\n' },
    { path: 'skills/summary/scripts/check.py', text: 'print("check")\n' },
  ];
  await repository.patch(documents);
  const recovery = path.join(directory, 'recovery');
  await new RepositoryStore(recovery).adopt(repository);
  const baseSha = command(['--git-dir', bare, 'rev-parse', 'main']).toString().trim();
  const api = async (url: string | URL | Request, init?: RequestInit) => {
    const target = new URL(String(url));
    expect(target.origin).toBe('https://api.github.com');
    if (target.pathname.endsWith('/git/ref/heads/main'))
      return new Response(JSON.stringify({ object: { sha: baseSha } }));
    if (target.pathname.includes('/git/ref/')) return new Response('{}', { status: 404 });
    if (init?.method === 'POST')
      return new Response(JSON.stringify({ html_url: 'https://github.com/team/prompts/pull/8' }), { status: 201 });
    return new Response('[]');
  };
  const handler = createPromptRepoHandler({
    runtime: {
      repoRoot: directory,
      resolvedManifest: { status: 'ok', manifest: DEFAULT_MANIFEST, source: 'app' },
      checkout: null,
      repoName: null,
    },
    workspaceDir: recovery,
    studioToken: 'local-token',
    allowedOrigins: [],
    getToken: () => 'secret-token',
    http: transport,
    fetch: api as typeof fetch,
  });
  server = createServer((req, res) => {
    void handler(req, res);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const response = await loopbackFetch(
    `http://127.0.0.1:${(server.address() as AddressInfo).port}/__studio/prompt-repo/publish`,
    {
      method: 'POST',
      headers: { 'x-studio-token': 'local-token', 'content-type': 'application/json' },
      body: JSON.stringify({
        projectId: repository.projectId,
        revision: repository.revision,
        url: 'https://github.com/team/prompts.git',
        branch: 'studio-adopt',
        title: 'Adopt summary skill',
      }),
    },
  );
  const result = await response.text();
  if (conflict) {
    expect(response.status).toBe(400);
    expect(result).toContain('remote already contains different content at skills/summary/references/rules.md');
    expect(command(['--git-dir', bare, 'branch', '--list', 'studio-adopt']).toString()).toBe('');
    expect(command(['--git-dir', bare, 'show', 'main:skills/summary/references/rules.md']).toString()).toBe(
      'Remote rules',
    );
  } else {
    expect(response.status, result).toBe(200);
    const publishedFiles = command(['--git-dir', bare, 'ls-tree', '-r', '--name-only', 'studio-adopt'])
      .toString()
      .trim()
      .split('\n');
    for (const document of documents) {
      expect(publishedFiles).toContain(document.path);
      expect(command(['--git-dir', bare, 'show', `studio-adopt:${document.path}`]).toString()).toBe(document.text);
    }
    expect(command(['--git-dir', bare, 'show', 'studio-adopt:README.md']).toString()).toBe('Remote project');
  }
  const loaded = new RepositoryStore(recovery);
  await loaded.load();
  expect(await loaded.active!.read(documents[1].path)).toBe(documents[1].text);
});
