// @vitest-environment node
// @module-tag integration
/**
 * Outcome test (docs/development.md "Checks"): the installed `prompt-studio` command serves the editor on
 * this computer only. The served page embeds the per-launch token, so a non-loopback bind would let anyone
 * on the same network read the token and then read and change the open project.
 *
 * Real entrypoint: `src/release/main.ts` (what the compiled binary runs), started with no host override.
 */
import { type ChildProcess, spawn } from 'node:child_process';
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import net from 'node:net';
import { networkInterfaces, tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { freePort, request, stopStudio } from './launch-test-helpers';

const APP = path.resolve(import.meta.dirname, '../..');
let child: ChildProcess | undefined;
let directory: string | undefined;

afterEach(async () => {
  if (child) await stopStudio(child);
  child = undefined;
  if (directory) await rm(directory, { recursive: true, force: true });
  directory = undefined;
});

function externalIPv4(): string | undefined {
  for (const entries of Object.values(networkInterfaces())) {
    for (const entry of entries ?? []) if (entry.family === 'IPv4' && !entry.internal) return entry.address;
  }
  return undefined;
}

function connects(host: string, port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port });
    socket.setTimeout(1500, () => {
      socket.destroy();
      resolve(false);
    });
    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.once('error', () => resolve(false));
  });
}

describe('installed prompt-studio command', () => {
  it('listens on loopback only when no host is configured', async () => {
    // Given: a fresh home folder, a free port, no STUDIO_HOST, and a stand-in browser opener
    directory = await mkdtemp(path.join(tmpdir(), 'prompt-studio-loopback-'));
    const opener = path.join(directory, 'xdg-open');
    await writeFile(opener, '#!/bin/sh\nexit 0\n');
    await chmod(opener, 0o755);
    const port = await freePort();
    const env = {
      ...process.env,
      HOME: directory,
      STUDIO_PORT: String(port),
      PATH: `${directory}:${process.env.PATH}`,
    };
    delete env.STUDIO_HOST;

    // When: the person runs the installed command
    child = spawn('bun', ['src/release/main.ts'], { cwd: APP, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    const listening = new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`server did not start:\n${output}`)), 20_000);
      const onData = (chunk: Buffer) => {
        output += chunk.toString('utf8');
        const match = /listening on http:\/\/([^:/]+):/.exec(output);
        if (match) {
          clearTimeout(timer);
          resolve(match[1] ?? '');
        }
      };
      child?.stdout?.on('data', onData);
      child?.stderr?.on('data', onData);
    });
    const host = await listening;

    // Then: it binds 127.0.0.1, serves the editor there, and refuses the machine's network address
    expect(host).toBe('127.0.0.1');
    expect((await request(port, '/')).status).toBe(200);
    const external = externalIPv4();
    if (external) expect(await connects(external, port)).toBe(false);
  }, 30_000);
});
