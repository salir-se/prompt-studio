// @vitest-environment node
// @module-tag pure
/**
 * Outcome test (docs/testing.md): the installed `prompt-studio` command, spawned as a real
 * process, updates itself from a GitHub-Releases-shaped server. No stand-in is passed for the
 * download or the file replacement.
 */
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmod, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const APP = path.resolve(import.meta.dirname, '../..');
const ORIGINAL = Buffer.from('installed-prompt-studio');
const NEXT = Buffer.from('updated-prompt-studio');

let directory: string;
let server: Server | undefined;

afterEach(async () => {
  if (server) {
    await new Promise<void>((resolve) => server?.close(() => resolve()));
    server = undefined;
  }
  if (directory) await rm(directory, { recursive: true, force: true });
});

function listen(
  handler: (
    url: URL,
    headers: Record<string, string | string[] | undefined>,
  ) => { status: number; body: Buffer | string },
): Promise<string> {
  server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    const result = handler(url, req.headers);
    res.writeHead(result.status);
    res.end(result.body);
  });
  return new Promise((resolve) => {
    server?.listen(0, '127.0.0.1', () => {
      resolve(`http://127.0.0.1:${(server?.address() as AddressInfo).port}`);
    });
  });
}

async function run(args: string[], env: NodeJS.ProcessEnv): Promise<{ code: number; output: string }> {
  const child = spawn('bun', ['src/release/main.ts', ...args], {
    cwd: APP,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout?.on('data', (chunk: Buffer) => {
    output += chunk.toString('utf8');
  });
  child.stderr?.on('data', (chunk: Buffer) => {
    output += chunk.toString('utf8');
  });
  const code = await new Promise<number>((resolve) => child.on('close', (status) => resolve(status ?? 1)));
  return { code, output };
}

describe('installed prompt-studio command', () => {
  it('replaces the app with the latest release build and keeps it executable', async () => {
    // Given: an installed app and a release server that redirects latest.json like GitHub does
    directory = await mkdtemp(path.join(tmpdir(), 'prompt-studio-installed-'));
    const binaryPath = path.join(directory, 'prompt-studio');
    await writeFile(binaryPath, ORIGINAL);
    await chmod(binaryPath, 0o755);
    const sha256 = createHash('sha256').update(NEXT).digest('hex');
    const baseUrl = await listen((url) => {
      if (url.pathname === '/latest.json') {
        return {
          status: 200,
          body: JSON.stringify({
            version: '2.0.0',
            objects: { 'macos-arm64': { key: 'prompt-studio-macos-arm64', sha256 } },
          }),
        };
      }
      if (url.pathname === '/download/v2.0.0/prompt-studio-macos-arm64') return { status: 200, body: NEXT };
      return { status: 404, body: 'not found' };
    });
    const env = { ...process.env };
    env.PROMPT_STUDIO_BINARY_PATH = binaryPath;
    env.PROMPT_STUDIO_LATEST_URL = `${baseUrl}/latest.json`;
    env.PROMPT_STUDIO_DOWNLOAD_BASE_URL = `${baseUrl}/download`;
    env.PROMPT_STUDIO_PLATFORM = 'macos-arm64';

    // When: the person runs the installed update command
    const result = await run(['update'], env);

    // Then: the installed file is the new build and can still be run
    expect(result.code).toBe(0);
    expect(result.output).toContain('Prompt Studio is up to date.');
    expect(await readFile(binaryPath)).toEqual(NEXT);
    expect((await stat(binaryPath)).mode & 0o777).toBe(0o755);
  });
});
