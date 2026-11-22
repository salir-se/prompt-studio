// @module-tag dom
/**
 * Factory selection tests (ADR-203): `'simple'` and `'git'` are explicit choices — the latter fails
 * loudly when the git provider isn't available — while `'auto'` is the safe-fallback path that
 * degrades to `SimpleHistoryProvider` with a reported reason on ANY git failure.
 */

import { describe, expect, it, vi } from 'vitest';
import { createHistoryProvider } from './history-factory';
import type { HistoryProvider } from './history-provider';
import { SimpleHistoryProvider } from './simple-history-provider';
import { MemorySnapshotStore } from './snapshot-store';

/** Method-free stand-in — the factory only constructs and returns it, so no behavior is needed. */
const fakeGitProvider = { kind: 'git' } as unknown as HistoryProvider;

function deps() {
  return { snapshotStore: new MemorySnapshotStore(), onDegrade: vi.fn() };
}

describe('createHistoryProvider', () => {
  it("'simple' returns the SimpleHistoryProvider", async () => {
    const provider = await createHistoryProvider('simple', deps());
    expect(provider).toBeInstanceOf(SimpleHistoryProvider);
    expect(provider.kind).toBe('simple');
  });

  it("'git' without a loader hook rejects — an explicit choice never silently degrades", async () => {
    await expect(createHistoryProvider('git', deps())).rejects.toThrow('git provider not wired yet');
  });

  it("'git' with a working hook returns the loaded provider", async () => {
    const provider = await createHistoryProvider('git', {
      ...deps(),
      loadGitProvider: async () => ({ createGitHistoryProvider: () => fakeGitProvider }),
    });
    expect(provider).toBe(fakeGitProvider);
  });

  it("'auto' without a loader hook degrades to simple and reports the reason", async () => {
    const d = deps();
    const provider = await createHistoryProvider('auto', d);
    expect(provider).toBeInstanceOf(SimpleHistoryProvider);
    expect(d.onDegrade).toHaveBeenCalledExactlyOnceWith('git provider not wired yet');
  });

  it("'auto' with a throwing hook degrades to simple and reports the error message", async () => {
    const d = deps();
    const provider = await createHistoryProvider('auto', {
      ...d,
      loadGitProvider: async () => {
        throw new Error('boom: Buffer is not defined');
      },
    });
    expect(provider).toBeInstanceOf(SimpleHistoryProvider);
    expect(d.onDegrade).toHaveBeenCalledExactlyOnceWith('boom: Buffer is not defined');
  });

  it("'auto' degrades even when the loaded module's constructor throws", async () => {
    const d = deps();
    const provider = await createHistoryProvider('auto', {
      ...d,
      loadGitProvider: async () => ({
        createGitHistoryProvider: () => {
          throw new Error('init failed');
        },
      }),
    });
    expect(provider).toBeInstanceOf(SimpleHistoryProvider);
    expect(d.onDegrade).toHaveBeenCalledExactlyOnceWith('init failed');
  });

  it("'auto' with a working hook returns the git provider and never degrades", async () => {
    const d = deps();
    const provider = await createHistoryProvider('auto', {
      ...d,
      loadGitProvider: async () => ({ createGitHistoryProvider: () => fakeGitProvider }),
    });
    expect(provider).toBe(fakeGitProvider);
    expect(d.onDegrade).not.toHaveBeenCalled();
  });
});
