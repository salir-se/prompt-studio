// Local help history store (ADR-089 privacy, ADR-045 IndexedDB fallback).
//
// The help assistant keeps a small conversation log plus per-page "seen" flags
// (used to auto-open the panel on a user's first visit to a page). This data is
// strictly local — it never leaves the device — so the store is a thin wrapper
// over in-memory state or IndexedDB, with IndexedDB degrading to memory wherever
// it is unavailable (SSR, Safari private mode) or errors, so it can never throw.

import type { HelpConfidence, HelpSource } from './adapters';

export interface HelpMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  status?: 'ok' | 'error' | 'quota' | 'busy';
  /** Fallback offer carried on a busy answer (see AssistantRunResult.fallback). */
  fallback?: { label: string };
  /**
   * What an assistant answer was grounded in — source chips (ADR-089 §G5).
   * {@link HelpProvider} copies these from the runner result; expand-only and
   * optional (a runner that doesn't populate them omits them).
   */
  sources?: HelpSource[];
  /** The assistant's self-reported confidence for this answer (ADR-089 §G5). */
  confidence?: HelpConfidence;
}

/**
 * A past conversation moved out of the active thread (when the user presses
 * "New" or opens a different one). Snapshots the full turn list so it can be
 * reopened later. Local-only, like everything else here (ADR-089 privacy).
 */
export interface ArchivedConversation {
  id: string;
  /** Short label derived from the first user turn, for the history list. */
  title: string;
  messages: HelpMessage[];
  /** Epoch ms the conversation was archived (drives "x ago" + newest-first order). */
  archivedAt: number;
}

/** Lightweight row for the "Past conversations" list — no message bodies. */
export interface ConversationSummary {
  id: string;
  title: string;
  archivedAt: number;
  messageCount: number;
}

/**
 * Minimal local store for the help system: a capped message log plus per-page
 * "seen" flags (drive first-visit auto-open) and an archive of past conversations
 * (drive the history browser). Local-only by design — history never leaves the
 * device (ADR-089 privacy).
 */
export interface HelpHistoryStore {
  hasSeen(pageKey: string): Promise<boolean>;
  markSeen(pageKey: string): Promise<void>;
  loadMessages(): Promise<HelpMessage[]>;
  appendMessage(message: HelpMessage): Promise<void>;
  clear(): Promise<void>;
  /** Past conversations, newest first (summaries only — no message bodies). */
  listConversations(): Promise<ConversationSummary[]>;
  /**
   * Snapshot the active thread into the archive and clear it (the "New" action).
   * No-op returning `null` when the active thread is empty. Leaves "seen" flags
   * untouched (unlike {@link HelpHistoryStore.clear}).
   */
  archiveCurrent(): Promise<ConversationSummary | null>;
  /**
   * Make an archived conversation active again: remove it from the archive and
   * load its messages as the active thread. Returns its messages (empty if the id
   * is unknown). Callers archive the current thread first so nothing is lost.
   */
  openConversation(id: string): Promise<HelpMessage[]>;
  /** Permanently remove an archived conversation. */
  deleteConversation(id: string): Promise<void>;
}

const DEFAULT_MAX_MESSAGES = 50;
/** Cap on archived conversations kept locally (FIFO eviction of the oldest). */
const DEFAULT_MAX_CONVERSATIONS = 30;
const DEFAULT_DB_NAME = 'salir-help';
const STORE_NAME = 'state';
const MESSAGES_KEY = 'messages';
const SEEN_KEY = 'seen';
const CONVERSATIONS_KEY = 'conversations';
const TITLE_MAX_CHARS = 60;

/** Keep only the most recent `max` messages (FIFO eviction of the oldest). */
function capMessages(messages: HelpMessage[], max: number): HelpMessage[] {
  return messages.length > max ? messages.slice(messages.length - max) : messages;
}

