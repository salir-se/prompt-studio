/**
 * `HistoryProvider` — the studio's project/history contract (ADR-203). The studio gains named prompt
 * projects spanning all prompt roots, each with a commit history and rollback to any prior fragment
 * version. This interface is the ONLY surface UI and App wiring may consume; the concrete
 * implementation behind it is chosen at boot by `history-factory.ts`:
 *
 *  - `GitHistoryProvider` (separate module, memfs + isomorphic-git) — real branches/log/blob semantics;
 *  - `SimpleHistoryProvider` (`simple-history-provider.ts`) — the dependency-free, content-addressed
 *    linear log that is both the `'auto'` fallback and the reference implementation the shared contract
 *    suite (`history-provider.contract.ts`) locks both implementations to.
 *
 * SINGLE SOURCE OF TRUTH — committed history only. App state (React) remains the live WORKING document:
 * a dirty edit lives exclusively in React state until the user applies it, at which point `commit()`
 * records it here. The provider never sees uncommitted text, so there is exactly one owner per state:
 * React owns "what the editor shows right now", the provider owns "what has been committed". Switching
 * projects reads `heads()` and replaces the working state wholesale — never the other way around.
 */

/** A named prompt project — `id` is the stable slug (see `createProject`), `name` the display name. */
export interface ProjectRef {
  readonly id: string;
  readonly name: string;
}

/** One entry of a project's committed history, scoped to the single prompt root the commit touched. */
export interface HistoryCommitRef {
  /** Stable content-derived commit identifier — the `commitId` accepted by `readTextAt`. */
  readonly id: string;
  /** Human-readable commit message; baseline seed commits carry the literal message `'baseline'`. */
  readonly message: string;
  /** Commit time in epoch milliseconds (provider clock — injectable in implementations for tests). */
  readonly timestampMs: number;
  /** The prompt root this commit recorded a new text for (one root per commit). */
  readonly rootKey: string;
}

/**
 * Committed-history store for prompt projects. All methods are async so implementations backed by
 * real async machinery (WebCrypto hashing, isomorphic-git, IndexedDB) share one signature with the
 * in-memory one. Implementations must reject (never silently no-op) on unknown ids and on any
 * mutation of the immutable `'baseline'` pseudo-project.
 */
export interface HistoryProvider {
  /** Which implementation is behind the interface — surfaced in diagnostics and the degrade log. */
  readonly kind: 'git' | 'simple';

  /**
   * Seeds the immutable baseline — the shipped constants, one text per root. Idempotent per boot:
   * a second call (e.g. after a successful `restore()`) must not duplicate the seed commits. The
   * baseline is readable like any project (id `'baseline'`) but rejects every mutation.
   */
  init(baselineTexts: ReadonlyMap<string, string>): Promise<void>;

  /** All user projects, in creation order. The `'baseline'` pseudo-project is NOT listed. */
  listProjects(): Promise<readonly ProjectRef[]>;

  /**
   * `from` omitted → fork from baseline; `from` = project id → fork from that project's heads.
   * Name must be non-empty; id = slug (lowercase, non-alphanumeric → `-`, collapsed/trimmed),
   * unique — collisions get a `-2`, `-3`, … suffix. A name that slugs to `'baseline'` rejects.
   */
  createProject(name: string, from?: string): Promise<ProjectRef>;

  /** Renames a project (display name only — the id/slug never changes). Non-empty name required. */
  renameProject(id: string, name: string): Promise<void>;

  /** Deletes a project. Its commits stay addressable so projects forked from it keep their history. */
  deleteProject(id: string): Promise<void>;

  /** Records one root's new committed text on a project. Returns the commit ref. */
  commit(input: {
    readonly projectId: string;
    readonly rootKey: string;
    readonly text: string;
    readonly message: string;
  }): Promise<HistoryCommitRef>;

  /**
   * Newest-first. `rootKey` omitted → all roots interleaved (still newest-first). Baseline seed
   * commits included, marked by message `'baseline'`.
   */
  history(projectId: string, rootKey?: string): Promise<readonly HistoryCommitRef[]>;

  /** The committed text of `rootKey` at `commitId`, or `null` if that commit doesn't touch/see that root. */
  readTextAt(projectId: string, commitId: string, rootKey: string): Promise<string | null>;

  /** Current committed heads for a project: rootKey → text (baseline text where never edited). Used on project switch. */
  heads(projectId: string): Promise<ReadonlyMap<string, string>>;

  /** Serializes provider state for the project archive: path → text file map (format is provider-specific; documented). */
  exportArchive(projectId: string): Promise<Readonly<Record<string, string>>>;

  /**
   * Persists full provider state to the snapshot store. Persistence is EXPLICIT — no other method may
   * write the snapshot store, so callers (and the contract suite) control exactly when state lands.
   */
  persist(): Promise<void>;

  /**
   * Restores full provider state from the snapshot store, replacing in-memory state. Returns `false`
   * when the snapshot is absent or corrupt (caller re-seeds via `init`); never throws for bad data.
   */
  restore(): Promise<boolean>;
}
