// @vitest-environment node
// @module-tag pure
//
// This suite makes real HTTP requests to a real server. The app's global vitest environment is
// happy-dom (for browser-facing component tests); happy-dom's `fetch` enforces browser same-origin
// policy against `window.location` (here `about:blank`), which rejects every cross-origin request
// this suite makes regardless of the server's own response. Server-side code has no DOM dependency,
// so running this file under the plain Node environment sidesteps that entirely.

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { STUDIO_TOKEN_HEADER } from '../src/bridge/fs-bridge';
import { DEFAULT_MANIFEST } from '../src/manifest/default-manifest';
import type { ResolvedManifest } from '../src/manifest/resolve-manifest';
import { createHttpServer } from './app';
import type { StudioServerConfig } from './config';
// Real loopback HTTP client, not the guarded global `fetch` — see the module doc in
// `./loopback-fetch.ts` for why this suite is a sanctioned exception to the network guard.
import { loopbackFetch as fetch } from './loopback-fetch';

/**
 * Integration coverage for the standalone server: real HTTP requests against a real
 * `node:http` server (`createHttpServer`), built over a temp repo fixture that mirrors
 * `fs-bridge.test.ts`'s own fixture shape, and a temp static-build fixture.
 */

const TOKEN = 'test-boot-token';

let repoRoot: string;
let staticDir: string;
let server: Server;
let baseUrl: string;
let config: StudioServerConfig;

/** A boot-equivalent resolved manifest: the shipped default, as server/main.ts would resolve it. */
function defaultResolvedManifest(): ResolvedManifest {
  return { status: 'ok', manifest: DEFAULT_MANIFEST, source: 'app' };
}

