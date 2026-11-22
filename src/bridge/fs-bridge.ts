import { randomUUID, timingSafeEqual } from 'node:crypto';
import * as fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { HtmlTagDescriptor, Plugin } from 'vite';
import { ControlHub } from '../../server/control-hub';
import { type ControlRoutes, createControlRoutes } from '../../server/control-routes';
import { removeControlTokenFile, writeControlTokenFile } from '../../server/control-token-file';
import { handleSessionRequest } from '../../server/session-route';
import { allowedRootsFor, resolveActiveManifest, type ResolvedManifest } from '../manifest/resolve-manifest';

/**
 * Salir Prompt Studio filesystem bridge.
 *
 * SECURITY BOUNDARY. This module is the ONLY attack surface of the prompt-studio dev
 * server: it lets the browser read a strictly limited slice of the repository over
 * HTTP. A dev server that serves repo contents on localhost is reachable by any web
 * page open in the same browser and by DNS-rebinding attacks — treat it like a
 * production route.
 *
 * All decision logic (path resolution, allowlist enforcement, origin validation,
 * token validation) lives in the pure, exported functions below so it can be unit
 * tested without starting a server. `createStudioFsBridgePlugin` is a thin Vite
 * middleware wrapper around them — it must not grow additional logic of its own.
 *
 * READ ONLY: there is intentionally no write/create/delete/rename code path here,
 * not even a disabled one.
 */

/** Repo-relative directories the bridge is permitted to read from. Nothing else. */
export const ALLOWED_ROOTS = ['packages/prompts', 'packages/skills/skills', 'docs/prompts'] as const;

/** File extensions the bridge is permitted to serve. Everything else is rejected. */
export const ALLOWED_EXTENSIONS = ['.ts', '.tsx', '.md', '.json', '.txt'] as const;

/** Refuse to serve a file larger than this, to bound response size. */
export const MAX_FILE_BYTES = 2 * 1024 * 1024;

/** The studio's own dev origins. Any other `Origin` header is a cross-page/rebinding attempt. */
export const STUDIO_DEV_ORIGINS = ['http://127.0.0.1:5273', 'http://localhost:5273'] as const;

/** Header carrying the per-boot token (see `createStudioFsBridgePlugin`). */
export const STUDIO_TOKEN_HEADER = 'x-studio-token';

/** Directory-name segments that are always blocked, regardless of allowlist membership. */
const BLOCKED_DIR_SEGMENTS = new Set(['secrets']);

/** Matches `*.sops.*` filenames (e.g. `prod.sops.yaml`), which must never be served. */
const SOPS_SEGMENT_PATTERN = /\.sops\./i;

export type BridgeEntryType = 'file' | 'dir';

export interface BridgeEntry {
  name: string;
  type: BridgeEntryType;
}

/**
 * Thrown for every rejection the bridge can produce. `message` is the generic,
 * client-safe reason (never a resolved path or raw fs error); `detail` is for
 * server-side logging only and must never be sent to the browser.
 */
export class BridgeError extends Error {
  readonly status: number;
  readonly detail: string | undefined;

  constructor(status: number, message: string, detail?: string) {
    super(message);
    this.name = 'BridgeError';
    this.status = status;
    this.detail = detail;
  }
}

/**
 * Path-boundary-safe containment check: is `target` equal to, or nested inside,
 * `root`? Uses `path.relative` rather than a raw string prefix, so a sibling whose
 * name happens to share `root` as a string prefix (e.g. `packages/promptsEVIL` vs.
 * `packages/prompts`) is correctly rejected, and a `../` escape is correctly rejected.
 */
export function isWithinRoot(root: string, target: string): boolean {
  const normalizedRoot = path.resolve(root);
  const normalizedTarget = path.resolve(target);
  if (normalizedRoot === normalizedTarget) {
    return true;
  }
  const rel = path.relative(normalizedRoot, normalizedTarget);
  if (rel === '' || path.isAbsolute(rel)) {
    return false;
  }
  return rel !== '..' && !rel.startsWith(`..${path.sep}`);
}

/**
 * Blocks dotfiles/dot-directories (including `.env*`), any path segment named
 * `secrets`, and any `*.sops.*` filename — applied to every segment of a
 * repo-relative path so these are rejected even if they sit inside an allowed root.
 */
export function hasBlockedSegment(relativePath: string): boolean {
  const segments = relativePath.split(/[\\/]+/).filter(Boolean);
  return segments.some((segment) => {
    if (segment.startsWith('.')) {
      return true;
    }
    if (BLOCKED_DIR_SEGMENTS.has(segment.toLowerCase())) {
      return true;
    }
    return SOPS_SEGMENT_PATTERN.test(segment);
  });
}

