// @vitest-environment node
// @module-tag pure
/**
 * Outcome test (docs/testing.md "Outcome tests"): `prompt-studio update` downloads the latest
 * GitHub Release build for this machine and replaces this program. A failed download or a
 * checksum mismatch leaves the installed bytes alone.
 *
 * Real entrypoint: `runCli`. The local HTTP server stands in for GitHub Releases, including the
 * redirect GitHub answers for `releases/latest/download/latest.json`.
 */
import { createHash } from 'node:crypto';
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { runCli } from './update';

const ORIGINAL = Buffer.from('installed-prompt-studio');
const NEXT = Buffer.from('updated-prompt-studio');

let directory: string;
let server: Server;
let baseUrl: string;
let mode: 'ok' | 'missing-asset' | 'wrong-checksum';
const requested: string[] = [];

async function listen(): Promise<void> {
  directory = await mkdtemp(path.join(tmpdir(), 'prompt-studio-update-'));
  requested.length = 0;
  server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    requested.push(url.pathname);
    if (url.pathname === '/releases/latest/download/latest.json') {
      res.writeHead(302, { location: '/releases/download/v1.2.3/latest.json' });
      res.end();
      return;
    }
    if (url.pathname === '/releases/download/v1.2.3/latest.json') {
      const checked = mode === 'wrong-checksum' ? Buffer.from('something else') : NEXT;
      const sha256 = createHash('sha256').update(checked).digest('hex');
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({ version: '1.2.3', objects: { 'macos-arm64': { key: 'prompt-studio-macos-arm64', sha256 } } }),
      );
      return;
    }
    if (url.pathname === '/releases/download/v1.2.3/prompt-studio-macos-arm64' && mode !== 'missing-asset') {
      res.writeHead(200);
      res.end(NEXT);
      return;
    }
    res.writeHead(404);
    res.end('not found');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

afterEach(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await rm(directory, { recursive: true, force: true });
});

async function installedBinary(): Promise<string> {
  const binaryPath = path.join(directory, 'prompt-studio');
  await writeFile(binaryPath, ORIGINAL);
  await chmod(binaryPath, 0o755);
  return binaryPath;
}

function updateEnv(binaryPath: string): NodeJS.ProcessEnv {
  return {
    PROMPT_STUDIO_BINARY_PATH: binaryPath,
    PROMPT_STUDIO_LATEST_URL: `${baseUrl}/releases/latest/download/latest.json`,
    PROMPT_STUDIO_DOWNLOAD_BASE_URL: `${baseUrl}/releases/download`,
    PROMPT_STUDIO_PLATFORM: 'macos-arm64',
  };
}

describe('prompt-studio update', () => {
  it('replaces the installed app with the build named in the latest release', async () => {
    // Given: an installed app and a latest release whose asset matches its checksum
    mode = 'ok';
    await listen();
    const binaryPath = await installedBinary();
    const lines: string[] = [];
    // When: the person runs prompt-studio update
    const code = await runCli(['update'], updateEnv(binaryPath), (line) => lines.push(line));
    // Then: the app is the downloaded build, and the asset came from that release
    expect(code).toBe(0);
    expect(await readFile(binaryPath)).toEqual(NEXT);
    expect(lines).toContain('Prompt Studio is up to date.');
    expect(requested).toContain('/releases/download/v1.2.3/prompt-studio-macos-arm64');
  });

  it('leaves the installed app in place when the download fails', async () => {
    // Given: a latest release whose asset cannot be downloaded
    mode = 'missing-asset';
    await listen();
    const binaryPath = await installedBinary();
    const lines: string[] = [];
    // When: the person runs prompt-studio update
    await runCli(['update'], updateEnv(binaryPath), (line) => lines.push(line));
    // Then: the installed bytes are unchanged and the person is told so
    expect(await readFile(binaryPath)).toEqual(ORIGINAL);
    expect(lines).toContain('Prompt Studio could not download an update. The installed app was left as it is.');
  });

  it('leaves the installed app in place when the checksum does not match', async () => {
    // Given: a downloaded asset whose bytes differ from the checksum in latest.json
    mode = 'wrong-checksum';
    await listen();
    const binaryPath = await installedBinary();
    // When: the person runs prompt-studio update
    await runCli(['update'], updateEnv(binaryPath), () => {});
    // Then: the unverified download never replaces the installed app
    expect(await readFile(binaryPath)).toEqual(ORIGINAL);
  });

  it('opens the editor with no arguments', async () => {
    // Given: an installed app
    mode = 'ok';
    await listen();
    const lines: string[] = [];
    let openedEditor = false;
    // When: the person runs prompt-studio with no arguments
    const code = await runCli([], { STUDIO_HOST: '127.0.0.1', STUDIO_PORT: '5273' }, (line) => lines.push(line), {
      startStudio: async () => {
        openedEditor = true;
      },
      openPage: (url) => lines.push(url),
    });
    // Then: the editor starts and the browser is pointed at it
    expect(code).toBe(0);
    expect(openedEditor).toBe(true);
    expect(lines).toContain('http://127.0.0.1:5273');
  });
});