async function startServer(
  overrides: Partial<StudioServerConfig> = {},
  token = TOKEN,
  resolvedManifest: ResolvedManifest = defaultResolvedManifest(),
): Promise<void> {
  config = {
    repoRoot,
    staticDir,
    host: '127.0.0.1',
    port: 0,
    allowedOrigins: ['http://127.0.0.1:5273', 'http://localhost:5273'],
    // verifyBudget is required on StudioServerConfig (see config.ts); this suite doesn't exercise
    // POST /verify, so any positive value is fine here.
    verifyBudget: 20,
    ...overrides,
  };
  server = createHttpServer(config, token, resolvedManifest);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${port}`;
}

beforeEach(async () => {
  repoRoot = await mkdtemp(path.join(tmpdir(), 'prompt-studio-server-repo-'));
  await mkdir(path.join(repoRoot, 'prompts/secrets'), { recursive: true });
  await writeFile(path.join(repoRoot, 'prompts/good.ts'), 'export const x = 1;\n');
  await writeFile(path.join(repoRoot, 'prompts/secrets/token.txt'), 'sekret\n');

  staticDir = await mkdtemp(path.join(tmpdir(), 'prompt-studio-server-static-'));
  await mkdir(path.join(staticDir, 'assets'), { recursive: true });
  await writeFile(
    path.join(staticDir, 'index.html'),
    '<!doctype html><html><head><title>Studio</title></head><body>root</body></html>',
  );
  await writeFile(path.join(staticDir, 'assets/app.js'), 'console.log("hi");\n');
});

afterEach(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await rm(repoRoot, { recursive: true, force: true });
  await rm(staticDir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe('GET /health', () => {
  it('returns 200 with no auth required', async () => {
    await startServer();
    const response = await fetch(`${baseUrl}/health`);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ ok: true });
  });
});

describe('GET /__studio/*', () => {
  it('rejects a non-GET method with 405', async () => {
    await startServer();
    const response = await fetch(`${baseUrl}/__studio/list?dir=prompts`, { method: 'POST' });
    expect(response.status).toBe(405);
    expect(await response.json()).toEqual({ ok: false, error: 'Method not allowed.' });
  });

  it('rejects a foreign Origin with 403', async () => {
    await startServer();
    const response = await fetch(`${baseUrl}/__studio/list?dir=prompts`, {
      headers: { origin: 'http://evil.example.com', [STUDIO_TOKEN_HEADER]: TOKEN },
    });
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ ok: false, error: 'Forbidden.' });
  });

  it('rejects a missing token with 401', async () => {
    await startServer();
    const response = await fetch(`${baseUrl}/__studio/list?dir=prompts`);
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ ok: false, error: 'Unauthorized.' });
  });

  it('rejects a wrong token with 401', async () => {
    await startServer();
    const response = await fetch(`${baseUrl}/__studio/list?dir=prompts`, {
      headers: { [STUDIO_TOKEN_HEADER]: 'wrong-token' },
    });
    expect(response.status).toBe(401);
  });

  it('returns the list success shape for a permitted directory', async () => {
    await startServer();
    const response = await fetch(`${baseUrl}/__studio/list?dir=prompts`, {
      headers: { [STUDIO_TOKEN_HEADER]: TOKEN },
    });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.ok).toBe(true);
    expect(body.entries).toEqual(expect.arrayContaining([{ name: 'good.ts', type: 'file' }]));
  });

  it('returns the file success shape for a permitted file', async () => {
    await startServer();
    const response = await fetch(`${baseUrl}/__studio/file?path=prompts/good.ts`, {
      headers: { [STUDIO_TOKEN_HEADER]: TOKEN },
    });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ ok: true, path: 'prompts/good.ts', text: 'export const x = 1;\n' });
  });

  it('maps a BridgeError to its status with only the generic message in the body', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    await startServer();
    const response = await fetch(`${baseUrl}/__studio/file?path=prompts/secrets/token.txt`, {
      headers: { [STUDIO_TOKEN_HEADER]: TOKEN },
    });
    expect(response.status).toBe(403);
    const body = await response.json();
    expect(body).toEqual({ ok: false, error: 'Path is not permitted.' });
    const responseText = JSON.stringify(body);
    expect(responseText).not.toContain('secrets');
    expect(responseText).not.toContain(repoRoot);

    // The detail (which DOES name the offending path) goes to stderr only, never the response.
    expect(errorSpy).toHaveBeenCalled();
    const loggedText = errorSpy.mock.calls.map((call) => call.join(' ')).join('\n');
    expect(loggedText).toContain('secrets');
  });

  it('never logs the studio token itself, even on a rejected request', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    await startServer();
    await fetch(`${baseUrl}/__studio/file?path=prompts/secrets/token.txt`, {
      headers: { [STUDIO_TOKEN_HEADER]: TOKEN },
    });
    const allLoggedText = [...errorSpy.mock.calls, ...logSpy.mock.calls].map((call) => call.join(' ')).join('\n');
    expect(allLoggedText).not.toContain(TOKEN);
  });
});

describe('GET /__studio/manifest', () => {
  it('serves the active manifest behind the same gates as the fs bridge', async () => {
    await startServer();
    const response = await fetch(`${baseUrl}/__studio/manifest`, {
      headers: { [STUDIO_TOKEN_HEADER]: TOKEN },
    });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.ok).toBe(true);
    expect(body.manifest).toEqual(DEFAULT_MANIFEST);
  });

  it('rejects a non-GET method with 405', async () => {
    await startServer();
    const response = await fetch(`${baseUrl}/__studio/manifest`, { method: 'POST' });
    expect(response.status).toBe(405);
  });

  it('rejects a foreign Origin with 403 and a missing token with 401', async () => {
    await startServer();
    const foreignOrigin = await fetch(`${baseUrl}/__studio/manifest`, {
      headers: { origin: 'http://evil.example.com', [STUDIO_TOKEN_HEADER]: TOKEN },
    });
    expect(foreignOrigin.status).toBe(403);

    const noToken = await fetch(`${baseUrl}/__studio/manifest`);
    expect(noToken.status).toBe(401);
  });

  it('answers 500 with a generic body when the active manifest is invalid — and the bridge still serves the default allowlist', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const invalid: ResolvedManifest = {
      status: 'invalid',
      source: 'env',
      detail: 'manifest failed schema validation at: contentRoots (/tmp/evil.json)',
    };
    await startServer({}, TOKEN, invalid);

    const manifestResponse = await fetch(`${baseUrl}/__studio/manifest`, {
      headers: { [STUDIO_TOKEN_HEADER]: TOKEN },
    });
    expect(manifestResponse.status).toBe(500);
    const body = await manifestResponse.json();
    expect(body).toEqual({ ok: false, error: 'Studio manifest is invalid. See server logs.' });
    expect(JSON.stringify(body)).not.toContain('/tmp/evil.json');

    // The detail goes to stderr only.
    expect(errorSpy).toHaveBeenCalled();

    // Degraded, not dead: the file bridge still answers on the shipped default roots.
    const fileResponse = await fetch(`${baseUrl}/__studio/file?path=prompts/good.ts`, {
      headers: { [STUDIO_TOKEN_HEADER]: TOKEN },
    });
    expect(fileResponse.status).toBe(200);
  });

  it('widens the bridge allowlist to a valid manifest content root not in the shipped default', async () => {
    // A manifest whose contentRoots include a root outside the shipped default; the repo fixture
    // carries a file under it. Proves the manifest DRIVES the allowlist (ADR-235's "widen the
    // roots" direction) — this is the feature a volume-mounted third-party manifest relies on.
    await mkdir(path.join(repoRoot, 'vendor/prompts'), { recursive: true });
    await writeFile(path.join(repoRoot, 'vendor/prompts/foreign.md'), '# foreign\n');

    const widened: ResolvedManifest = {
      status: 'ok',
      source: 'env',
      manifest: {
        ...DEFAULT_MANIFEST,
        contentRoots: ['vendor/prompts'],
      } as ResolvedManifest extends { manifest: infer M } ? M : never,
    };
    await startServer({}, TOKEN, widened);

    const allowed = await fetch(`${baseUrl}/__studio/file?path=vendor/prompts/foreign.md`, {
      headers: { [STUDIO_TOKEN_HEADER]: TOKEN },
    });
    expect(allowed.status).toBe(200);

    // And the shipped default root is NOT implicitly retained — the manifest REPLACES the list.
    const shippedRoot = await fetch(`${baseUrl}/__studio/file?path=prompts/good.ts`, {
      headers: { [STUDIO_TOKEN_HEADER]: TOKEN },
    });
    expect(shippedRoot.status).toBe(403);
  });
});

describe('static + SPA serving', () => {
  it('serves an existing static asset with the correct content type', async () => {
    await startServer();
    const response = await fetch(`${baseUrl}/assets/app.js`);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('text/javascript; charset=utf-8');
    expect(await response.text()).toBe('console.log("hi");\n');
  });

  it('falls back to index.html for an unknown SPA route', async () => {
    await startServer();
    const response = await fetch(`${baseUrl}/prompts/some/deep/route`);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('text/html; charset=utf-8');
    expect(await response.text()).toBe(
      `<!doctype html><html><head><meta name="studio-workspace" content="true"><meta name="studio-token" content="${TOKEN}"><title>Studio</title></head><body>root</body></html>`,
    );
  });

  it('injects the current boot token into index.html at request time, not from a cached copy', async () => {
    await startServer({}, 'boot-token-one');
    const first = await (await fetch(`${baseUrl}/`)).text();
    await new Promise<void>((resolve) => server.close(() => resolve()));

    await startServer({}, 'boot-token-two');
    const second = await (await fetch(`${baseUrl}/`)).text();

    expect(first).toBe(
      '<!doctype html><html><head><meta name="studio-workspace" content="true"><meta name="studio-token" content="boot-token-one"><title>Studio</title></head><body>root</body></html>',
    );
    expect(second).toBe(
      '<!doctype html><html><head><meta name="studio-workspace" content="true"><meta name="studio-token" content="boot-token-two"><title>Studio</title></head><body>root</body></html>',
    );
  });

  it('rejects path traversal against the static root by falling back to the SPA shell', async () => {
    await startServer();
    const response = await fetch(`${baseUrl}/%2e%2e/%2e%2e/%2e%2e/etc/passwd`);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('text/html; charset=utf-8');
    expect(await response.text()).toBe(
      `<!doctype html><html><head><meta name="studio-workspace" content="true"><meta name="studio-token" content="${TOKEN}"><title>Studio</title></head><body>root</body></html>`,
    );
  });
});