/** Is this file's extension on the serve allowlist? */
export function hasAllowedExtension(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase();
  return (ALLOWED_EXTENSIONS as readonly string[]).includes(ext);
}

/**
 * Origin binding: a request with no `Origin` header is allowed (same-origin browser
 * requests and non-browser tools omit it); a request WITH an `Origin` header must
 * match one of the studio's own dev origins. This is the DNS-rebinding / cross-page
 * defence — reject anything else outright.
 */
export function validateOrigin(
  origin: string | null | undefined,
  allowedOrigins: readonly string[] = STUDIO_DEV_ORIGINS,
): boolean {
  if (origin === null || origin === undefined || origin === '') {
    return true;
  }
  return allowedOrigins.includes(origin);
}

/** Constant-time comparison of the per-boot token against what the client sent. */
export function validateToken(provided: string | null | undefined, expected: string): boolean {
  if (!provided || !expected) {
    return false;
  }
  const providedBuf = Buffer.from(provided, 'utf8');
  const expectedBuf = Buffer.from(expected, 'utf8');
  if (providedBuf.length !== expectedBuf.length) {
    return false;
  }
  return timingSafeEqual(providedBuf, expectedBuf);
}

export interface ResolvePermittedPathOptions {
  /** Absolute path to the repository root. */
  repoRoot: string;
  /** Repo-relative path as requested by the client (untrusted). */
  requestedPath: string;
  /** Whether the caller expects a file or a directory; only files get the extension check. */
  kind: 'file' | 'dir';
  /** Override for testing; defaults to the three production allowed roots. */
  allowedRoots?: readonly string[];
}

/**
 * The single allowlist-enforcement chokepoint. Resolves `requestedPath` against
 * `repoRoot`, verifies it lands inside one of `allowedRoots` (checked with the
 * boundary-safe `isWithinRoot`, not a string prefix), rejects blocked segments and
 * extensions, then re-resolves through `fs.realpath` and re-checks containment so a
 * symlink cannot be used to escape an allowed root. Every failure throws a
 * `BridgeError` carrying only a generic, client-safe message.
 */
export async function resolvePermittedPath(options: ResolvePermittedPathOptions): Promise<string> {
  const { repoRoot, requestedPath, kind, allowedRoots = ALLOWED_ROOTS } = options;

  if (!requestedPath || typeof requestedPath !== 'string') {
    throw new BridgeError(400, 'A repo-relative path is required.');
  }
  if (requestedPath.includes('\0')) {
    throw new BridgeError(400, 'Invalid path.', 'path contained a null byte');
  }
  if (path.isAbsolute(requestedPath)) {
    throw new BridgeError(403, 'Path is not permitted.', `absolute path rejected: ${requestedPath}`);
  }

  const rawTarget = path.resolve(repoRoot, requestedPath);
  const relToRepoRoot = path.relative(repoRoot, rawTarget);
  if (relToRepoRoot.startsWith('..') || path.isAbsolute(relToRepoRoot)) {
    throw new BridgeError(403, 'Path is not permitted.', `escapes repo root: ${requestedPath}`);
  }

  if (hasBlockedSegment(relToRepoRoot)) {
    throw new BridgeError(403, 'Path is not permitted.', `blocked segment: ${requestedPath}`);
  }

  if (kind === 'file' && !hasAllowedExtension(rawTarget)) {
    throw new BridgeError(403, 'File type is not permitted.', `disallowed extension: ${requestedPath}`);
  }

  const matchedRoot = allowedRoots.find((allowedRoot) => isWithinRoot(path.resolve(repoRoot, allowedRoot), rawTarget));
  if (!matchedRoot) {
    throw new BridgeError(403, 'Path is not permitted.', `outside allowlist: ${requestedPath}`);
  }
  const matchedRootAbs = path.resolve(repoRoot, matchedRoot);

  let realTarget: string;
  try {
    realTarget = await fs.realpath(rawTarget);
  } catch (error) {
    throw new BridgeError(404, 'Not found.', `realpath failed for ${requestedPath}: ${String(error)}`);
  }

  let realAllowedRoot: string;
  try {
    realAllowedRoot = await fs.realpath(matchedRootAbs);
  } catch (error) {
    throw new BridgeError(500, 'Server misconfiguration.', `allowed root missing: ${matchedRoot}: ${String(error)}`);
  }

  if (!isWithinRoot(realAllowedRoot, realTarget)) {
    throw new BridgeError(403, 'Path is not permitted.', `symlink escapes allowed root: ${requestedPath}`);
  }

  // Re-check after symlink resolution: a link could point at a blocked name or
  // extension even though the link itself looked benign.
  const realRelToRoot = path.relative(repoRoot, realTarget);
  if (hasBlockedSegment(realRelToRoot)) {
    throw new BridgeError(403, 'Path is not permitted.', `blocked segment after resolution: ${requestedPath}`);
  }
  if (kind === 'file' && !hasAllowedExtension(realTarget)) {
    throw new BridgeError(
      403,
      'File type is not permitted.',
      `disallowed extension after resolution: ${requestedPath}`,
    );
  }

  return realTarget;
}

