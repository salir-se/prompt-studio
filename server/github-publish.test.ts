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
import { afterEach, describe, expect, it } from 'vitest';
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

describe('GitHub publication', () => {
  it('clones HTTPS via the real Git protocol, pushes once, and retries PR creation without duplicate commits', async () => {
    directory = await mkdtemp(path.join(tmpdir(), 'studio-github-'));
    const source = path.join(directory, 'source');
    const bare = path.join(directory, 'remote.git');
    await mkdir(path.join(source, 'prompts'), { recursive: true });
    await git.init({ fs, dir: source, defaultBranch: 'main' });
    await writeFile(path.join(source, 'prompts/hello.md'), 'Original');
    await writeFile(path.join(source, 'unrelated.bin'), Buffer.from([0, 255, 128]));
    for (const filepath of ['prompts/hello.md', 'unrelated.bin']) await git.add({ fs, dir: source, filepath });
    await git.commit({ fs, dir: source, message: 'Initial', author: { name: 'Test', email: 'test@example.com' } });
    command(['clone', '--bare', source, bare]);
    let pushes = 0;
    const transport: git.HttpClient = {
      async request(request) {
        const url = new URL(request.url);
        expect(url.origin).toBe('https://github.com');
        const advertise = url.pathname.endsWith('/info/refs');
        const service = advertise ? url.searchParams.get('service')! : path.basename(url.pathname);
        const input: Buffer[] = [];
        if (request.body) for await (const part of request.body) input.push(Buffer.from(part));
        if (!advertise && service === 'git-receive-pack') pushes++;
        const result = command(
          [service.replace('git-', ''), '--stateless-rpc', ...(advertise ? ['--advertise-refs'] : []), bare],
          Buffer.concat(input),
        );
        const body = advertise
          ? Buffer.concat([packet(`# service=${service}\n`), Buffer.from('0000'), result])
          : result;
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
    const repository = await MemoryRepository.clone(
      'https://github.com/team/prompts.git',
      'secret-token',
      undefined,
      transport,
    );
    await repository.patch([{ path: 'prompts/hello.md', text: 'Edited' }]);
    const store = new RepositoryStore(path.join(directory, 'recovery'));
    await store.adopt(repository);
    let attempts = 0;
    const api = async (url: string | URL | Request, init?: RequestInit) => {
      const target = new URL(String(url));
      expect(target.origin).toBe('https://api.github.com');
      if (target.pathname.endsWith('/git/ref/heads/race-edit')) {
        command(['--git-dir', bare, 'update-ref', 'refs/heads/race-edit', 'refs/heads/main']);
        return new Response('{}', { status: 404 });
      }
      if (target.pathname.includes('/git/ref/')) {
        const ref = spawnSync('git', [
          '--git-dir',
          bare,
          'rev-parse',
          `refs/heads/${target.pathname.split('/git/ref/heads/')[1]}`,
        ]);
        return new Response(JSON.stringify(ref.status === 0 ? { object: { sha: ref.stdout.toString().trim() } } : {}), {
          status: ref.status === 0 ? 200 : 404,
        });
      }
      if (init?.method === 'POST') {
        attempts++;
        return new Response(JSON.stringify({ html_url: 'https://github.com/team/prompts/pull/7' }), {
          status: attempts === 1 ? 503 : 201,
        });
      }
      return new Response('[]');
    };
    const handler = createPromptRepoHandler({
      runtime: {
        repoRoot: directory,
        resolvedManifest: { status: 'ok', manifest: DEFAULT_MANIFEST, source: 'app' },
        checkout: null,
        repoName: null,
      },
      workspaceDir: path.join(directory, 'recovery'),
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
    const publish = async (branch = 'studio-edit') =>
      loopbackFetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/__studio/prompt-repo/publish`, {
        method: 'POST',
        headers: { 'x-studio-token': 'local-token', 'content-type': 'application/json' },
        body: JSON.stringify({
          projectId: repository.projectId,
          revision: repository.revision,
          branch,
          title: 'Improve prompts',
        }),
      });
    const failed = await publish();
    expect(failed.status).toBe(400);
    expect(await failed.text()).toContain('Retry');
    const recovered = new RepositoryStore(path.join(directory, 'recovery'));
    await recovered.load();
    expect(recovered.active?.publication?.pushed).toBe(true);
    // The source may advance while the published branch waits for a PR retry.
    const originalBase = command(['--git-dir', bare, 'rev-parse', 'main']).toString().trim();
    const baseTree = command(['--git-dir', bare, 'rev-parse', 'main^{tree}']).toString().trim();
    const advancedBase = command(
      [
        '-c',
        'user.name=Test',
        '-c',
        'user.email=test@example.com',
        '--git-dir',
        bare,
        'commit-tree',
        baseTree,
        '-p',
        originalBase,
      ],
      Buffer.from('Unrelated source advancement\n'),
    )
      .toString()
      .trim();
    command(['--git-dir', bare, 'update-ref', 'refs/heads/main', advancedBase]);
    const response = await publish();
    expect(response.status).toBe(200);
    const result = (await response.json()) as { url: string; commit: string };
    expect(result.url).toBe('https://github.com/team/prompts/pull/7');
    expect(pushes).toBe(1);
    command(['--git-dir', bare, 'update-ref', 'refs/heads/studio-edit', originalBase]);
    const changedTarget = await publish();
    expect(changedTarget.status).toBe(400);
    expect(await changedTarget.text()).toContain('branch already exists or changed remotely');
    command(['--git-dir', bare, 'update-ref', '-d', 'refs/heads/studio-edit']);
    const missingTarget = await publish();
    expect(missingTarget.status).toBe(400);
    expect(await missingTarget.text()).toContain('published branch was removed');
    expect(pushes).toBe(1);
    command(['--git-dir', bare, 'update-ref', 'refs/heads/studio-edit', result.commit]);
    expect(command(['--git-dir', bare, 'show', 'studio-edit:prompts/hello.md']).toString()).toBe('Edited');
    expect(command(['--git-dir', bare, 'show', 'studio-edit:unrelated.bin'])).toEqual(Buffer.from([0, 255, 128]));
    expect(command(['--git-dir', bare, 'show', 'main:prompts/hello.md']).toString()).toBe('Original');
    command(['--git-dir', bare, 'update-ref', 'refs/heads/main', originalBase]);
    const race = await publish('race-edit');
    expect(race.status).toBe(400);
    expect(await race.text()).toContain('branch was created remotely');
    expect(command(['--git-dir', bare, 'rev-parse', 'refs/heads/race-edit']).toString()).toBe(
      command(['--git-dir', bare, 'rev-parse', 'refs/heads/main']).toString(),
    );
    expect(pushes).toBe(1);
    command(['--git-dir', bare, 'update-ref', 'refs/heads/main', result.commit]);
    const diverged = await publish('another-edit');
    expect(diverged.status).toBe(400);
    expect(await diverged.text()).toContain('source branch changed remotely');
    expect(pushes).toBe(1);
  });
});
