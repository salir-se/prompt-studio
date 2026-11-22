// @module-tag dom
/**
 * `SimpleHistoryProvider` tests: the shared interface contract (which the git provider will reuse
 * verbatim) plus behaviors specific to this implementation — content-address dedup, snapshot
 * validation strictness, and slug derivation.
 */

import { describe, expect, it } from 'vitest';
import { runHistoryProviderContractTests } from './history-provider.contract';
import { SIMPLE_HISTORY_SNAPSHOT_KEY, SimpleHistoryProvider } from './simple-history-provider';
import { MemorySnapshotStore } from './snapshot-store';

/** Deterministic strictly-increasing clock — stable timestamps AND distinct commit ids per test. */
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
runHistoryProviderContractTests(
  'SimpleHistoryProvider',
  async () => new SimpleHistoryProvider({ snapshotStore: contractStore, now: makeClock() }),
);

function makeProvider(store = new MemorySnapshotStore()): SimpleHistoryProvider {
  return new SimpleHistoryProvider({ snapshotStore: store, now: makeClock() });
}

const BASELINE = new Map([['scout', 'Scout baseline text.']]);

describe('SimpleHistoryProvider specifics', () => {
  it('content-addresses blobs: committing identical text twice stores one blob', async () => {
    const provider = makeProvider();
    await provider.init(BASELINE);
    const project = await provider.createProject('Dedup');
    await provider.commit({ projectId: project.id, rootKey: 'scout', text: 'Same text.', message: 'first' });
    await provider.commit({ projectId: project.id, rootKey: 'scout', text: 'Same text.', message: 'second' });

    // Two commits landed, but the identical text resolves to one content-addressed blob —
    // observable through the archive: baseline text + the deduped text = exactly two blobs.
    expect(await provider.history(project.id, 'scout')).toHaveLength(3);
    const archive = await provider.exportArchive(project.id);
    expect(Object.keys(JSON.parse(archive['history/blobs.json']))).toHaveLength(2);
  });

  it('restore returns false for corrupt JSON in the snapshot', async () => {
    const store = new MemorySnapshotStore();
    await store.save(SIMPLE_HISTORY_SNAPSHOT_KEY, '{ not json');
    expect(await makeProvider(store).restore()).toBe(false);
  });

  it('restore returns false when the snapshot carries an unknown extra key (arktype reject)', async () => {
    const store = new MemorySnapshotStore();
    // Build a genuinely valid snapshot first, so ONLY the extra key can be the reason for rejection.
    const writer = makeProvider(store);
    await writer.init(BASELINE);
    await writer.persist();
    const valid = JSON.parse((await store.load(SIMPLE_HISTORY_SNAPSHOT_KEY)) ?? '');
    await store.save(SIMPLE_HISTORY_SNAPSHOT_KEY, JSON.stringify({ ...valid, smuggled: true }));

    expect(await makeProvider(store).restore()).toBe(false);
  });

  it('derives unique slugs from names, suffixing collisions', async () => {
    const provider = makeProvider();
    await provider.init(BASELINE);
    const first = await provider.createProject('My Project!');
    const second = await provider.createProject('my   project');
    expect(first.id).toBe('my-project');
    expect(second.id).toBe('my-project-2');
  });
});