/**
 * Lists a permitted directory's immediate entries. Blocked names (dotfiles,
 * `secrets/`, `*.sops.*`) and disallowed file extensions are filtered out of the
 * listing entirely — the bridge never even reveals their names, let alone contents.
 */
export async function listDirEntries(absDirPath: string): Promise<BridgeEntry[]> {
  const dirents = await fs.readdir(absDirPath, { withFileTypes: true });
  return dirents
    .filter((dirent) => {
      if (hasBlockedSegment(dirent.name)) {
        return false;
      }
      return dirent.isDirectory() || hasAllowedExtension(dirent.name);
    })
    .map((dirent) => ({
      name: dirent.name,
      type: (dirent.isDirectory() ? 'dir' : 'file') as BridgeEntryType,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Reads a permitted file's contents as UTF-8 text, bounded by `MAX_FILE_BYTES`. */
export async function readPermittedFile(absFilePath: string): Promise<string> {
  const stats = await fs.stat(absFilePath);
  if (!stats.isFile()) {
    throw new BridgeError(404, 'Not found.', `not a regular file: ${absFilePath}`);
  }
  if (stats.size > MAX_FILE_BYTES) {
    throw new BridgeError(413, 'File is too large.', `size ${stats.size} exceeds ${MAX_FILE_BYTES}`);
  }
  return fs.readFile(absFilePath, 'utf8');
}

function firstHeaderValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function sendJson(
  res: { statusCode: number; setHeader: (name: string, value: string) => void; end: (body: string) => void },
  status: number,
  body: unknown,
): void {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(body));
}

export interface CreateStudioFsBridgeOptions {
  /** Absolute path to the repository root the allowlist is resolved against. */
  repoRoot: string;
  /**
   * Absolute app root (`apps/prompt-studio`). When set, the plugin resolves and serves the
   * studio manifest (`GET /__studio/manifest`) and derives its bridge allowlist from it,
   * exactly like the standalone server does (ADR-235). Leave unset only in tests that exercise
   * the manifest-free behavior explicitly.
   */
  appRoot?: string;
  /**
   * `STUDIO_MANIFEST_PATH` override — same meaning as the standalone server's config field: the
   * first (required) manifest candidate, ahead of the baked copy and the app tree. `vite.config`
   * reads the env var; tests pass the path directly.
   */
  manifestPath?: string;
  /** Override for testing; defaults to the manifest-derived roots (or `ALLOWED_ROOTS`). */
  allowedRoots?: readonly string[];
  /** Override for testing; defaults to the studio's own dev origins. */
  allowedOrigins?: readonly string[];
}

/**
 * Vite plugin factory. Thin wrapper: every request is validated by the pure
 * functions above (origin, token, allowlisted path) before any filesystem read
 * happens, and every rejection returns a generic message with detail logged
 * server-side only.
 */
export function createStudioFsBridgePlugin(options: CreateStudioFsBridgeOptions): Plugin {
  const { repoRoot, appRoot, manifestPath, allowedRoots, allowedOrigins = STUDIO_DEV_ORIGINS } = options;
  // Per-boot token: freshly generated each time the dev server starts, never persisted.
  const token = randomUUID();
  // Control relay (ADR-236) — same per-boot token; the port-scoped token file is how local
  // CLI/MCP clients authenticate. Disposed with the dev server below.
  const controlHub = new ControlHub();
  let controlRoutesPromise: Promise<ControlRoutes> | undefined;
  const controlRoutes = (): Promise<ControlRoutes> => {
    controlRoutesPromise ??= createControlRoutes(controlHub, token, writeControlTokenFile, removeControlTokenFile, {
      tokenDir: tmpdir(),
      port: 5273,
      allowedOrigins: allowedOrigins as readonly string[],
    });
    return controlRoutesPromise;
  };
  // Manifest resolution, started lazily on the first /__studio request and shared by every
  // request after — the dev server's equivalent of the standalone server's boot-time
  // resolution in server/main.ts. `null` when no appRoot was given (manifest-free tests).
  let manifestPromise: Promise<ResolvedManifest> | null = null;
  if (appRoot) {
    manifestPromise = resolveActiveManifest({ appRoot, manifestPath });
  }

  return {
    name: 'salir-prompt-studio-fs-bridge',
    // Dev-server only. `transformIndexHtml` below also runs during `vite build`, and without
    // this restriction the per-boot token would be baked into the static `dist/index.html` —
    // a single, permanently-valid token shipped inside a publicly published container image,
    // shared by every user who ever runs it. The real token must only ever exist per-request,
    // injected by the standalone server that serves the production build. Do not remove this
    // to "simplify" the plugin — that would reintroduce the vulnerability this comment guards.
    apply: 'serve',

    transformIndexHtml(): HtmlTagDescriptor[] {
      return [
        {
          tag: 'meta',
          injectTo: 'head-prepend',
          attrs: { name: 'studio-token', content: token },
        },
      ];
    },

    configureServer(server) {
      // EAGER creation (not first-request lazy): the token file must exist as soon as the dev
      // server boots, so a CLI run before any tab opens reports the real cause (no editor
      // connected, a 503) instead of a missing-token "is the studio running?" red herring.
      void controlRoutes().catch((error) => {
        console.error('[prompt-studio fs-bridge] control channel failed to start', error);
      });
      server.middlewares.use(async (req, res, next) => {
        // Control channel (ADR-236): the CLI/MCP relay shares this middleware with the bridge —
        // one host process, two gated surfaces. Created lazily (it writes the token file) and
        // cached; a creation failure degrades to "not here" rather than killing the dev server.
        if (req.url?.startsWith('/__control/')) {
          try {
            const control = await controlRoutes();
            const handled = await control.handle(req as never, res as never);
            if (!handled) sendJson(res, 404, { ok: false, error: 'Not found.' });
          } catch (error) {
            console.error('[prompt-studio fs-bridge] control channel unavailable', error);
            sendJson(res, 500, { ok: false, error: 'Control channel unavailable.' });
          }
          return;
        }

        if (!req.url?.startsWith('/__studio/')) {
          next();
          return;
        }

        if (new URL(req.url, 'http://localhost').pathname === '/__studio/session') {
          handleSessionRequest(req, res, token, allowedOrigins);
          return;
        }

        if (req.method !== 'GET') {
          sendJson(res, 405, { ok: false, error: 'Method not allowed.' });
          return;
        }

        if (!validateOrigin(firstHeaderValue(req.headers.origin), allowedOrigins)) {
          sendJson(res, 403, { ok: false, error: 'Forbidden.' });
          return;
        }

        if (!validateToken(firstHeaderValue(req.headers[STUDIO_TOKEN_HEADER]), token)) {
          sendJson(res, 401, { ok: false, error: 'Unauthorized.' });
          return;
        }

        const url = new URL(req.url, 'http://localhost');

        try {
          if (url.pathname === '/__studio/manifest') {
            if (!manifestPromise) {
              next();
              return;
            }
            const resolved = await manifestPromise;
            if (resolved.status !== 'ok') {
              console.error(`[prompt-studio fs-bridge] active manifest is invalid — ${resolved.detail}`);
              sendJson(res, 500, { ok: false, error: 'Studio manifest is invalid. See server logs.' });
              return;
            }
            sendJson(res, 200, { ok: true, manifest: resolved.manifest });
            return;
          }

          // Allowlist precedence: explicit test override > active manifest (when manifest
          // support is on) > the shipped ALLOWED_ROOTS. An INVALID manifest resolves to the
          // shipped default roots — never wider, never a crash (allowedRootsFor).
          const effectiveRoots =
            allowedRoots ?? (manifestPromise ? allowedRootsFor(await manifestPromise) : ALLOWED_ROOTS);

          if (url.pathname === '/__studio/list') {
            const dir = url.searchParams.get('dir') ?? '';
            const absDir = await resolvePermittedPath({
              repoRoot,
              requestedPath: dir,
              kind: 'dir',
              allowedRoots: effectiveRoots,
            });
            const entries = await listDirEntries(absDir);
            sendJson(res, 200, { ok: true, entries });
            return;
          }

          if (url.pathname === '/__studio/file') {
            const requestedPath = url.searchParams.get('path') ?? '';
            const absFile = await resolvePermittedPath({
              repoRoot,
              requestedPath,
              kind: 'file',
              allowedRoots: effectiveRoots,
            });
            const text = await readPermittedFile(absFile);
            sendJson(res, 200, { ok: true, path: requestedPath, text });
            return;
          }

          next();
        } catch (error) {
          if (error instanceof BridgeError) {
            if (error.detail) {
              console.error(`[prompt-studio fs-bridge] ${error.message} — ${error.detail}`);
            }
            sendJson(res, error.status, { ok: false, error: error.message });
            return;
          }
          console.error('[prompt-studio fs-bridge] unexpected error', error);
          sendJson(res, 500, { ok: false, error: 'Internal error.' });
        }
      });

      // Dev-server shutdown rejects pending control commands and removes the token file, so a
      // stale credential never outlives its boot.
      server.httpServer?.on('close', () => {
        void controlRoutesPromise?.then((control) => control.dispose()).catch(() => {});
      });
    },
  };
}
