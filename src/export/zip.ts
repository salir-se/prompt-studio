import type { Zippable } from 'fflate';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';

/**
 * Salir Prompt Studio ZIP byte layer (ADR-202 §9).
 *
 * SECURITY BOUNDARY. The studio exports a ZIP that overlays the repository, and import
 * treats every ZIP as UNTRUSTED INPUT: an attacker-crafted archive can carry path
 * traversal entries (`../`), absolute paths, backslash separators, entry bombs
 * (thousands of entries) and decompression bombs (tiny archive, huge inflated size).
 * This module is the only place archive bytes are parsed, and every attack class above
 * is rejected with a NAMED reason (`ZipImportError.code`) instead of being extracted.
 *
 * Hardening runs BEFORE inflation wherever fflate allows: `unzipSync`'s `filter`
 * callback sees each entry's name and declared `originalSize` before that entry is
 * inflated, so entry-count, per-entry-size, cumulative-size, and path-safety checks
 * all reject without ever decompressing the offending entry. Only entries that pass
 * every check are inflated and decoded.
 *
 * BYTES ONLY: this layer packs/unpacks `Record<string, string>` file maps. What the
 * paths and contents mean (serialization semantics, repo overlay rules) lives in a
 * sibling module — nothing here interprets them, and nothing here touches the
 * filesystem.
 */

/** Named reasons an untrusted archive can be rejected. */
export type ZipImportErrorCode =
  'not-a-zip' | 'too-many-entries' | 'entry-too-large' | 'archive-too-large' | 'unsafe-path';

/**
 * Thrown for every rejection `unpackZip` can produce. `code` is the stable, named
 * reason callers branch on; `message` is a human-readable one-liner safe to surface
 * in the studio UI.
 */
export class ZipImportError extends Error {
  readonly code: ZipImportErrorCode;

  constructor(code: ZipImportErrorCode, message: string) {
    super(message);
    this.name = 'ZipImportError';
    this.code = code;
  }
}

/** Resource bounds applied to an untrusted archive before inflation. */
export interface ZipLimits {
  readonly maxEntries: number;
  readonly maxEntryBytes: number;
  readonly maxTotalBytes: number;
}

/** Defaults sized for prompt/skill file maps: 256 files, 4 MiB each, 16 MiB total uncompressed. */
export const DEFAULT_ZIP_LIMITS: ZipLimits = {
  maxEntries: 256,
  maxEntryBytes: 4 * 1024 * 1024,
  maxTotalBytes: 16 * 1024 * 1024,
};

/**
 * Fixed per-entry mtime so packing the same map twice yields byte-identical output.
 * fflate rejects timestamps before 1980 (the ZIP epoch), so `0`/1970 is not usable;
 * the local-time constructor pins the exact date fields DOS timestamps are written
 * from, keeping the bytes stable across time zones too.
 */
const FIXED_PACK_MTIME = new Date(2000, 0, 1);

/**
 * Packs a file map into ZIP bytes. REPRODUCIBLE: every entry's mtime is pinned to
 * `FIXED_PACK_MTIME` (the only nondeterministic input fflate would otherwise use is
 * `Date.now()`), so identical maps produce identical archives.
 */
export function packZip(files: Readonly<Record<string, string>>): Uint8Array {
  const zippable: Zippable = {};
  for (const [name, content] of Object.entries(files)) {
    zippable[name] = [strToU8(content), { mtime: FIXED_PACK_MTIME }];
  }
  return zipSync(zippable);
}

/** Character-code scan instead of a regex so the control-character range is lint-safe and explicit. */
function hasControlCharacter(name: string): boolean {
  for (let index = 0; index < name.length; index += 1) {
    if (name.charCodeAt(index) < 0x20) {
      return true;
    }
  }
  return false;
}

/**
 * Rejects every entry name that could escape or confuse the overlay target:
 * empty names, absolute paths, backslash separators (Windows traversal spelling),
 * control characters, and any `..` path segment.
 */
function assertSafeEntryName(name: string): void {
  if (name === '') {
    throw new ZipImportError('unsafe-path', 'Archive contains an entry with an empty name.');
  }
  if (name.startsWith('/')) {
    throw new ZipImportError('unsafe-path', `Archive entry uses an absolute path: ${name}`);
  }
  if (name.includes('\\')) {
    throw new ZipImportError('unsafe-path', `Archive entry contains a backslash: ${name}`);
  }
  if (hasControlCharacter(name)) {
    throw new ZipImportError('unsafe-path', 'Archive entry name contains a control character.');
  }
  if (name.split('/').some((segment) => segment === '..')) {
    throw new ZipImportError('unsafe-path', `Archive entry contains a '..' path segment: ${name}`);
  }
}

/**
 * Unpacks untrusted ZIP bytes into a file map, enforcing `limits` before inflation.
 *
 * All hardening runs inside `unzipSync`'s `filter` callback, which fflate invokes per
 * entry — with the declared name and uncompressed size — before inflating that entry:
 * entry counting, per-entry size, cumulative size, and name safety therefore reject
 * without decompressing anything past the violation. Directory entries (trailing `/`)
 * are skipped silently, never extracted and never an error. Genuine parse failures on
 * non-ZIP or truncated bytes surface as `not-a-zip`; a `ZipImportError` thrown inside
 * the filter is re-thrown intact even if fflate wraps or re-surfaces it.
 */
export function unpackZip(bytes: Uint8Array, limits: ZipLimits = DEFAULT_ZIP_LIMITS): Record<string, string> {
  let entryCount = 0;
  let totalBytes = 0;
  let unzipped: Record<string, Uint8Array>;
  try {
    unzipped = unzipSync(bytes, {
      filter: (entry) => {
        if (entry.name.endsWith('/')) {
          return false;
        }
        entryCount += 1;
        if (entryCount > limits.maxEntries) {
          throw new ZipImportError('too-many-entries', `Archive has more than ${limits.maxEntries} entries.`);
        }
        if (entry.originalSize > limits.maxEntryBytes) {
          throw new ZipImportError(
            'entry-too-large',
            `Archive entry '${entry.name}' inflates to ${entry.originalSize} bytes (limit ${limits.maxEntryBytes}).`,
          );
        }
        totalBytes += entry.originalSize;
        if (totalBytes > limits.maxTotalBytes) {
          throw new ZipImportError(
            'archive-too-large',
            `Archive inflates past ${limits.maxTotalBytes} bytes in total.`,
          );
        }
        assertSafeEntryName(entry.name);
        return true;
      },
    });
  } catch (error) {
    if (error instanceof ZipImportError) {
      throw error;
    }
    throw new ZipImportError('not-a-zip', 'Input is not a valid ZIP archive.');
  }

  const files: Record<string, string> = {};
  for (const [name, data] of Object.entries(unzipped)) {
    files[name] = strFromU8(data);
  }
  return files;
}
