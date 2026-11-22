/**
 * `SimpleHistoryProvider` — ADR-203's dependency-free, content-addressed linear commit log: the
 * `'auto'` fallback AND the reference implementation the shared contract suite
 * (`history-provider.contract.ts`) locks the git provider to.
 *
 * Model (all in memory, snapshot-persisted as one JSON document):
 *  - **Blobs** — `Map<sha256Hex(text), text>`: committing the same text twice stores one blob.
 *  - **Commits** — `{ id, parentId | null, projectId, rootKey, blobSha, message, timestampMs }`,
 *    one root per commit; `id = sha256Hex(parentId + rootKey + blobSha + message + timestampMs)`
 *    (newline-joined so no field can bleed into its neighbor). Kept in append order — the tiebreak
 *    when two commits share a `timestampMs`.
 *  - **Projects** — `{ id, name, forkedFrom }` where `forkedFrom` maps each rootKey to the commit id
 *    the project forked at. A project's per-root head is its own newest commit for that root, else
 *    `forkedFrom[rootKey]`; history is the `parentId` chain from the head, which naturally crosses
 *    into the source project's (and ultimately the baseline's) commits.
 *  - **Baseline** — the pseudo-project `'baseline'` seeded by `init()` with one commit per root
 *    (message `'baseline'`). Readable via `history`/`readTextAt`/`heads` like any project, but every
 *    mutation against it rejects — commit zero stays the code-shipped truth (ADR-203 decision 1).
 *
 * Persistence: `persist()` writes the WHOLE state as JSON under one versioned key; `restore()`
 * validates it with arktype (`'+': 'reject'` — types are not proof, CLAUDE.md) and returns `false`
 * on anything absent or corrupt so the caller re-seeds.
 */

import { type } from 'arktype';
import type { HistoryCommitRef, HistoryProvider, ProjectRef } from './history-provider';
import type { SnapshotStore } from './snapshot-store';

/** The immutable pseudo-project id every fork chain bottoms out in. */
export const BASELINE_PROJECT_ID = 'baseline';

/**
 * Versioned snapshot key — bump the suffix when the persisted shape changes incompatibly (the old
 * snapshot then simply fails validation and the studio re-seeds; no migration machinery for a cache).
 */
export const SIMPLE_HISTORY_SNAPSHOT_KEY = 'prompt-studio:history:simple:v1';

/**
 * SHA-256 as lowercase hex via WebCrypto. Deliberately duplicated from `export-flow.ts`'s
 * `sha256Hex` — importing it would couple the VCS layer to the export layer for eight lines of
 * standard-API glue; the two copies share nothing but the platform primitive.
 */
async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** `name` → project slug: lowercase, non-alphanumeric runs → `-`, trimmed; never empty. */
function slugify(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug === '' ? 'project' : slug;
}

/** Recursively sorts object keys so `stableStringify` output is order-independent of insertion. */
function normalizeForJson(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(normalizeForJson);
  }
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, entry]) => [key, normalizeForJson(entry)]),
    );
  }
  return value;
}

/** Pretty-printed JSON with recursively sorted keys — the archive files must be diff-stable. */
function stableStringify(value: unknown): string {
  return JSON.stringify(normalizeForJson(value), null, 2);
}

interface SimpleCommit {
  readonly id: string;
  readonly parentId: string | null;
  readonly projectId: string;
  readonly rootKey: string;
  readonly blobSha: string;
  readonly message: string;
  readonly timestampMs: number;
}

interface SimpleProject {
  readonly id: string;
  readonly name: string;
  readonly forkedFrom: Readonly<Record<string, string>>;
}

/**
 * The persisted snapshot shape, locked down with `'+': 'reject'` at every object level (index
 * signatures already constrain their own keys). Anything the schema does not know about — extra
 * keys, wrong types, missing fields — makes `restore()` return `false` instead of importing it.
 */
const storedCommit = type({
  id: 'string',
  parentId: 'string | null',
  projectId: 'string',
  rootKey: 'string',
  blobSha: 'string',
  message: 'string',
  timestampMs: 'number',
  '+': 'reject',
});

const storedProject = type({
  id: 'string',
  name: 'string',
  forkedFrom: { '[string]': 'string' },
  '+': 'reject',
});