/** A unique id for an archived conversation (crypto when available; time+random fallback). */
function newConversationId(): string {
  return (
    globalThis.crypto?.randomUUID?.() ?? `conv-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
  );
}

/** Derive a short, human title from the first user turn (falls back to a generic label). */
function deriveTitle(messages: HelpMessage[]): string {
  const firstUser = messages.find((m) => m.role === 'user' && m.text.trim().length > 0);
  const text = firstUser?.text.trim() ?? '';
  if (!text) return 'Conversation';
  return text.length > TITLE_MAX_CHARS ? `${text.slice(0, TITLE_MAX_CHARS - 1).trimEnd()}…` : text;
}

/** Project an archived conversation to its list-row summary (no message bodies). */
function toSummary(c: ArchivedConversation): ConversationSummary {
  return { id: c.id, title: c.title, archivedAt: c.archivedAt, messageCount: c.messages.length };
}

/** Build an archive entry from the active thread, or `null` when it's empty. */
function snapshot(messages: HelpMessage[]): ArchivedConversation | null {
  if (messages.length === 0) return null;
  return { id: newConversationId(), title: deriveTitle(messages), messages: [...messages], archivedAt: Date.now() };
}

/**
 * In-memory help history store. The default backend, and the transparent
 * fallback for {@link createIndexedDbHistoryStore} when IndexedDB is unavailable.
 */
export function createMemoryHistoryStore(
  opts: { maxMessages?: number; maxConversations?: number } = {},
): HelpHistoryStore {
  const max = Math.max(0, opts.maxMessages ?? DEFAULT_MAX_MESSAGES);
  const maxConversations = Math.max(0, opts.maxConversations ?? DEFAULT_MAX_CONVERSATIONS);
  let messages: HelpMessage[] = [];
  // Newest first; capped to `maxConversations` (oldest dropped).
  let conversations: ArchivedConversation[] = [];
  const seen = new Set<string>();

  return {
    async hasSeen(pageKey) {
      return seen.has(pageKey);
    },
    async markSeen(pageKey) {
      seen.add(pageKey);
    },
    async loadMessages() {
      // Return a copy so callers can't mutate our internal log.
      return [...messages];
    },
    async appendMessage(message) {
      messages = capMessages([...messages, message], max);
    },
    async clear() {
      messages = [];
      conversations = [];
      seen.clear();
    },
    async listConversations() {
      return conversations.map(toSummary);
    },
    async archiveCurrent() {
      const entry = snapshot(messages);
      messages = [];
      if (!entry) return null;
      conversations = [entry, ...conversations].slice(0, maxConversations);
      return toSummary(entry);
    },
    async openConversation(id) {
      const found = conversations.find((c) => c.id === id);
      if (!found) return [];
      conversations = conversations.filter((c) => c.id !== id);
      messages = capMessages([...found.messages], max);
      return [...messages];
    },
    async deleteConversation(id) {
      conversations = conversations.filter((c) => c.id !== id);
    },
  };
}

/**
 * IndexedDB-backed help history store. Persists across sessions when IndexedDB
 * is available; otherwise (SSR, Safari private mode, or any IndexedDB error)
 * transparently delegates to an in-memory store (ADR-045). Every IndexedDB
 * access is guarded, so this store can never throw to the caller.
 */
export function createIndexedDbHistoryStore(
  opts: { dbName?: string; maxMessages?: number; maxConversations?: number } = {},
): HelpHistoryStore {
  const max = Math.max(0, opts.maxMessages ?? DEFAULT_MAX_MESSAGES);
  const maxConversations = Math.max(0, opts.maxConversations ?? DEFAULT_MAX_CONVERSATIONS);
  const fallback = createMemoryHistoryStore({ maxMessages: max, maxConversations });

  // Feature-detect up front: no IndexedDB (SSR / private mode) → pure memory store.
  if (typeof globalThis.indexedDB === 'undefined') {
    return fallback;
  }

  const dbName = opts.dbName ?? DEFAULT_DB_NAME;
  let dbPromise: Promise<IDBDatabase> | null = null;

  function openDb(): Promise<IDBDatabase> {
    if (!dbPromise) {
      dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
        const request = globalThis.indexedDB.open(dbName, 1);
        request.onupgradeneeded = () => {
          const db = request.result;
          if (!db.objectStoreNames.contains(STORE_NAME)) {
            db.createObjectStore(STORE_NAME);
          }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error ?? new Error('indexedDB open failed'));
      });
    }
    return dbPromise;
  }

  /** Read one keyed value from the object store. */
  function get<T>(db: IDBDatabase, key: string): Promise<T | undefined> {
    return new Promise<T | undefined>((resolve, reject) => {
      const request = db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).get(key);
      request.onsuccess = () => resolve(request.result as T | undefined);
      request.onerror = () => reject(request.error ?? new Error('indexedDB get failed'));
    });
  }

  /** Write one keyed value into the object store. */
  function put(db: IDBDatabase, key: string, value: unknown): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error('indexedDB put failed'));
    });
  }

  return {
    async hasSeen(pageKey) {
      try {
        const db = await openDb();
        const seen = (await get<string[]>(db, SEEN_KEY)) ?? [];
        return seen.includes(pageKey);
      } catch {
        return fallback.hasSeen(pageKey);
      }
    },
    async markSeen(pageKey) {
      try {
        const db = await openDb();
        const seen = (await get<string[]>(db, SEEN_KEY)) ?? [];
        if (!seen.includes(pageKey)) {
          await put(db, SEEN_KEY, [...seen, pageKey]);
        }
      } catch {
        await fallback.markSeen(pageKey);
      }
    },
    async loadMessages() {
      try {
        const db = await openDb();
        return (await get<HelpMessage[]>(db, MESSAGES_KEY)) ?? [];
      } catch {
        return fallback.loadMessages();
      }
    },
    async appendMessage(message) {
      try {
        const db = await openDb();
        const existing = (await get<HelpMessage[]>(db, MESSAGES_KEY)) ?? [];
        await put(db, MESSAGES_KEY, capMessages([...existing, message], max));
      } catch {
        await fallback.appendMessage(message);
      }
    },
    async clear() {
      try {
        const db = await openDb();
        await put(db, MESSAGES_KEY, []);
        await put(db, SEEN_KEY, []);
        await put(db, CONVERSATIONS_KEY, []);
      } catch {
        await fallback.clear();
      }
    },
    async listConversations() {
      try {
        const db = await openDb();
        const list = (await get<ArchivedConversation[]>(db, CONVERSATIONS_KEY)) ?? [];
        return list.map(toSummary);
      } catch {
        return fallback.listConversations();
      }
    },
    async archiveCurrent() {
      try {
        const db = await openDb();
        const current = (await get<HelpMessage[]>(db, MESSAGES_KEY)) ?? [];
        const entry = snapshot(current);
        await put(db, MESSAGES_KEY, []);
        if (!entry) return null;
        const existing = (await get<ArchivedConversation[]>(db, CONVERSATIONS_KEY)) ?? [];
        await put(db, CONVERSATIONS_KEY, [entry, ...existing].slice(0, maxConversations));
        return toSummary(entry);
      } catch {
        return fallback.archiveCurrent();
      }
    },
    async openConversation(id) {
      try {
        const db = await openDb();
        const existing = (await get<ArchivedConversation[]>(db, CONVERSATIONS_KEY)) ?? [];
        const found = existing.find((c) => c.id === id);
        if (!found) return [];
        await put(
          db,
          CONVERSATIONS_KEY,
          existing.filter((c) => c.id !== id),
        );
        const restored = capMessages([...found.messages], max);
        await put(db, MESSAGES_KEY, restored);
        return restored;
      } catch {
        return fallback.openConversation(id);
      }
    },
    async deleteConversation(id) {
      try {
        const db = await openDb();
        const existing = (await get<ArchivedConversation[]>(db, CONVERSATIONS_KEY)) ?? [];
        await put(
          db,
          CONVERSATIONS_KEY,
          existing.filter((c) => c.id !== id),
        );
      } catch {
        await fallback.deleteConversation(id);
      }
    },
  };
}
