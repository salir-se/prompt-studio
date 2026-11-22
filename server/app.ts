import { existsSync } from 'node:fs';
import * as fs from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { createServer, type Server } from 'node:http';
import path from 'node:path';
import {
  BridgeError,
  hasBlockedSegment,
  listDirEntries,
  MAX_FILE_BYTES,
  readPermittedFile,
  resolvePermittedPath,
  STUDIO_TOKEN_HEADER,
  validateOrigin,
  validateToken,
} from '../src/bridge/fs-bridge';
import { allowedRootsFor, type ResolvedManifest } from '../src/manifest/resolve-manifest';
import { manifestFromPromptRepoFiles } from '../src/prompt-repo/layout';
import type { StudioServerConfig } from './config';
import type { ControlRoutes } from './control-routes';
import { createGithubAuth } from './github-auth';
import { injectStudioToken } from './html';
import { createPromptRepoHandler, defaultPromptRepoDir, type PromptRepoRuntime } from './prompt-repo-routes';
import { LocalRunStore } from './run/local-store';
import { createRunHandler } from './run/run-routes';
import { RunSettingsStore } from './run/run-settings';
import { handleSessionRequest } from './session-route';
import { contentTypeFor, resolveStaticAssetPath } from './static-files';
import { createVerifyHandler } from './verify';

/**
 * Standalone HTTP wiring for prompt-studio: `/health`, the read-only `/__studio/*` fs bridge, and
 * static+SPA serving. All decision logic (path resolution, allowlist enforcement, origin/token
 * validation, content-type mapping, token injection) lives in `fs-bridge.ts`, `static-files.ts`,
 * and `html.ts` — this module is deliberately just a thin dispatcher over those pure functions,
 * matching the discipline `fs-bridge.ts`'s own `createStudioFsBridgePlugin` follows for Vite.
 */

function firstHeaderValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(body));
}

/** Handles every `/__studio/*` request: origin + token gate, then the manifest or the allowlisted fs bridge. */
async function handleStudioBridgeRequest(
  req: IncomingMessage,
  res: ServerResponse,
  config: StudioServerConfig,
  token: string,
  runtime: PromptRepoRuntime,
): Promise<void> {
  if (req.method !== 'GET') {
    sendJson(res, 405, { ok: false, error: 'Method not allowed.' });
    return;
  }

  if (!validateOrigin(firstHeaderValue(req.headers.origin), config.allowedOrigins)) {
    sendJson(res, 403, { ok: false, error: 'Forbidden.' });
    return;
  }

  if (!validateToken(firstHeaderValue(req.headers[STUDIO_TOKEN_HEADER]), token)) {
    sendJson(res, 401, { ok: false, error: 'Unauthorized.' });
    return;
  }

  const url = new URL(req.url ?? '/', 'http://localhost');

  try {
    await runtime.initialize?.();
    if (url.pathname === '/__studio/manifest') {
      if (runtime.repository) {
        const layout = manifestFromPromptRepoFiles(runtime.repository.name, await runtime.repository.allFiles());
        if (!layout.ok) throw new Error('Invalid project layout.');
        sendJson(res, 200, { ok: true, manifest: layout.manifest });
        return;
      }
      // An invalid manifest is loud but never fatal: the SPA falls back to its bundled default,
      // and the bridge below keeps serving with the default allowlist. The detail (which names
      // the file and validation errors) goes to stderr only.
      if (runtime.resolvedManifest.status !== 'ok') {
        console.error(`[prompt-studio server] active manifest is invalid — ${runtime.resolvedManifest.detail}`);
        sendJson(res, 500, { ok: false, error: 'Studio manifest is invalid. See server logs.' });
        return;
      }
      sendJson(res, 200, { ok: true, manifest: runtime.resolvedManifest.manifest });
      return;
    }

    const allowedRoots = allowedRootsFor(runtime.resolvedManifest);

    if (url.pathname === '/__studio/list') {
      const dir = url.searchParams.get('dir') ?? '';
      if (runtime.repository) {
        if (hasBlockedSegment(dir)) throw new BridgeError(403, 'Path is not permitted.');
        const entries = (await runtime.repository.list(dir)).filter((entry) => !hasBlockedSegment(entry.name));
        sendJson(res, 200, { ok: true, entries });
        return;
      }
      const absDir = await resolvePermittedPath({
        repoRoot: runtime.repoRoot,
        requestedPath: dir,
        kind: 'dir',
        allowedRoots,
      });
      const entries = await listDirEntries(absDir);
      sendJson(res, 200, { ok: true, entries });
      return;
    }

    if (url.pathname === '/__studio/file') {
      const requestedPath = url.searchParams.get('path') ?? '';
      if (runtime.repository) {
        if (hasBlockedSegment(requestedPath) || !/^(prompts|skills)\/.+\.md$/.test(requestedPath))
          throw new BridgeError(403, 'That file is outside the prompt project.');
        const text = await runtime.repository.read(requestedPath);
        if (Buffer.byteLength(text) > MAX_FILE_BYTES) throw new BridgeError(413, 'File is too large.');
        sendJson(res, 200, { ok: true, path: requestedPath, text });
        return;
      }
      const absFile = await resolvePermittedPath({
        repoRoot: runtime.repoRoot,
        requestedPath,
        kind: 'file',
        allowedRoots,
      });
      const text = await readPermittedFile(absFile);
      sendJson(res, 200, { ok: true, path: requestedPath, text });
      return;
    }

    sendJson(res, 404, { ok: false, error: 'Not found.' });
  } catch (error) {
    if (error instanceof BridgeError) {
      // `detail` may contain a resolved absolute path or a raw fs error — stderr only, never
      // the response body (see BridgeError's own doc comment in fs-bridge.ts).
      if (error.detail) {
        console.error(`[prompt-studio server] ${error.message} — ${error.detail}`);
      }
      sendJson(res, error.status, { ok: false, error: error.message });
      return;
    }
    console.error('[prompt-studio server] unexpected error', error);
    sendJson(res, 500, { ok: false, error: 'Internal error.' });
  }
}

