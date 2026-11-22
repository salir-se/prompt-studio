// @vitest-environment node
// @module-tag pure
// Pure server-side path resolution — no DOM dependency, so this runs under plain Node rather than
// the app's default happy-dom environment (see main.test.ts for why that matters here).
import { describe, expect, it } from 'vitest';
import { contentTypeFor, resolveStaticAssetPath } from './static-files';

const STATIC_DIR = '/app/prompt-studio/dist';

describe('contentTypeFor', () => {
  it('maps known extensions', () => {
    expect(contentTypeFor('index.html')).toBe('text/html; charset=utf-8');
    expect(contentTypeFor('app.js')).toBe('text/javascript; charset=utf-8');
    expect(contentTypeFor('style.css')).toBe('text/css; charset=utf-8');
    expect(contentTypeFor('logo.svg')).toBe('image/svg+xml');
  });

  it('is case-insensitive on the extension', () => {
    expect(contentTypeFor('IMAGE.PNG')).toBe('image/png');
  });

  it('falls back to a generic binary type for an unknown extension', () => {
    expect(contentTypeFor('data.unknownext')).toBe('application/octet-stream');
  });
});

describe('resolveStaticAssetPath', () => {
  it('resolves an ordinary nested asset path inside staticDir', () => {
    expect(resolveStaticAssetPath(STATIC_DIR, '/assets/index-abc123.js')).toBe(`${STATIC_DIR}/assets/index-abc123.js`);
  });

  it('resolves the root path to staticDir itself', () => {
    expect(resolveStaticAssetPath(STATIC_DIR, '/')).toBe(STATIC_DIR);
  });

  it('rejects a literal ../ traversal', () => {
    expect(resolveStaticAssetPath(STATIC_DIR, '/../../etc/passwd')).toBeNull();
  });

  it('rejects a percent-encoded ../ traversal', () => {
    expect(resolveStaticAssetPath(STATIC_DIR, '/%2e%2e/%2e%2e/etc/passwd')).toBeNull();
  });

  it('treats a leading-slash request path as relative to staticDir, never as an OS-absolute path', () => {
    // Without the leading-slash strip, path.resolve(staticDir, '/etc/passwd') would discard
    // staticDir and return '/etc/passwd' outright. Stripped first, this safely resolves to a
    // nested (nonexistent) path inside staticDir instead of escaping it.
    expect(resolveStaticAssetPath(STATIC_DIR, '/etc/passwd')).toBe(`${STATIC_DIR}/etc/passwd`);
  });

  it('rejects a null byte in the request path', () => {
    expect(resolveStaticAssetPath(STATIC_DIR, '/good.js\0.evil')).toBeNull();
  });

  it('rejects malformed percent-encoding', () => {
    expect(resolveStaticAssetPath(STATIC_DIR, '/%')).toBeNull();
  });

  it('accepts a sibling directory whose name merely shares staticDir as a string prefix', () => {
    // Guards against the same isWithinRoot pitfall fs-bridge.test.ts exercises: naive
    // startsWith() containment would be fooled by a path like staticDirEVIL.
    expect(resolveStaticAssetPath(STATIC_DIR, `/../${STATIC_DIR.split('/').pop()}EVIL/leak.js`)).toBeNull();
  });
});
