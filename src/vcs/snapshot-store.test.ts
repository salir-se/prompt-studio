// @module-tag dom
/**
 * Level 1 unit tests for the two `SnapshotStore` implementations (ADR-203 decision 4 — see the
 * module doc in `./snapshot-store.ts`).
 *
 * `IndexedDbSnapshotStore`'s degrade-to-null/no-op failure path (missing `indexedDB` global) had NO
 * direct coverage before this file — it was only ever exercised incidentally, 96 times over, by
 * `App.test.tsx` booting the real App under happy-dom (which has no native `indexedDB`), spamming a
 * `console.warn` on every history commit. Per the observability-driven testing principle ("if
 * something matters enough to log in production, it matters enough to test"), that warning is a
 * genuine production log — not noise — so it is asserted here directly via `consoleBuffer`, and
 * `App.test.tsx` now installs a real (`fake-indexeddb`) `indexedDB` per test so it exercises the
 * happy path instead of tripping this same degrade path on every run.
 */

import { consoleBuffer, expectMilestone, expectNoMilestone } from '@prompt-studio/observability/test';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { IndexedDbSnapshotStore, MemorySnapshotStore } from './snapshot-store';

describe('MemorySnapshotStore', () => {
  it('returns null for a key that was never saved', async () => {
    const store = new MemorySnapshotStore();
    await expect(store.load('missing')).resolves.toBeNull();
  });

  it('round-trips a saved value', async () => {
    const store = new MemorySnapshotStore();
    await store.save('project:default', '{"heads":{}}');
    await expect(store.load('project:default')).resolves.toBe('{"heads":{}}');
  });

  it('keeps keys independent — saving one key never leaks into another', async () => {
    const store = new MemorySnapshotStore();
    await store.save('a', 'value-a');
    await store.save('b', 'value-b');
    await expect(store.load('a')).resolves.toBe('value-a');
    await expect(store.load('b')).resolves.toBe('value-b');
  });

  it('a fresh instance never shares state with another instance', async () => {
    const first = new MemorySnapshotStore();
    await first.save('shared-key', 'first-instance-value');
    const second = new MemorySnapshotStore();
    await expect(second.load('shared-key')).resolves.toBeNull();
  });
});

describe('IndexedDbSnapshotStore — real indexedDB (fake-indexeddb)', () => {
  const ORIGINAL_INDEXED_DB = globalThis.indexedDB;

  beforeEach(() => {
    Object.defineProperty(globalThis, 'indexedDB', { configurable: true, writable: true, value: new IDBFactory() });
  });

  afterEach(() => {
    Object.defineProperty(globalThis, 'indexedDB', {
      configurable: true,
      writable: true,
      value: ORIGINAL_INDEXED_DB,
    });
  });

  it('returns null for a key that was never saved', async () => {
    const store = new IndexedDbSnapshotStore();
    await expect(store.load('missing')).resolves.toBeNull();
  });

  it('round-trips a saved value through the real IndexedDB API', async () => {
    const store = new IndexedDbSnapshotStore();
    await store.save('project:default', '{"heads":{"scout":"abc123"}}');
    await expect(store.load('project:default')).resolves.toBe('{"heads":{"scout":"abc123"}}');
  });

  it('overwrites an existing value saved under the same key', async () => {
    const store = new IndexedDbSnapshotStore();
    await store.save('key', 'v1');
    await store.save('key', 'v2');
    await expect(store.load('key')).resolves.toBe('v2');
  });

  it('a second store instance reads what a first instance saved (same underlying database)', async () => {
    const writer = new IndexedDbSnapshotStore();
    await writer.save('shared-key', 'written-by-writer');
    const reader = new IndexedDbSnapshotStore();
    await expect(reader.load('shared-key')).resolves.toBe('written-by-writer');
  });

  it('logs no warning on the happy path', async () => {
    const store = new IndexedDbSnapshotStore();
    await store.save('key', 'value');
    await store.load('key');
    expectNoMilestone(consoleBuffer, { method: 'warn', includes: '[prompt-studio] history snapshot' });
  });
});

describe('IndexedDbSnapshotStore — degrades when indexedDB is unavailable (production behavior)', () => {
  const ORIGINAL_INDEXED_DB = globalThis.indexedDB;

  beforeEach(() => {
    Object.defineProperty(globalThis, 'indexedDB', { configurable: true, writable: true, value: undefined });
  });

  afterEach(() => {
    Object.defineProperty(globalThis, 'indexedDB', {
      configurable: true,
      writable: true,
      value: ORIGINAL_INDEXED_DB,
    });
  });

  it('load() resolves null and warns naming the operation, never throws', async () => {
    const store = new IndexedDbSnapshotStore();

    await expect(store.load('any-key')).resolves.toBeNull();
    expectMilestone(consoleBuffer, {
      method: 'warn',
      includes: '[prompt-studio] history snapshot load failed — treating the cache as absent',
    });
  });

  it('save() resolves without throwing and warns naming the operation', async () => {
    const store = new IndexedDbSnapshotStore();

    await expect(store.save('any-key', 'value')).resolves.toBeUndefined();
    expectMilestone(consoleBuffer, {
      method: 'warn',
      includes: '[prompt-studio] history snapshot save failed — treating the cache as absent',
    });
  });
});
