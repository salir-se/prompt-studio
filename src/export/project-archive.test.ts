// @module-tag dom
/**
 * Tests for `project-archive.ts` — ADR-203 decision 5's save-file flavor. The round-trip suite runs
 * against BOTH real `HistoryProvider` implementations (never a hand-rolled archive map): the git
 * provider already nests its export under `prompt-project-<slug>/`, the simple provider returns
 * unprefixed paths, and `buildProjectArchive` must make both land as the SAME structure — packed,
 * unpacked with the widened project limits, detected, and read back to the committed heads.
 */

import { describe, expect, it } from 'vitest';
import { createGitHistoryProvider } from '../vcs/git-history-provider';
import type { HistoryProvider } from '../vcs/history-provider';
import { SimpleHistoryProvider } from '../vcs/simple-history-provider';
import { MemorySnapshotStore } from '../vcs/snapshot-store';
import {
  buildProjectArchive,
  isProjectArchive,
  PROJECT_ARCHIVE_ZIP_LIMITS,
  ProjectArchiveError,
  readProjectArchiveHeads,
} from './project-archive';
import { packZip, unpackZip, ZipImportError } from './zip';

/** Deterministic strictly-increasing clock so commit ids/timestamps never depend on wall time. */
function tickingClock(): () => number {
  let t = 1_700_000_000_000;
  return () => {
    t += 1000;
    return t;
  };
}

const BASELINE_TEXTS = new Map([
  ['scout', 'scout baseline text'],
  ['closer', 'closer baseline text'],
]);

/** Seeds a provider with two roots, one project ('road-trip'), and a couple of commits. */
async function seedProject(provider: HistoryProvider): Promise<void> {
  await provider.init(BASELINE_TEXTS);
  await provider.createProject('Road Trip');
  await provider.commit({ projectId: 'road-trip', rootKey: 'scout', text: 'scout edited once', message: 'edit 1' });
  await provider.commit({ projectId: 'road-trip', rootKey: 'scout', text: 'scout edited twice', message: 'edit 2' });
  await provider.commit({ projectId: 'road-trip', rootKey: 'closer', text: 'closer edited', message: 'edit 3' });
}

describe('PROJECT_ARCHIVE_ZIP_LIMITS', () => {
  it('pins the widened project-archive bounds (git object churn is entry-heavy)', () => {
    expect(PROJECT_ARCHIVE_ZIP_LIMITS).toEqual({
      maxEntries: 4096,
      maxEntryBytes: 8 * 1024 * 1024,
      maxTotalBytes: 64 * 1024 * 1024,
    });
  });

  it('still rejects an entry bomb past the widened bound, pre-inflation', () => {
    const files: Record<string, string> = {};
    for (let index = 0; index <= PROJECT_ARCHIVE_ZIP_LIMITS.maxEntries; index += 1) {
      files[`prompt-project-bomb/f${index}`] = '';
    }
    // Pack once and reuse: packing 4097 entries is the expensive part, and doing it twice (once per
    // assertion) is pure waste that doubles this test's CPU cost for no extra coverage.
    const bombBytes = packZip(files);
    expect(() => unpackZip(bombBytes, PROJECT_ARCHIVE_ZIP_LIMITS)).toThrow(ZipImportError);
    expect(() => unpackZip(bombBytes, PROJECT_ARCHIVE_ZIP_LIMITS)).toThrow(/more than 4096 entries/);
  });
});

describe.each([
  {
    label: 'simple',
    make: (): HistoryProvider =>
      new SimpleHistoryProvider({ snapshotStore: new MemorySnapshotStore(), now: tickingClock() }),
  },
  {
    label: 'git',
    make: (): HistoryProvider => createGitHistoryProvider(new MemorySnapshotStore(), { now: tickingClock() }),
  },
])('buildProjectArchive round-trip ($label provider)', ({ label, make }) => {
  it('build → unpack → detect → heads recovers the committed heads and the display name', async () => {
    const provider = make();
    await seedProject(provider);

    const { bytes, filename } = await buildProjectArchive(provider, 'road-trip', 'Road Trip');
    expect(filename).toBe('prompt-project-road-trip.zip');

    const files = unpackZip(bytes, PROJECT_ARCHIVE_ZIP_LIMITS);
    expect(isProjectArchive(files)).toBe(true);
    // Both flavors nest identically — including the provider that exports unprefixed paths.
    for (const path of Object.keys(files)) {
      expect(path.startsWith('prompt-project-road-trip/')).toBe(true);
    }
    if (label === 'git') {
      // The save-file is "the zip of the repo": .git travels inside the fence, never at the top.
      expect(Object.keys(files).some((path) => path.startsWith('prompt-project-road-trip/.git/'))).toBe(true);
    }

    const { name, heads } = readProjectArchiveHeads(files);
    expect(name).toBe('Road Trip');
    expect(heads.get('scout')).toBe('scout edited twice');
    expect(heads.get('closer')).toBe('closer edited');
    expect(heads.size).toBe(2);
  });
});