/** Reads `staticDir/index.html` fresh and injects the current boot's token before responding. */
async function serveIndexHtml(res: ServerResponse, staticDir: string, token: string): Promise<void> {
  try {
    const html = await fs.readFile(path.join(staticDir, 'index.html'), 'utf8');
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(
      injectStudioToken(html, token).replace(
        '<meta name="studio-token"',
        '<meta name="studio-workspace" content="true"><meta name="studio-token"',
      ),
    );
  } catch (error) {
    // Never leak the resolved staticDir path or the raw fs error to the client.
    console.error('[prompt-studio server] failed to read index.html', error);
    res.writeHead(500, { 'content-type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ ok: false, error: 'Internal error.' }));
  }
}

/**
 * Serves a static asset if one exists at the resolved path, otherwise falls back to `index.html`
 * (client-side SPA routing owns everything else) — including for a rejected traversal attempt,
 * which `resolveStaticAssetPath` reports the same way as "no such asset" (`null`).
 */
async function handleStaticRequest(
  req: IncomingMessage,
  res: ServerResponse,
  config: StudioServerConfig,
  token: string,
): Promise<void> {
  const pathname = new URL(req.url ?? '/', 'http://localhost').pathname;

  if (pathname === '/' || pathname === '/index.html') {
    await serveIndexHtml(res, config.staticDir, token);
    return;
  }

  const assetPath = resolveStaticAssetPath(config.staticDir, pathname);
  if (assetPath) {
    try {
      const stats = await fs.stat(assetPath);
      if (stats.isFile()) {
        const data = await fs.readFile(assetPath);
        res.writeHead(200, { 'content-type': contentTypeFor(assetPath) });
        res.end(data);
        return;
      }
    } catch {
      // ENOENT (or a directory with no index): fall through to the SPA fallback below.
    }
  }

  await serveIndexHtml(res, config.staticDir, token);
}

/** Thin request router: `/health`, then `/verify`, then the fs bridge, then static+SPA-fallback serving. */
export function createRequestHandler(
  config: StudioServerConfig,
  token: string,
  resolvedManifest: ResolvedManifest,
  control?: ControlRoutes,
): (req: IncomingMessage, res: ServerResponse) => Promise<void> {
  const githubAuth = createGithubAuth({ clientId: config.githubClientId });
  const openedCheckout = existsSync(path.join(config.repoRoot, '.git'));
  const runtime: PromptRepoRuntime = {
    repoRoot: config.repoRoot,
    resolvedManifest,
    checkout: openedCheckout ? config.repoRoot : null,
    repoName: openedCheckout ? 'Your prompts' : null,
  };
  const handlePromptRepo = createPromptRepoHandler({
    runtime,
    workspaceDir: config.promptRepoDir ?? defaultPromptRepoDir(),
    studioToken: token,
    allowedOrigins: config.allowedOrigins,
    getToken: githubAuth.getToken,
  });
  const runDirectory = path.join(config.promptRepoDir ?? defaultPromptRepoDir(), 'run-data');
  const settings = new RunSettingsStore(new LocalRunStore(runDirectory), {
    apiKey: config.zaiApiKey,
    baseUrl: config.zaiBaseUrl,
  });
  const handleVerify = createVerifyHandler(config, token, undefined, { runtime, settings });
  const handleRun = createRunHandler({
    runtime,
    directory: runDirectory,
    settings,
    studioToken: token,
    allowedOrigins: config.allowedOrigins,
    apiKey: config.zaiApiKey,
    baseUrl: config.zaiBaseUrl,
  });

  return async (req, res) => {
    let pathname: string;
    try {
      pathname = new URL(req.url ?? '/', 'http://localhost').pathname;
    } catch {
      sendJson(res, 400, { ok: false, error: 'Invalid request URL.' });
      return;
    }

    if (pathname === '/health') {
      // Unauthenticated by design — this backs the Docker HEALTHCHECK, which has no token.
      sendJson(res, 200, { ok: true });
      return;
    }

    if (pathname === '/verify') {
      await handleVerify(req, res);
      return;
    }

    if (pathname === '/__studio/session') {
      handleSessionRequest(req, res, token, config.allowedOrigins);
      return;
    }

    if (pathname.startsWith('/__studio/')) {
      if (await handleRun(req, res)) return;
      if (await githubAuth.handle(req, res, token, config.allowedOrigins)) return;
      if (await handlePromptRepo(req, res)) return;
      await handleStudioBridgeRequest(req, res, config, token, runtime);
      return;
    }

    if (pathname.startsWith('/__control/') && control !== undefined) {
      const handled = await control.handle(req, res);
      if (!handled) sendJson(res, 404, { ok: false, error: 'Not found.' });
      return;
    }

    await handleStaticRequest(req, res, config, token);
  };
}

export function createHttpServer(
  config: StudioServerConfig,
  token: string,
  resolvedManifest: ResolvedManifest,
  control?: ControlRoutes,
): Server {
  const handle = createRequestHandler(config, token, resolvedManifest, control);
  return createServer((req, res) => {
    void handle(req, res).catch(() => {
      console.error('[prompt-studio server] unexpected request failure');
      if (res.headersSent) res.destroy();
      else sendJson(res, 500, { ok: false, error: 'Internal error.' });
    });
  });
}