const storedState = type({
  version: '1',
  blobs: { '[string]': 'string' },
  commits: storedCommit.array(),
  projects: storedProject.array(),
  '+': 'reject',
});

/** Constructor options — `now` is injectable so tests get deterministic timestamps and commit ids. */
export interface SimpleHistoryProviderOptions {
  readonly snapshotStore: SnapshotStore;
  readonly now?: () => number;
}

/** See the module doc for the data model; see `history-provider.ts` for the behavioral contract. */
export class SimpleHistoryProvider implements HistoryProvider {
  readonly kind = 'simple' as const;

  private readonly snapshotStore: SnapshotStore;
  private readonly now: () => number;

  /** Content-addressed texts: sha256 → text. */
  private blobs = new Map<string, string>();
  /** All commits in append order (the `timestampMs` tiebreak); `commitsById` indexes the same objects. */
  private commits: SimpleCommit[] = [];
  private commitsById = new Map<string, SimpleCommit>();
  /** The tail of the commit queue (see `commit`). */
  private writes: Promise<unknown> = Promise.resolve();
  /** Projects keyed by id in creation order — includes the `'baseline'` pseudo-project. */
  private projects = new Map<string, SimpleProject>();

  constructor(options: SimpleHistoryProviderOptions) {
    this.snapshotStore = options.snapshotStore;
    this.now = options.now ?? Date.now;
  }

  async init(baselineTexts: ReadonlyMap<string, string>): Promise<void> {
    if (!this.projects.has(BASELINE_PROJECT_ID)) {
      this.projects.set(BASELINE_PROJECT_ID, { id: BASELINE_PROJECT_ID, name: 'baseline', forkedFrom: {} });
    }
    // Idempotent AND incremental, mirroring `GitHistoryProvider.init`: roots the baseline has
    // already been seeded with (this boot, or via restore) keep their existing seed; roots it has
    // never seen — newly shipped documents, e.g. skill documents that loaded after the snapshot
    // was written — JOIN it. The shared contract suite pins this for both implementations;
    // skipping the whole init once seeded used to make the simple provider silently narrower.
    const seededRootKeys = new Set(
      this.commits.filter((commit) => commit.projectId === BASELINE_PROJECT_ID).map((commit) => commit.rootKey),
    );
    for (const [rootKey, text] of baselineTexts) {
      if (!seededRootKeys.has(rootKey)) {
        await this.appendCommit(BASELINE_PROJECT_ID, rootKey, text, 'baseline');
      }
    }
  }

  async listProjects(): Promise<readonly ProjectRef[]> {
    return [...this.projects.values()]
      .filter((project) => project.id !== BASELINE_PROJECT_ID)
      .map(({ id, name }) => ({ id, name }));
  }

  async createProject(name: string, from?: string): Promise<ProjectRef> {
    const trimmed = name.trim();
    if (trimmed === '') {
      throw new Error('Project name must be non-empty.');
    }
    const slug = slugify(trimmed);
    if (slug === BASELINE_PROJECT_ID) {
      throw new Error(`"${BASELINE_PROJECT_ID}" is the immutable baseline — pick another project name.`);
    }
    const sourceId = from ?? BASELINE_PROJECT_ID;
    if (!this.projects.has(sourceId)) {
      throw new Error(`Unknown source project "${sourceId}".`);
    }
    // Freeze the source's CURRENT heads as the fork points — later commits on the source must not
    // leak into this project's history (contract: fork inherits heads, not the future).
    const forkedFrom: Record<string, string> = {};
    for (const rootKey of this.rootKeysOf(sourceId)) {
      const head = this.headCommitId(sourceId, rootKey);
      if (head !== null) {
        forkedFrom[rootKey] = head;
      }
    }
    const id = this.uniqueSlug(slug);
    this.projects.set(id, { id, name: trimmed, forkedFrom });
    return { id, name: trimmed };
  }

  async renameProject(id: string, name: string): Promise<void> {
    const project = this.requireMutableProject(id, 'rename');
    const trimmed = name.trim();
    if (trimmed === '') {
      throw new Error('Project name must be non-empty.');
    }
    this.projects.set(id, { ...project, name: trimmed });
  }