describe('buildProjectArchive fallback descriptor', () => {
  it('synthesizes a minimal project.json when a provider archive carries none', async () => {
    const provider = {
      exportArchive: async () => ({ 'notes.txt': 'free-form provider payload' }),
    } as Partial<HistoryProvider> as HistoryProvider;

    const { bytes } = await buildProjectArchive(provider, 'bare', 'Bare Project');
    const files = unpackZip(bytes, PROJECT_ARCHIVE_ZIP_LIMITS);

    expect(isProjectArchive(files)).toBe(true);
    const { name, heads } = readProjectArchiveHeads(files);
    expect(name).toBe('Bare Project');
    expect(heads.size).toBe(0);
  });
});

describe('isProjectArchive', () => {
  it('rejects overlay-shaped, mixed, unprefixed, and empty file maps', () => {
    expect(isProjectArchive({})).toBe(false);
    // Overlay blueprints put files at the archive root — the exact confusion the fence prevents.
    expect(isProjectArchive({ 'prompt.md': 'x', 'manifest.json': 'y' })).toBe(false);
    // A top-level FILE named like the fence directory is still not a nested save-file.
    expect(isProjectArchive({ 'prompt-project-a': 'x' })).toBe(false);
    // Two top-level project directories — not a SINGLE project save-file.
    expect(isProjectArchive({ 'prompt-project-a/x': '', 'prompt-project-b/y': '' })).toBe(false);
    // Mixed tops: one nested entry does not make the whole map a project archive.
    expect(isProjectArchive({ 'prompt-project-a/x': '', 'other/y': '' })).toBe(false);
    expect(isProjectArchive({ 'project-a/x': '' })).toBe(false);
  });

  it('accepts a map fully nested under one prompt-project-*/ directory', () => {
    expect(isProjectArchive({ 'prompt-project-a/project.json': '{}', 'prompt-project-a/roots/scout.md': 'x' })).toBe(
      true,
    );
  });
});

describe('readProjectArchiveHeads malformed archives', () => {
  it('throws a named error for a non-project-shaped map', () => {
    expect(() => readProjectArchiveHeads({ 'prompt.md': 'x' })).toThrow(ProjectArchiveError);
    expect(() => readProjectArchiveHeads({ 'prompt.md': 'x' })).toThrow(/prompt-project-<slug>/);
  });

  it('throws naming project.json when it is missing, unparsable, or shape-rejected', () => {
    expect(() => readProjectArchiveHeads({ 'prompt-project-a/roots/scout.md': 'x' })).toThrow(
      /missing 'prompt-project-a\/project\.json'/,
    );
    expect(() => readProjectArchiveHeads({ 'prompt-project-a/project.json': 'not json' })).toThrow(
      /'prompt-project-a\/project\.json' is not valid JSON/,
    );
    // Strict per-flavor union: an extra key on an otherwise-valid git descriptor rejects.
    const extraKey = JSON.stringify({ id: 'a', name: 'A', head: 'abc', extra: true });
    expect(() => readProjectArchiveHeads({ 'prompt-project-a/project.json': extraKey })).toThrow(
      /'prompt-project-a\/project\.json' is not a valid project descriptor/,
    );
    // Neither flavor: no head and no heads.
    const neither = JSON.stringify({ id: 'a', name: 'A' });
    expect(() => readProjectArchiveHeads({ 'prompt-project-a/project.json': neither })).toThrow(ProjectArchiveError);
  });

  it('throws naming history/blobs.json when the simple flavor blob map is missing or incomplete', () => {
    const descriptor = JSON.stringify({ id: 'a', name: 'A', heads: { scout: 'deadbeef' } });
    expect(() => readProjectArchiveHeads({ 'prompt-project-a/project.json': descriptor })).toThrow(
      /missing 'prompt-project-a\/history\/blobs\.json'/,
    );
    expect(() =>
      readProjectArchiveHeads({
        'prompt-project-a/project.json': descriptor,
        'prompt-project-a/history/blobs.json': '{}',
      }),
    ).toThrow(/'prompt-project-a\/history\/blobs\.json' is missing blob deadbeef for root "scout"/);
  });

  it('throws naming the root file when a git-flavor root arrives as binary (.b64) instead of text', () => {
    const descriptor = JSON.stringify({ id: 'a', name: 'A', head: 'abc' });
    expect(() =>
      readProjectArchiveHeads({
        'prompt-project-a/project.json': descriptor,
        'prompt-project-a/roots/scout.md.b64': 'AAEC',
      }),
    ).toThrow(/'prompt-project-a\/roots\/scout\.md\.b64' is not utf-8 text/);
  });
});
