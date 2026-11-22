// @vitest-environment node
// @module-tag integration
/**
 * Outcome test: a person starts Prompt Studio on a new project that is not the Salir
 * checkout, designs a prompt with a tool, a variable, and a configuration, and saves
 * that design into the project's git repository. Opening the same folder again returns it.
 */
import { type ChildProcess, spawn } from 'node:child_process';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import * as git from 'isomorphic-git';
import { afterEach, describe, expect, it } from 'vitest';
import { RepositoryStore } from '../prompt-repo/memory-repository';
import { createWorkspacePrompt, readWorkspacePrompt } from '../prompt-repo/workspace-document';
import { installedPromptRepoDir } from './installed-studio';

const APP = path.resolve(import.meta.dirname, '../..');
const SALIR_PATHS = [
  'packages/prompts/src/scout.ts',
  'packages/prompts/src/researcher.ts',
  'packages/config/src/defaults.ts',
  'packages/skills/skills',
  'docs/prompts/generated/sales-mode-baselines.json',
  'docs/prompts/generated/studio-prompt-roots.json',
  'www/app.salir.se/src/lib/prompt-tools/compose-persona.ts',
  'apps/eval/src/judge.ts',
];

async function sourceFiles(root: string): Promise<Record<string, string>> {
  const files: Record<string, string> = {};
  async function visit(directory: string) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const filename = path.join(directory, entry.name);
      if (entry.isDirectory()) await visit(filename);
      else files[path.relative(root, filename)] = (await readFile(filename)).toString('base64');
    }
  }
  await visit(root);
  return files;
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address() as AddressInfo;
      probe.close(() => resolve(address.port));
    });
    probe.on('error', reject);
  });
}

function request(
  port: number,
  pathname: string,
  init: { method?: string; headers?: Record<string, string>; body?: string } = {},
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path: pathname,
        method: init.method ?? 'GET',
        headers: init.headers,
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on('data', (chunk: Buffer) => chunks.push(chunk));
        response.on('end', () =>
          resolve({ status: response.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8') }),
        );
      },
    );
    req.on('error', reject);
    if (init.body) req.write(init.body);
    req.end();
  });
}

async function startStudio(home: string): Promise<{ child: ChildProcess; port: number; output: () => string }> {
  const port = await freePort();
  const origin = `http://127.0.0.1:${port}`;
  const childEnv: NodeJS.ProcessEnv = {
    ...process.env,
    HOME: home,
    USERPROFILE: home,
    STUDIO_HOST: '127.0.0.1',
    STUDIO_PORT: String(port),
    STUDIO_ALLOWED_ORIGINS: origin,
  };
  delete childEnv.STUDIO_REPO_ROOT;
  delete childEnv.STUDIO_MANIFEST_PATH;
  const child = spawn('bun', ['src/release/main.ts'], { cwd: APP, env: childEnv, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  child.stdout?.on('data', (chunk: Buffer) => {
    output += chunk.toString('utf8');
  });
  child.stderr?.on('data', (chunk: Buffer) => {
    output += chunk.toString('utf8');
  });
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(output || 'studio did not start')), 20000);
    const poll = (): void => {
      void request(port, '/health')
        .then((response) => {
          if (response.status === 200) {
            clearTimeout(timer);
            resolve();
            return;
          }
          setTimeout(poll, 100);
        })
        .catch(() => setTimeout(poll, 100));
    };
    poll();
  });
  return { child, port, output: () => output };
}

async function stopStudio(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null) return;
  child.kill('SIGTERM');
  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      resolve();
    }, 3000);
    child.on('exit', () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

describe('a new project prompt repository', () => {
  const children: ChildProcess[] = [];
  let home: string;

  afterEach(async () => {
    await Promise.all(children.splice(0).map((child) => stopStudio(child)));
    if (home) await rm(home, { recursive: true, force: true });
  });

  it('saves a from-zero prompt, tool, variable, and configuration into git and reloads them', async () => {
    // Given: a computer whose home folder is not a Salir checkout
    home = await mkdtemp(path.join(tmpdir(), 'prompt-studio-project-'));
    const first = await startStudio(home);
    children.push(first.child);
    const origin = `http://127.0.0.1:${first.port}`;
    const token = (await readFile(path.join(tmpdir(), `prompt-studio-control-${first.port}.token`), 'utf8')).trim();
    const headers = { Origin: origin, 'x-studio-token': token, 'content-type': 'application/json' };
    const created = createWorkspacePrompt({
      id: 'account-research',
      title: 'Account Research',
      configuration: 'Outreach',
      tool: 'web_search',
      variable: 'company',
    });
    expect(created.design.tools).toEqual(['web_search']);
    expect(created.design.variables.map((variable) => variable.name)).toEqual(['company', 'configuration']);

    const repo = installedPromptRepoDir({ HOME: home });
    const originalFiles = await sourceFiles(repo);

    // When: the person saves that design through the studio's repository save
    const saved = await request(first.port, '/__studio/prompt-repo/save', {
      method: 'POST',
      headers,
      body: JSON.stringify({ message: 'create prompt account-research', documents: [created.document] }),
    });
    expect(saved.status).toBe(200);
    const store = new RepositoryStore(path.join(home, 'Salir Prompt Studio', 'repositories'));
    await store.load();
    expect(store.active).toBeDefined();
    const active = store.active!;
    const versions = await active.history();
    expect(versions[0].message).toBe('create prompt account-research');
    const { blob } = await git.readBlob({
      fs: active.fs,
      dir: '/repo',
      oid: versions[0].commit,
      filepath: created.document.path,
    });
    const committed = new TextDecoder().decode(blob);
    expect(committed).toBe(created.document.text);
    expect(await sourceFiles(repo)).toEqual(originalFiles);
    await stopStudio(first.child);

    // Then: the commit is the editor's design, and a second open reads that same design back
    expect(saved.status).toBe(200);
    const savedDesign = readWorkspacePrompt(committed);
    expect(savedDesign?.design.tools).toEqual(created.design.tools);
    expect(savedDesign?.design.variables).toEqual(created.design.variables);
    expect(savedDesign?.configuration).toBe('Outreach');
    expect(savedDesign?.text).toBe(created.text);
    for (const salirPath of SALIR_PATHS) expect(first.output()).not.toContain(salirPath);
    expect(first.output()).not.toContain(`${path.sep}repo${path.sep}`);

    const second = await startStudio(home);
    children.push(second.child);
    const tokenAgain = (
      await readFile(path.join(tmpdir(), `prompt-studio-control-${second.port}.token`), 'utf8')
    ).trim();
    const reloaded = await request(second.port, '/__studio/prompt-repo', {
      headers: { Origin: `http://127.0.0.1:${second.port}`, 'x-studio-token': tokenAgain },
    });
    const body = JSON.parse(reloaded.body) as { open: boolean; documents: { path: string; text: string }[] };
    expect(reloaded.status).toBe(200);
    expect(body.open).toBe(true);
    expect(await sourceFiles(repo)).toEqual(originalFiles);
    const reloadedText = body.documents.find((item) => item.path === 'prompts/account-research.md')?.text ?? '';
    expect(reloadedText).toBe(committed);
    const reloadedDesign = readWorkspacePrompt(reloadedText);
    expect(reloadedDesign?.design).toEqual(created.design);
    expect(reloadedDesign?.configuration).toBe(created.configuration);
    expect(reloadedDesign?.text).toBe(created.text);
    for (const salirPath of SALIR_PATHS) expect(second.output()).not.toContain(salirPath);
  }, 40000);
});