  async deleteProject(id: string): Promise<void> {
    this.requireMutableProject(id, 'delete');
    // Only the project record goes — its commits stay in the log so forks keep their ancestry.
    this.projects.delete(id);
  }

  async commit(input: {
    readonly projectId: string;
    readonly rootKey: string;
    readonly text: string;
    readonly message: string;
  }): Promise<HistoryCommitRef> {
    this.requireMutableProject(input.projectId, 'commit to');
    // Hashing is asynchronous, so the parent read and the append must not interleave with another commit's:
    // two overlapping commits would share a parent and the history chain would drop one of them.
    const append = () => this.appendCommit(input.projectId, input.rootKey, input.text, input.message);
    const pending = this.writes.then(append, append);
    this.writes = pending.catch(() => undefined);
    const commit = await pending;
    return { id: commit.id, message: commit.message, timestampMs: commit.timestampMs, rootKey: commit.rootKey };
  }

  async history(projectId: string, rootKey?: string): Promise<readonly HistoryCommitRef[]> {
    this.requireProject(projectId);
    const rootKeys = rootKey === undefined ? this.rootKeysOf(projectId) : [rootKey];
    const visible: SimpleCommit[] = [];
    for (const key of rootKeys) {
      visible.push(...this.chainFor(projectId, key));
    }
    // Newest-first: timestamp, then append order for same-millisecond commits.
    visible.sort((a, b) => b.timestampMs - a.timestampMs || this.appendIndex(b) - this.appendIndex(a));
    return visible.map(({ id, message, timestampMs, rootKey: key }) => ({ id, message, timestampMs, rootKey: key }));
  }

  async readTextAt(projectId: string, commitId: string, rootKey: string): Promise<string | null> {
    this.requireProject(projectId);
    const commit = this.commitsById.get(commitId);
    if (!commit || commit.rootKey !== rootKey) {
      return null; // The commit doesn't touch that root (or doesn't exist at all).
    }
    // "Sees": the commit must be in this project's ancestry for the root — a commit on an unrelated
    // project (or made after this project forked away) is not part of this project's history.
    const seen = this.chainFor(projectId, rootKey).some((ancestor) => ancestor.id === commitId);
    return seen ? (this.blobs.get(commit.blobSha) ?? null) : null;
  }

  async heads(projectId: string): Promise<ReadonlyMap<string, string>> {
    this.requireProject(projectId);
    const result = new Map<string, string>();
    for (const rootKey of this.rootKeysOf(projectId)) {
      const headId = this.headCommitId(projectId, rootKey);
      const head = headId === null ? undefined : this.commitsById.get(headId);
      const text = head === undefined ? undefined : this.blobs.get(head.blobSha);
      if (text !== undefined) {
        result.set(rootKey, text);
      }
    }
    return result;
  }

  /**
   * Archive layout (provider-specific by contract):
   *  - `project.json` — `{ id, name, heads: { rootKey: blobSha } }`;
   *  - `history/commits.json` — every commit visible to the project, oldest-first;
   *  - `history/blobs.json` — `{ sha: text }` for exactly the blobs those commits reference.
   * All three are pretty-printed, key-sorted JSON (`stableStringify`) so re-exports diff cleanly.
   */
  async exportArchive(projectId: string): Promise<Readonly<Record<string, string>>> {
    const project = this.requireProject(projectId);
    const visible = new Map<string, SimpleCommit>();
    const heads: Record<string, string> = {};
    for (const rootKey of this.rootKeysOf(projectId)) {
      for (const commit of this.chainFor(projectId, rootKey)) {
        visible.set(commit.id, commit);
      }
      const headId = this.headCommitId(projectId, rootKey);
      const head = headId === null ? undefined : this.commitsById.get(headId);
      if (head !== undefined) {
        heads[rootKey] = head.blobSha;
      }
    }
    const commits = [...visible.values()].sort(
      (a, b) => a.timestampMs - b.timestampMs || this.appendIndex(a) - this.appendIndex(b),
    );
    const blobs: Record<string, string> = {};
    for (const commit of commits) {
      const text = this.blobs.get(commit.blobSha);
      if (text !== undefined) {
        blobs[commit.blobSha] = text;
      }
    }
    return {
      'project.json': stableStringify({ id: project.id, name: project.name, heads }),
      'history/commits.json': stableStringify(commits),
      'history/blobs.json': stableStringify(blobs),
    };
  }

