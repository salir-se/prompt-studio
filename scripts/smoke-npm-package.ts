#!/usr/bin/env bun
/**
 * Smoke-boots the packed `@salir-se/prompt-studio` npm tarball under Bun before the
 * publish workflow lets it near the registry (ADR-204 amendment 2026-09-15).
 *
 * The publish workflow runs this between `bun pm pack` and `bun publish`. The Dockerfile history
 * (infra/docker/prompt-studio.Dockerfile's boot-crash war stories) is exactly why: a package
 * that assembles cleanly can still fail at BOOT on the first unresolved module. This script
 * asserts the properties a `bunx` user depends on, end to end, against the real tarball:
 *
 *   1. `bun add <tarball>` succeeds into an empty prefix.
 *   2. `bun bin/prompt-studio.js` (the launcher shebangs `bun`) boots the bundled server.
 *   3. `/health` answers unauthenticated; `/` serves the SPA shell with a per-boot token.
 *   4. The read-only bridge serves a repo file for the token+Origin pair (and ONLY that shape
 *      of request — the token alone is not the auth story, the Origin gate is part of it).
 *   5. `bin/prompt-studio-cli.js` drives the control channel end-to-end (token-file discovery
 *      → RPC → JSON out).
 *   6. SIGTERM shuts the server down cleanly (exit 0 — token file removed, listener closed).
 *
 * Usage: bun scripts/smoke-npm-package.ts [path/to/package.tgz]
 * (defaults to the newest tarball under .output/prompt-studio-npm/package/)
 */

import { execFileSync, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import net from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const APP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REPO_ROOT = APP_ROOT;
const STUDIO_TOKEN_HEADER = 'x-studio-token'; // mirror of src/bridge/fs-bridge.ts's STUDIO_TOKEN_HEADER
const BOOT_TIMEOUT_MS = 30_000;

function fail(message: string): never {
  console.error(`[npm-smoke] FAIL: ${message}`);
  process.exit(1);
}

async function findTarball(): Promise<string> {
  const arg = process.argv[2];
  if (arg) {
    if (!existsSync(arg)) fail(`tarball not found: ${arg}`);
    return path.resolve(arg);
  }
  const packDir = path.join(REPO_ROOT, '.output', 'prompt-studio-npm', 'package');
  if (!existsSync(packDir)) fail(`no packed tarball directory at ${packDir} — run scripts/build-npm-package.ts first`);
  const tarballs = (await readdir(packDir)).filter((file) => file.endsWith('.tgz'));
  if (tarballs.length === 0) fail(`no .tgz in ${packDir} — run scripts/build-npm-package.ts first`);
  return path.join(packDir, tarballs.sort().at(-1) ?? tarballs[0]);
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as net.AddressInfo;
      server.close(() => resolve(port));
    });
    server.on('error', reject);
  });
}

/** Spawns a short-lived process, captures stdout+stderr, resolves {exitCode, output}. */
function runCapturing(command: string, args: readonly string[]): Promise<{ exitCode: number | null; output: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    child.stdout.on('data', (chunk: Buffer) => (output += chunk.toString()));
    child.stderr.on('data', (chunk: Buffer) => (output += chunk.toString()));
    child.on('error', reject);
    child.on('exit', (code) => resolve({ exitCode: code, output }));
  });
}

