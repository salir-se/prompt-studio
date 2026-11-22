// @module-tag dom
/**
 * `GitHistoryProvider` tests: the shared interface contract (the same suite the simple provider
 * runs, verbatim) plus git-specific behaviors — real oids as commit ids, trailer/newline hygiene in
 * reported messages, the base64 persistence round trip that guards against the `toJSON` utf8
 * corruption gotcha (spike-proven), the project-archive layout, and multi-boot restore.
 */

import { describe, expect, it } from 'vitest';
import { createGitHistoryProvider, GIT_HISTORY_SNAPSHOT_KEY } from './git-history-provider';
import { runHistoryProviderContractTests } from './history-provider.contract';
import { MemorySnapshotStore } from './snapshot-store';

/** Deterministic strictly-increasing clock — stable, distinct commit timestamps per test. */
function makeClock(): () => number {
  let tick = 0;
  return () => {
    tick += 1000;
    return tick;
  };
}

// Contract suite: fresh provider per call, ONE shared (initially empty) store across calls — the
// exact `makeProvider` shape `history-provider.contract.ts` documents.
const contractStore = new MemorySnapshotStore();
runHistoryProviderContractTests('git', async () => createGitHistoryProvider(contractStore, { now: makeClock() }));

const BASELINE = new Map([['scout', 'Scout baseline text.']]);

/** A fresh provider on its own store, baseline seeded — the starting point of most specifics. */
async function seededProvider(store = new MemorySnapshotStore()) {
  const provider = createGitHistoryProvider(store, { now: makeClock() });
  await provider.init(BASELINE);
  return provider;
}

describe('GitHistoryProvider specifics', () => {
  it('uses real 40-hex git oids as commit ids', async () => {
    const provider = await seededProvider();
    const project = await provider.createProject('Oids');
    const ref = await provider.commit({ projectId: project.id, rootKey: 'scout', text: 'Scout v1.', message: 'edit' });

    expect(ref.id).toMatch(/^[0-9a-f]{40}$/);
    const log = await provider.history(project.id);
    expect(log.length).toBeGreaterThanOrEqual(2); // The edit plus the baseline seed.
    expect(log.every((entry) => /^[0-9a-f]{40}$/.test(entry.id))).toBe(true);
  });

  it('reports messages without the Root-Key trailer and without a trailing newline', async () => {
    const provider = await seededProvider();
    const project = await provider.createProject('Messages');
    await provider.commit({ projectId: project.id, rootKey: 'scout', text: 'Scout v1.', message: 'edit scout' });

    const log = await provider.history(project.id);
    expect(log[0].message).toBe('edit scout');
    expect(log.at(-1)?.message).toBe('baseline');
    for (const entry of log) {
      expect(entry.message).not.toContain('Root-Key');
      expect(entry.message.endsWith('\n')).toBe(false);
    }
  });

  it('round-trips git objects intact through base64 persistence (toJSON corruption regression)', async () => {
    const store = new MemorySnapshotStore();
    const first = await seededProvider(store);
    const seedId = (await first.history('baseline', 'scout'))[0].id;
    await first.persist();

    const second = createGitHistoryProvider(store, { now: makeClock() });
    expect(await second.restore()).toBe(true);
    // Reading a blob at a specific commit exercises the restored object store end to end — a
    // corrupted (utf8-mangled) .git object would fail to inflate here.
    expect(await second.readTextAt('baseline', seedId, 'scout')).toBe('Scout baseline text.');
    expect(await second.heads('baseline')).toEqual(BASELINE);
  });

  it('a second instance restoring the same store sees identical state and can keep committing', async () => {
    const store = new MemorySnapshotStore();
    const first = await seededProvider(store);
    const project = await first.createProject('Boot');
    await first.commit({ projectId: project.id, rootKey: 'scout', text: 'Scout v1.', message: 'before reboot' });
    await first.persist();

    const second = createGitHistoryProvider(store, { now: makeClock() });
    expect(await second.restore()).toBe(true);
    expect(await second.listProjects()).toEqual(await first.listProjects());
    expect(await second.heads(project.id)).toEqual(await first.heads(project.id));
    // The restored repo must be writable, not just readable — proves the volume swap is complete.
    await second.commit({ projectId: project.id, rootKey: 'scout', text: 'Scout v2.', message: 'after reboot' });
    expect((await second.heads(project.id)).get('scout')).toBe('Scout v2.');
  });

  it('exportArchive nests the whole repo under prompt-project-<slug>/ with base64-marked binaries', async () => {
    const provider = await seededProvider();
    const project = await provider.createProject('Alpha');
    await provider.commit({ projectId: project.id, rootKey: 'scout', text: 'Scout v1.', message: 'edit' });

    const archive = await provider.exportArchive(project.id);
    const paths = Object.keys(archive);
    expect(paths.every((path) => path.startsWith('prompt-project-alpha/'))).toBe(true);
    expect(archive['prompt-project-alpha/roots/scout.md']).toBe('Scout v1.');
    // The archive is "the zip of the repo": .git travels with it, binaries under a .b64 suffix.
    expect(paths.some((path) => path.includes('/.git/'))).toBe(true);
    expect(paths.some((path) => path.endsWith('.b64'))).toBe(true);

    const meta = JSON.parse(archive['prompt-project-alpha/project.json']);
    expect(meta.id).toBe('alpha');
    expect(meta.name).toBe('Alpha');
    expect(meta.head).toMatch(/^[0-9a-f]{40}$/);
  });

  it('restore returns false for corrupt JSON in the snapshot', async () => {
    const store = new MemorySnapshotStore();
    await store.save(GIT_HISTORY_SNAPSHOT_KEY, '{ not json');
    expect(await createGitHistoryProvider(store).restore()).toBe(false);
  });

  it('restore returns false when the envelope carries an unknown extra key (arktype reject)', async () => {
    const store = new MemorySnapshotStore();
    const writer = await seededProvider(store);
    await writer.persist();
    // Build a genuinely valid snapshot first, so ONLY the extra key can be the reason for rejection.
    const valid = JSON.parse((await store.load(GIT_HISTORY_SNAPSHOT_KEY)) ?? '');
    await store.save(GIT_HISTORY_SNAPSHOT_KEY, JSON.stringify({ ...valid, smuggled: true }));

    expect(await createGitHistoryProvider(store).restore()).toBe(false);
  });

  it('restore returns false for a schema-valid envelope whose repo cannot answer git.log', async () => {
    const store = new MemorySnapshotStore();
    // Shape-valid but git-empty: the post-validation baseline log probe must reject it.
    await store.save(GIT_HISTORY_SNAPSHOT_KEY, JSON.stringify({ files: {}, projects: {} }));
    expect(await createGitHistoryProvider(store).restore()).toBe(false);
  });
});