  async persist(): Promise<void> {
    const state = {
      version: 1,
      blobs: Object.fromEntries(this.blobs),
      commits: this.commits,
      projects: [...this.projects.values()],
    };
    await this.snapshotStore.save(SIMPLE_HISTORY_SNAPSHOT_KEY, JSON.stringify(state));
  }

  async restore(): Promise<boolean> {
    const raw = await this.snapshotStore.load(SIMPLE_HISTORY_SNAPSHOT_KEY);
    if (raw === null) {
      return false;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return false;
    }
    const validated = storedState(parsed);
    if (validated instanceof type.errors) {
      return false;
    }
    // Only replace state once the WHOLE snapshot validated — never a partial import.
    this.blobs = new Map(Object.entries(validated.blobs));
    this.commits = [...validated.commits];
    this.commitsById = new Map(this.commits.map((commit) => [commit.id, commit]));
    this.projects = new Map(validated.projects.map((project) => [project.id, project]));
    return true;
  }

  /** Stores `text`'s blob (deduped), computes the commit id, and appends unless it already exists. */
  private async appendCommit(projectId: string, rootKey: string, text: string, message: string): Promise<SimpleCommit> {
    const blobSha = await sha256Hex(text);
    if (!this.blobs.has(blobSha)) {
      this.blobs.set(blobSha, text);
    }
    const parentId = this.headCommitId(projectId, rootKey);
    const timestampMs = this.now();
    const id = await sha256Hex([parentId ?? '', rootKey, blobSha, message, String(timestampMs)].join('\n'));
    const existing = this.commitsById.get(id);
    if (existing) {
      return existing; // Byte-identical commit (same parent/root/blob/message/timestamp) — idempotent.
    }
    const commit: SimpleCommit = { id, parentId, projectId, rootKey, blobSha, message, timestampMs };
    this.commits.push(commit);
    this.commitsById.set(id, commit);
    return commit;
  }

  /** The project's head commit id for one root: its own newest commit, else the fork point, else null. */
  private headCommitId(projectId: string, rootKey: string): string | null {
    for (let index = this.commits.length - 1; index >= 0; index -= 1) {
      const commit = this.commits[index];
      if (commit.projectId === projectId && commit.rootKey === rootKey) {
        return commit.id;
      }
    }
    return this.projects.get(projectId)?.forkedFrom[rootKey] ?? null;
  }

  /** Every root the project can see: its fork points plus any root it committed to itself. */
  private rootKeysOf(projectId: string): readonly string[] {
    const keys = new Set<string>(Object.keys(this.projects.get(projectId)?.forkedFrom ?? {}));
    for (const commit of this.commits) {
      if (commit.projectId === projectId) {
        keys.add(commit.rootKey);
      }
    }
    return [...keys];
  }

  /** The project's full ancestry for one root, newest-first — head, then `parentId` links to the seed. */
  private chainFor(projectId: string, rootKey: string): readonly SimpleCommit[] {
    const chain: SimpleCommit[] = [];
    let cursor = this.headCommitId(projectId, rootKey);
    while (cursor !== null) {
      const commit = this.commitsById.get(cursor);
      if (!commit) {
        break; // Dangling parent — tolerate rather than throw; the snapshot is a cache.
      }
      chain.push(commit);
      cursor = commit.parentId;
    }
    return chain;
  }

  /** Position in append order — the deterministic tiebreak for equal timestamps. */
  private appendIndex(commit: SimpleCommit): number {
    return this.commits.indexOf(commit);
  }

  private uniqueSlug(base: string): string {
    if (!this.projects.has(base)) {
      return base;
    }
    let suffix = 2;
    while (this.projects.has(`${base}-${suffix}`)) {
      suffix += 1;
    }
    return `${base}-${suffix}`;
  }

  private requireProject(id: string): SimpleProject {
    const project = this.projects.get(id);
    if (!project) {
      throw new Error(`Unknown project "${id}".`);
    }
    return project;
  }

  private requireMutableProject(id: string, verb: string): SimpleProject {
    if (id === BASELINE_PROJECT_ID) {
      throw new Error(`Cannot ${verb} the immutable baseline.`);
    }
    return this.requireProject(id);
  }
}