/** Polls /health until the server answers 200 {ok:true} or the boot budget is spent. */
async function waitUntilHealthy(baseUrl: string): Promise<void> {
  const deadline = Date.now() + BOOT_TIMEOUT_MS;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/health`);
      if (response.status === 200 && ((await response.json()) as { ok?: boolean }).ok === true) return;
    } catch {
      // not listening yet — retry until the deadline
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  fail(`server did not become healthy within ${BOOT_TIMEOUT_MS}ms at ${baseUrl}`);
}

async function main(): Promise<void> {
  const tarball = await findTarball();
  console.log(`[npm-smoke] tarball: ${tarball}`);

  const bunVersion = (() => {
    try {
      return execFileSync('bun', ['--version'], { encoding: 'utf8' }).trim();
    } catch {
      return fail('bun is not on PATH — the smoke proves the package boots under Bun');
    }
  })();
  console.log(`[npm-smoke] bun: ${bunVersion}`);

  const workDir = await mkdtemp(path.join(tmpdir(), 'prompt-studio-npm-smoke-'));
  const fixtureRepo = path.join(workDir, 'fixture-repo');
  await mkdir(path.join(fixtureRepo, 'prompts'), { recursive: true });
  await writeFile(path.join(fixtureRepo, 'prompts', 'good.md'), 'Smoke prompt: ok.\n');

  // 1. Install into an empty prefix.
  console.log('[npm-smoke] installing tarball...');
  await writeFile(path.join(workDir, 'package.json'), '{"name":"smoke-consumer","private":true}\n');
  execFileSync('bun', ['add', tarball], { cwd: workDir, stdio: 'inherit' });
  const pkgDir = path.join(workDir, 'node_modules', '@salir-se', 'prompt-studio');
  const serverBin = path.join(pkgDir, 'bin', 'prompt-studio.js');
  const cliBin = path.join(pkgDir, 'bin', 'prompt-studio-cli.js');
  for (const required of [
    serverBin,
    cliBin,
    path.join(pkgDir, 'server', 'main.js'),
    path.join(pkgDir, 'dist', 'index.html'),
  ]) {
    if (!existsSync(required)) fail(`installed package is missing ${path.relative(workDir, required)}`);
  }

  // 2. Boot under Bun with the launcher's npm defaults (--repo fixture, loopback bind).
  const port = await freePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  console.log(`[npm-smoke] booting server under bun on ${baseUrl}...`);
  const server = spawn('bun', [serverBin, '--repo', fixtureRepo, '--port', String(port)], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let serverOutput = '';
  server.stdout.on('data', (chunk: Buffer) => {
    serverOutput += chunk.toString();
  });
  server.stderr.on('data', (chunk: Buffer) => {
    serverOutput += chunk.toString();
  });
  const timedOut = setTimeout(() => {
    server.kill('SIGKILL');
    fail(`server boot timed out; output so far:\n${serverOutput}`);
  }, BOOT_TIMEOUT_MS);

  try {
    await waitUntilHealthy(baseUrl);

    // 3. SPA shell + per-boot token.
    const shell = await fetch(`${baseUrl}/`);
    if (shell.status !== 200) fail(`GET / answered ${shell.status}`);
    const html = await shell.text();
    const token = /<meta name="studio-token" content="([^"]+)">/.exec(html)?.[1];
    if (!token) fail('served index.html carries no studio-token meta tag');
    console.log('[npm-smoke] SPA shell + per-boot token: ok');

    // 4. Read-only bridge: token + matching Origin are required, and serve the fixture file.
    const bridgeUrl = `${baseUrl}/__studio/file?path=prompts/good.md`;
    const noAuth = await fetch(bridgeUrl);
    if (noAuth.status !== 401) fail(`bridge without a token answered ${noAuth.status}, expected 401`);
    const foreign = await fetch(bridgeUrl, {
      headers: { origin: 'http://evil.example.com', [STUDIO_TOKEN_HEADER]: token ?? '' },
    });
    if (foreign.status !== 403) fail(`bridge with a foreign Origin answered ${foreign.status}, expected 403`);
    const allowed = await fetch(bridgeUrl, {
      headers: { origin: `http://127.0.0.1:${port}`, [STUDIO_TOKEN_HEADER]: token ?? '' },
    });
    if (allowed.status !== 200) fail(`bridge read answered ${allowed.status}, expected 200`);
    const fileBody = (await allowed.json()) as { ok?: boolean; text?: string };
    if (fileBody.ok !== true || fileBody.text !== 'Smoke prompt: ok.\n') {
      fail(`bridge read returned unexpected body: ${JSON.stringify(fileBody)}`);
    }
    console.log('[npm-smoke] read-only bridge (401 / 403 / 200 shapes): ok');

    // 5. Control CLI transport round-trip. A full command needs a live editor TAB (a browser) —
    //    headlessly, the designed no-tab contract is the actionable 503 (ADR-236), so assert
    //    exactly that end to end: token-file discovery → POST → server gate → client error.
    //    A wrong --token must reach the same transport but die at the 401 gate instead.
    const noTab = await runCapturing('bun', [cliBin, '--port', String(port), 'docs', '--json']);
    if (noTab.exitCode !== 1 || !noTab.output.includes('No editor tab is connected')) {
      fail(
        `cli without a tab should exit 1 with the no-tab message, got ${noTab.exitCode}: ${noTab.output.slice(0, 200)}`,
      );
    }
    const badToken = await runCapturing('bun', [cliBin, '--port', String(port), '--token', 'wrong', 'docs', '--json']);
    if (badToken.exitCode !== 1 || !badToken.output.includes('Unauthorized')) {
      fail(
        `cli with a wrong token should exit 1 with Unauthorized, got ${badToken.exitCode}: ${badToken.output.slice(0, 200)}`,
      );
    }
    console.log('[npm-smoke] control CLI transport + auth gates (no-tab 503 / bad-token 401): ok');

    // 6. Graceful shutdown.
    server.kill('SIGTERM');
    const exitCode = await new Promise<number | null>((resolve, reject) => {
      const killTimer = setTimeout(() => {
        server.kill('SIGKILL');
        reject(new Error('server ignored SIGTERM'));
      }, 10_000);
      server.on('exit', (code) => {
        clearTimeout(killTimer);
        resolve(code);
      });
    });
    if (exitCode !== 0) fail(`server exited with ${exitCode} on SIGTERM, expected 0`);
    clearTimeout(timedOut);
    console.log('[npm-smoke] graceful SIGTERM shutdown: ok');
  } finally {
    clearTimeout(timedOut);
    if (server.exitCode === null && !server.killed) server.kill('SIGKILL');
    await rm(workDir, { recursive: true, force: true });
  }

  console.log('[npm-smoke] OK — the packed tarball installs, boots under Bun, and serves');
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
