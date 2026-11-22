// @module-tag dom
import { strToU8, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { DEFAULT_ZIP_LIMITS, packZip, unpackZip, ZipImportError, type ZipImportErrorCode, type ZipLimits } from './zip';

/** Runs `fn`, asserts it threw a `ZipImportError` with exactly `code`, and that nothing was returned. */
function expectZipError(fn: () => unknown, code: ZipImportErrorCode): ZipImportError {
  let returned: unknown;
  let caught: unknown;
  try {
    returned = fn();
  } catch (error) {
    caught = error;
  }
  expect(returned, 'unpackZip must not return content for a rejected archive').toBeUndefined();
  expect(caught).toBeInstanceOf(ZipImportError);
  const zipError = caught as ZipImportError;
  expect(zipError.code).toBe(code);
  return zipError;
}

describe('packZip / unpackZip round-trip', () => {
  it('round-trips a multi-file map with nested paths, unicode content, and an empty file', () => {
    const files = {
      'README.md': '# Prompt Studio export\n',
      'prompts/scout/system.md': 'Score signals 0-100 for delegation readiness.',
      'prompts/closer/nested/deep.txt': 'Héllo 🎉 — svenska åäö, 中文, עברית',
      'empty.md': '',
    };
    expect(unpackZip(packZip(files))).toEqual(files);
  });

  it('produces byte-identical archives for the same input map (deterministic mtime)', () => {
    const files = { 'a.md': 'alpha', 'dir/b.md': 'beta' };
    const first = packZip(files);
    const second = packZip(files);
    expect(second).toEqual(first);
    expect(Array.from(second)).toEqual(Array.from(first));
  });
});

describe('unpackZip path hardening', () => {
  it("rejects a '..' traversal entry with code 'unsafe-path'", () => {
    const bytes = zipSync({ '../evil.md': strToU8('pwned') });
    expectZipError(() => unpackZip(bytes), 'unsafe-path');
  });

  it("rejects a nested '..' path segment with code 'unsafe-path'", () => {
    const bytes = zipSync({ 'docs/../../evil.md': strToU8('pwned') });
    expectZipError(() => unpackZip(bytes), 'unsafe-path');
  });

  it("rejects an absolute path entry with code 'unsafe-path'", () => {
    const bytes = zipSync({ '/abs.md': strToU8('pwned') });
    expectZipError(() => unpackZip(bytes), 'unsafe-path');
  });

  it("rejects a backslash-separated entry with code 'unsafe-path'", () => {
    const bytes = zipSync({ 'a\\b.md': strToU8('pwned') });
    expectZipError(() => unpackZip(bytes), 'unsafe-path');
  });

  it("rejects an entry name containing a control character with code 'unsafe-path'", () => {
    const bytes = zipSync({ 'evil\u0001.md': strToU8('pwned') });
    expectZipError(() => unpackZip(bytes), 'unsafe-path');
  });

  it('skips directory entries (trailing slash) silently instead of erroring', () => {
    const bytes = zipSync({
      'dir/': new Uint8Array(0),
      'dir/keep.md': strToU8('kept'),
    });
    expect(unpackZip(bytes)).toEqual({ 'dir/keep.md': 'kept' });
  });
});

describe('unpackZip resource limits', () => {
  const tinyLimits: ZipLimits = { maxEntries: 2, maxEntryBytes: 64, maxTotalBytes: 100 };

  it("rejects an archive with more entries than maxEntries with code 'too-many-entries'", () => {
    const bytes = packZip({ 'a.md': '1', 'b.md': '2', 'c.md': '3' });
    expectZipError(() => unpackZip(bytes, tinyLimits), 'too-many-entries');
  });

  it("rejects a single entry inflating past maxEntryBytes with code 'entry-too-large'", () => {
    const bytes = packZip({ 'big.md': 'x'.repeat(200) });
    expectZipError(() => unpackZip(bytes, tinyLimits), 'entry-too-large');
  });

  it("rejects an archive whose cumulative inflated size passes maxTotalBytes with code 'archive-too-large'", () => {
    const bytes = packZip({ 'a.md': 'x'.repeat(60), 'b.md': 'y'.repeat(60) });
    expectZipError(() => unpackZip(bytes, tinyLimits), 'archive-too-large');
  });

  it('exposes the documented default limits', () => {
    expect(DEFAULT_ZIP_LIMITS).toEqual({
      maxEntries: 256,
      maxEntryBytes: 4 * 1024 * 1024,
      maxTotalBytes: 16 * 1024 * 1024,
    });
  });
});

describe('unpackZip on non-ZIP bytes', () => {
  it("rejects random bytes with code 'not-a-zip'", () => {
    const garbage = new Uint8Array(64);
    for (let index = 0; index < garbage.length; index += 1) {
      garbage[index] = (index * 37 + 7) % 256;
    }
    expectZipError(() => unpackZip(garbage), 'not-a-zip');
  });

  it("rejects a truncated valid archive with code 'not-a-zip'", () => {
    const valid = packZip({ 'a.md': 'alpha', 'b.md': 'beta' });
    const truncated = valid.slice(0, valid.length - 10);
    expectZipError(() => unpackZip(truncated), 'not-a-zip');
  });
});
