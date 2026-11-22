// @module-tag dom
import { beforeEach, describe, expect, it } from 'vitest';
import {
  createIndexedDbHistoryStore,
  createMemoryHistoryStore,
  type HelpHistoryStore,
  type HelpMessage,
} from './history';

const msg = (id: string, over: Partial<HelpMessage> = {}): HelpMessage => ({
  id,
  role: 'user',
  text: id,
  ...over,
});

describe('createMemoryHistoryStore', () => {
  let store: HelpHistoryStore;

  beforeEach(() => {
    store = createMemoryHistoryStore({ maxMessages: 3 });
  });

  it('appends and loads messages in order', async () => {
    await store.appendMessage(msg('a'));
    await store.appendMessage(msg('b', { role: 'assistant' }));
    expect((await store.loadMessages()).map((m) => m.id)).toEqual(['a', 'b']);
  });

  it('starts with an empty log', async () => {
    expect(await store.loadMessages()).toEqual([]);
  });

  it('caps the log at maxMessages, evicting the oldest (FIFO)', async () => {
    for (const id of ['a', 'b', 'c', 'd', 'e']) {
      await store.appendMessage(msg(id));
    }
    expect((await store.loadMessages()).map((m) => m.id)).toEqual(['c', 'd', 'e']);
  });

  it('defaults maxMessages to 50', async () => {
    const big = createMemoryHistoryStore();
    for (let i = 0; i < 60; i++) {
      await big.appendMessage(msg(`m${i}`));
    }
    const loaded = await big.loadMessages();
    expect(loaded).toHaveLength(50);
    expect(loaded[0].id).toBe('m10');
    expect(loaded.at(-1)?.id).toBe('m59');
  });

  it('does not mutate the appended message', async () => {
    const original = msg('a');
    await store.appendMessage(original);
    expect(original).toEqual({ id: 'a', role: 'user', text: 'a' });
  });

  it('returns a copy that cannot mutate the internal log', async () => {
    await store.appendMessage(msg('a'));
    const loaded = await store.loadMessages();
    loaded.push(msg('rogue'));
    expect((await store.loadMessages()).map((m) => m.id)).toEqual(['a']);
  });

  it('reports hasSeen false by default and true after markSeen', async () => {
    expect(await store.hasSeen('dashboard')).toBe(false);
    await store.markSeen('dashboard');
    expect(await store.hasSeen('dashboard')).toBe(true);
    // Unrelated pages remain unseen.
    expect(await store.hasSeen('settings')).toBe(false);
  });

  it('clear() empties messages and resets seen flags', async () => {
    await store.appendMessage(msg('a'));
    await store.markSeen('dashboard');
    await store.clear();
    expect(await store.loadMessages()).toEqual([]);
    expect(await store.hasSeen('dashboard')).toBe(false);
  });

  describe('conversation archive', () => {
    it('starts with no archived conversations', async () => {
      expect(await store.listConversations()).toEqual([]);
    });

    it('archiveCurrent snapshots the active thread, clears it, and titles it from the first user turn', async () => {
      await store.appendMessage(msg('q1', { text: 'How do I run Scout?' }));
      await store.appendMessage(msg('a1', { role: 'assistant', text: 'Click Run Scout.' }));

      const summary = await store.archiveCurrent();
      expect(summary).toMatchObject({ title: 'How do I run Scout?', messageCount: 2 });
      expect(await store.loadMessages()).toEqual([]);
      expect((await store.listConversations()).map((c) => c.id)).toEqual([summary?.id]);
    });

    it('archiveCurrent on an empty thread is a no-op returning null', async () => {
      expect(await store.archiveCurrent()).toBeNull();
      expect(await store.listConversations()).toEqual([]);
    });

    it('lists newest first and caps at maxConversations (oldest evicted)', async () => {
      const small = createMemoryHistoryStore({ maxConversations: 2 });
      for (const text of ['first', 'second', 'third']) {
        await small.appendMessage(msg(text, { text }));
        await small.archiveCurrent();
      }
      expect((await small.listConversations()).map((c) => c.title)).toEqual(['third', 'second']);
    });

    it('openConversation restores the archived turns as the active thread and removes the entry', async () => {
      await store.appendMessage(msg('q1', { text: 'older question' }));
      const archived = await store.archiveCurrent();

      const restored = await store.openConversation(archived?.id ?? '');
      expect(restored.map((m) => m.id)).toEqual(['q1']);
      expect((await store.loadMessages()).map((m) => m.id)).toEqual(['q1']);
      expect(await store.listConversations()).toEqual([]);
    });

    it('openConversation with an unknown id returns [] and leaves state untouched', async () => {
      await store.appendMessage(msg('q1'));
      await store.archiveCurrent();
      expect(await store.openConversation('nope')).toEqual([]);
      expect(await store.listConversations()).toHaveLength(1);
    });

    it('deleteConversation removes only the targeted entry', async () => {
      await store.appendMessage(msg('a', { text: 'keep me' }));
      const kept = await store.archiveCurrent();
      await store.appendMessage(msg('b', { text: 'drop me' }));
      const dropped = await store.archiveCurrent();

      await store.deleteConversation(dropped?.id ?? '');
      expect((await store.listConversations()).map((c) => c.id)).toEqual([kept?.id]);
    });

    it('clear() also wipes the archive', async () => {
      await store.appendMessage(msg('a'));
      await store.archiveCurrent();
      await store.clear();
      expect(await store.listConversations()).toEqual([]);
    });
  });
});

// happy-dom ships no IndexedDB, so this exercises the in-memory fallback path
// (ADR-045). We assert it satisfies the same observable contract and never throws.
describe('createIndexedDbHistoryStore (memory fallback)', () => {
  let store: HelpHistoryStore;

  beforeEach(() => {
    store = createIndexedDbHistoryStore({ maxMessages: 3 });
  });

  it('falls back transparently when IndexedDB is unavailable', () => {
    expect(typeof globalThis.indexedDB).toBe('undefined');
  });

  it('appends and loads messages in order', async () => {
    await store.appendMessage(msg('a'));
    await store.appendMessage(msg('b'));
    expect((await store.loadMessages()).map((m) => m.id)).toEqual(['a', 'b']);
  });

  it('caps the log at maxMessages, evicting the oldest', async () => {
    for (const id of ['a', 'b', 'c', 'd']) {
      await store.appendMessage(msg(id));
    }
    expect((await store.loadMessages()).map((m) => m.id)).toEqual(['b', 'c', 'd']);
  });

  it('tracks seen flags and clears all state', async () => {
    expect(await store.hasSeen('dashboard')).toBe(false);
    await store.markSeen('dashboard');
    await store.appendMessage(msg('a'));
    expect(await store.hasSeen('dashboard')).toBe(true);

    await store.clear();
    expect(await store.loadMessages()).toEqual([]);
    expect(await store.hasSeen('dashboard')).toBe(false);
  });

  it('archives, lists, reopens, and deletes conversations through the fallback', async () => {
    await store.appendMessage(msg('q1', { text: 'archived question' }));
    const summary = await store.archiveCurrent();
    expect((await store.listConversations()).map((c) => c.id)).toEqual([summary?.id]);

    const restored = await store.openConversation(summary?.id ?? '');
    expect(restored.map((m) => m.id)).toEqual(['q1']);

    await store.archiveCurrent();
    const [again] = await store.listConversations();
    await store.deleteConversation(again.id);
    expect(await store.listConversations()).toEqual([]);
  });
});
