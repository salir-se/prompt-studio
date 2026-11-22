import path from 'node:path';
import { isWithinRoot } from '../src/bridge/fs-bridge';

/**
 * Static asset serving for the built SPA. Path-containment reuses fs-bridge's `isWithinRoot`
 * boundary check rather than re-implementing it — the same string-prefix pitfall it guards
 * against in the repo-file bridge (a sibling directory whose name happens to start with the
 * root's name) applies equally here.
 */

const CONTENT_TYPES: Readonly<Record<string, string>> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.map': 'application/json; charset=utf-8',
  '.wasm': 'application/wasm',
  '.txt': 'text/plain; charset=utf-8',
};

/** Content-Type for a static asset, keyed by extension. Unknown extensions get a safe generic default. */
export function contentTypeFor(filePath: string): string {
  return CONTENT_TYPES[path.extname(filePath).toLowerCase()] ?? 'application/octet-stream';
}

/**
 * Resolves a request path to an absolute file path inside `staticDir`, or `null` if it would
 * read outside it (path traversal) or is otherwise malformed.
 *
 * The leading `/`(s) MUST be stripped before `path.resolve`: `path.resolve(staticDir, '/etc/passwd')`
 * discards `staticDir` entirely because `path.resolve` treats an absolute second argument as the
 * final answer — stripping first is what makes the request path resolve AGAINST `staticDir`
 * instead of replacing it. `isWithinRoot` is still the actual containment check afterwards; the
 * strip is only there to keep `path.resolve` from throwing that containment check away outright.
 */
export function resolveStaticAssetPath(staticDir: string, requestPath: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(requestPath);
  } catch {
    return null; // malformed percent-encoding
  }
  if (decoded.includes('\0')) {
    return null;
  }
  const relative = decoded.replace(/^\/+/, '');
  const target = path.resolve(staticDir, relative);
  return isWithinRoot(staticDir, target) ? target : null;
}
