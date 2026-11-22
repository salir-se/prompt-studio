/**
 * `GitHistoryProvider` — ADR-203's full `HistoryProvider` implementation: a memfs `Volume` is the
 * filesystem, isomorphic-git is the version control, everything in-memory inside the structurally
 * undeployable studio app (ADR-203 decision 6 — neither dependency may leak outside this module).
 * Mirrors the observable behavior of `SimpleHistoryProvider`, the reference implementation the
 * shared contract suite (`history-provider.contract.ts`) locks both implementations to.
 *
 * Model:
 *  - **Repo** — one repository at `/repo`; branch `baseline` (the init defaultBranch) holds the
 *    immutable seed commits; each project is a branch `project/<slug>` forked from the baseline head
 *    (or a source project's head). `ProjectRef.id` is the bare slug — the `project/` ref prefix is
 *    an implementation detail that never leaves this module.
 *  - **File layout** — one file per prompt root: `roots/<rootKey>.md`. Deliberately NOT the ADR-202
 *    blueprint overlay layout: the blueprint belongs to export/import, while history only needs one
 *    stable path per root (rootKeys are registry keys, filename-safe by construction).
 *  - **Root-key trailer** — every commit message carries a `\n\nRoot-Key: <rootKey>` trailer so
 *    `history()` can recover which root a commit touched without a tree walk per commit
 *    (isomorphic-git has no notes support; the trailer is cheap and reliable). The trailer AND
 *    git's trailing-`\n` message normalization are both stripped before a message reaches a
 *    `HistoryCommitRef`.
 *  - **Display names** — names must not pollute history, so they live OUTSIDE the repo: in memory
 *    (creation order drives `listProjects`) and mirrored to `/meta/projects.json` in the volume so
 *    the volume snapshot alone stays self-describing. Rename touches only the map, never a commit.
 *  - **Timestamps** — git stores author time in SECONDS; `timestampMs` is that value ×1000, so the
 *    granularity is one second. Ordering never depends on it: `git.log` orders by parent chain.
 *
 * Persistence (`persist`/`restore`): `vol.toJSON` MUST be called with `asBuffer` (the 4th arg) —
 * the utf8-text default corrupts the binary `.git` objects (proven in `git-spike-scenario.ts`).
 * The `SnapshotStore` interface is string-based, so every Buffer value is base64-wrapped as a
 * `{ b64: string }` marker in the JSON envelope (~33% size overhead — accepted for a dev tool) and
 * reversed on restore. `restore()` validates the envelope with arktype (`'+': 'reject'`) and then
 * proves git-object integrity by running `git.log` on the baseline BEFORE adopting the volume —
 * anything absent or corrupt returns `false` so the caller re-seeds via `init()`.
 */

// MUST be first: installs the `Buffer` global isomorphic-git's browser build expects (no-op in node).
import './browser-globals';
import { Buffer } from 'node:buffer';
import { type } from 'arktype';
import * as git from 'isomorphic-git';
import { createFsFromVolume, type DirectoryJSON, Volume } from 'memfs';
import type { HistoryCommitRef, HistoryProvider, ProjectRef } from './history-provider';
import { BASELINE_PROJECT_ID } from './simple-history-provider';
import type { SnapshotStore } from './snapshot-store';

/** Repo root inside the volume — everything git lives under here. */
const DIR = '/repo';
/** Repo-relative directory holding one committed file per prompt root. */
const ROOTS_DIR = 'roots';
/** Display-name map — inside the VOLUME but outside the repo, so names never enter git history. */
const META_FILE = '/meta/projects.json';
/** Author/committer identity for every provider commit (matches the spike). */
const AUTHOR = { name: 'Prompt Studio', email: 'studio@salir.local' };

/**
 * Versioned snapshot key — bump the suffix when the persisted shape changes incompatibly (the old
 * snapshot then simply fails validation and the studio re-seeds; no migration machinery for a cache).
 */
export const GIT_HISTORY_SNAPSHOT_KEY = 'prompt-studio:history:git:v1';

/**
 * `name` → project slug: lowercase, non-alphanumeric runs → `-`, trimmed; never empty. Deliberately
 * duplicated from `simple-history-provider.ts` (where it is private) — the two implementations must
 * agree on slugs for the contract, but importing a private helper is not an option and exporting it
 * would grow the reference implementation's surface for four lines of glue.
 */
function slugify(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug === '' ? 'project' : slug;
}

/** Repo-relative committed path for one prompt root. */
function rootPath(rootKey: string): string {
  return `${ROOTS_DIR}/${rootKey}.md`;
}

/** Matches the `Root-Key` trailer — the LAST paragraph of a provider message (git appends the final `\n`). */
const TRAILER_PATTERN = /\n\nRoot-Key: ([^\n]+)\n?$/;

/**
 * Splits a raw git commit message into the user-facing message and the trailer's root key. The
 * provider is the only writer, so a user message that itself ends in a `Root-Key:` paragraph would
 * be misparsed — accepted for a dev tool. A commit without a trailer reports an empty root key.
 */
function parseCommitMessage(raw: string): { message: string; rootKey: string } {
  const match = TRAILER_PATTERN.exec(raw);
  if (match === null) {
    return { message: raw.replace(/\n+$/, ''), rootKey: '' };
  }
  return { message: raw.slice(0, match.index), rootKey: match[1] };
}

/** True when `buffer` decodes as utf8 and re-encodes to the SAME bytes — storing it as text is lossless. */
function isUtf8Lossless(buffer: Buffer): boolean {
  return Buffer.from(buffer.toString('utf8'), 'utf8').equals(buffer);
}

/**
 * The persisted envelope, locked down with `'+': 'reject'` at every object level: `files` is the
 * whole volume (utf8 text verbatim, binary as `{ b64 }` markers), `projects` the slug → display-name
 * map. Anything the schema does not know about makes `restore()` return `false` instead of importing.
 */
const storedFile = type({ b64: 'string', '+': 'reject' }).or('string');
const storedEnvelope = type({
  files: { '[string]': storedFile },
  projects: { '[string]': 'string' },
  '+': 'reject',
});

/** Constructor options — `now` is injectable so tests get deterministic commit timestamps. */
export interface GitHistoryProviderOptions {
  readonly now?: () => number;
}

/** See the module doc for the model; see `history-provider.ts` for the behavioral contract. */
export class GitHistoryProvider implements HistoryProvider {
  readonly kind = 'git' as const;

  private readonly snapshotStore: SnapshotStore;
  private readonly now: () => number;

  /** The in-memory filesystem holding the repo (`/repo`) and the name map (`/meta`). */
  private vol = new Volume();
  private fs = createFsFromVolume(this.vol);
  /** Display names by slug, in creation order (drives `listProjects`); mirrored to {@link META_FILE}. */
  private projects = new Map<string, string>();
  /**
   * The tail of the write queue. Commits check out a branch, write the working tree, stage and commit; two of those
   * interleaved commit on the same parent and the later ref update drops the earlier commit. The editor saves are
   * fire-and-forget, and a remote agent sends edits back to back, so every working-tree mutation runs here in turn.
   */
  private writes: Promise<unknown> = Promise.resolve();

  /** Runs `operation` after every earlier write has settled. */
  private exclusive<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.writes.then(operation, operation);
    this.writes = result.catch(() => undefined);
    return result;
  }

  constructor(snapshotStore: SnapshotStore, options: GitHistoryProviderOptions = {}) {
    this.snapshotStore = snapshotStore;
    this.now = options.now ?? Date.now;
  }

  async init(baselineTexts: ReadonlyMap<string, string>): Promise<void> {
    if (!(await this.baselineExists())) {
      await git.init({ fs: this.fs, dir: DIR, defaultBranch: BASELINE_PROJECT_ID });
      for (const [rootKey, text] of baselineTexts) {
        await this.commitOnBranch(BASELINE_PROJECT_ID, rootKey, text, 'baseline');
      }
      if (baselineTexts.size === 0) {
        // An empty project still needs a real branch tip for fork, checkout, and restore.
        // No prompt file or Root-Key trailer: this records initialization, not a prompt edit.
        await git.commit({
          fs: this.fs,
          dir: DIR,
          message: 'Initialize empty baseline',
          author: { ...AUTHOR, timestamp: Math.floor(this.now() / 1000), timezoneOffset: 0 },
        });
      }
      return;
    }
    // Already seeded (this boot or via restore) — commit only roots the baseline has never seen
    // (newly shipped roots). Seeding is the provider's OWN path onto the baseline branch: the
    // interface's baseline-immutability rule binds callers (commit/rename/delete reject), not init.
    const existing = await this.heads(BASELINE_PROJECT_ID);
    for (const [rootKey, text] of baselineTexts) {
      if (!existing.has(rootKey)) {
        await this.commitOnBranch(BASELINE_PROJECT_ID, rootKey, text, 'baseline');
      }
    }
  }

  async listProjects(): Promise<readonly ProjectRef[]> {
    return [...this.projects].map(([id, name]) => ({ id, name }));
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
    this.requireProject(sourceId);
    return this.exclusive(async () => {
      const id = this.uniqueSlug(slug);
      // Branching at the source's CURRENT head freezes the fork point — later commits on the source
      // must not leak into this project (contract: fork inherits heads, not the future). No checkout:
      // creation only writes a ref, the working tree stays wherever the last commit left it.
      const sourceOid = await this.headOid(sourceId);
      await git.branch({ fs: this.fs, dir: DIR, ref: this.refFor(id), object: sourceOid });
      this.projects.set(id, trimmed);
      await this.writeMeta();
      return { id, name: trimmed };
    });
  }

  async renameProject(id: string, name: string): Promise<void> {
    this.requireMutableProject(id, 'rename');
    const trimmed = name.trim();
    if (trimmed === '') {
      throw new Error('Project name must be non-empty.');
    }
    // Display name only — the branch and its commits are untouched (names live outside history).
    this.projects.set(id, trimmed);
    await this.writeMeta();
  }

  async deleteProject(id: string): Promise<void> {
    this.requireMutableProject(id, 'delete');
    await this.exclusive(async () => {
      // Never delete the branch HEAD points at — park on baseline first (the tree is always clean).
      await this.ensureCheckedOut(BASELINE_PROJECT_ID);
      await git.deleteBranch({ fs: this.fs, dir: DIR, ref: this.refFor(id) });
      // Only the ref goes — the commits stay in the object store, so forks keep their ancestry.
      this.projects.delete(id);
      await this.writeMeta();
    });
  }

  async commit(input: {
    readonly projectId: string;
    readonly rootKey: string;
    readonly text: string;
    readonly message: string;
  }): Promise<HistoryCommitRef> {
    this.requireMutableProject(input.projectId, 'commit to');
    return this.exclusive(() => this.commitOnBranch(input.projectId, input.rootKey, input.text, input.message));
  }

  async history(projectId: string, rootKey?: string): Promise<readonly HistoryCommitRef[]> {
    this.requireProject(projectId);
    // `git.log` walks the parent chain newest-first — exactly the contract's ordering; the branch
    // includes the baseline seed commits it forked from, so the chain bottoms out in 'baseline'.
    const entries = await git.log({ fs: this.fs, dir: DIR, ref: this.refFor(projectId) });
    const refs = entries.map((entry) => {
      const parsed = parseCommitMessage(entry.commit.message);
      return {
        id: entry.oid,
        message: parsed.message,
        timestampMs: entry.commit.author.timestamp * 1000,
        rootKey: parsed.rootKey,
      };
    });
    // Empty-tree initialization is Git ancestry, not a prompt history entry.
    return refs.filter((ref) => ref.rootKey !== '' && (rootKey === undefined || ref.rootKey === rootKey));
  }

  async readTextAt(projectId: string, commitId: string, rootKey: string): Promise<string | null> {
    this.requireProject(projectId);
    // Membership first: a commit on an unrelated project (or made after this project forked away)
    // is not part of this project's history, even though the shared object store could resolve it.
    const entries = await git.log({ fs: this.fs, dir: DIR, ref: this.refFor(projectId) });
    const entry = entries.find((candidate) => candidate.oid === commitId);
    if (entry === undefined) {
      return null;
    }
    // One root per commit (interface rule) — the trailer says which; any other root reads null,
    // even though the commit's TREE also carries the untouched roots inherited from its parent.
    if (parseCommitMessage(entry.commit.message).rootKey !== rootKey) {
      return null;
    }
    try {
      const { blob } = await git.readBlob({ fs: this.fs, dir: DIR, oid: commitId, filepath: rootPath(rootKey) });
      return new TextDecoder().decode(blob);
    } catch {
      return null; // The path is absent from that commit's tree.
    }
  }

  async heads(projectId: string): Promise<ReadonlyMap<string, string>> {
    this.requireProject(projectId);
    const headOid = await this.headOid(projectId);
    const result = new Map<string, string>();
    let tree: Awaited<ReturnType<typeof git.readTree>>['tree'];
    try {
      tree = (await git.readTree({ fs: this.fs, dir: DIR, oid: headOid, filepath: ROOTS_DIR })).tree;
    } catch {
      return result; // No roots/ directory at this head — a degenerate (empty) baseline.
    }
    for (const entry of tree) {
      if (entry.type !== 'blob' || !entry.path.endsWith('.md')) {
        continue;
      }
      const { blob } = await git.readBlob({ fs: this.fs, dir: DIR, oid: entry.oid });
      result.set(entry.path.slice(0, -'.md'.length), new TextDecoder().decode(blob));
    }
    return result;
  }

  /**
   * Archive layout (provider-specific by contract) — "the zip of the repo" (ADR-203 decision 5):
   * every volume file under `/repo` (working tree PLUS `.git`), nested under a single top-level
   * `prompt-project-<slug>/` directory, with `project.json` (`{ id, name, head }`) alongside.
   * Archives are `Record<string, string>`, so binary files (git objects, the index) are stored as
   * base64 under a `.b64` filename suffix while utf8-lossless files stay verbatim — a later import
   * reverses the encoding by suffix. Lossless either way: text entries proved they round-trip.
   */
  async exportArchive(projectId: string): Promise<Readonly<Record<string, string>>> {
    this.requireProject(projectId);
    return this.exclusive(() => this.archiveOf(projectId));
  }

  private async archiveOf(projectId: string): Promise<Readonly<Record<string, string>>> {
    const headOid = await this.headOid(projectId);
    // The archive captures the project's OWN working tree, so materialize its branch first.
    await this.ensureCheckedOut(this.refFor(projectId));
    const prefix = `prompt-project-${projectId}`;
    const snapshot = this.vol.toJSON(DIR, undefined, false, true) as Record<string, string | Uint8Array | null>;
    const archive: Record<string, string> = {};
    for (const [absPath, content] of Object.entries(snapshot)) {
      if (content === null) {
        continue; // Empty directory — carries no bytes.
      }
      const rel = absPath.slice(`${DIR}/`.length);
      const buffer = typeof content === 'string' ? Buffer.from(content, 'utf8') : Buffer.from(content);
      if (isUtf8Lossless(buffer)) {
        archive[`${prefix}/${rel}`] = buffer.toString('utf8');
      } else {
        archive[`${prefix}/${rel}.b64`] = buffer.toString('base64');
      }
    }
    const name = projectId === BASELINE_PROJECT_ID ? BASELINE_PROJECT_ID : (this.projects.get(projectId) ?? projectId);
    archive[`${prefix}/project.json`] = JSON.stringify({ id: projectId, name, head: headOid }, null, 2);
    return archive;
  }

  async persist(): Promise<void> {
    // asBuffer (4th arg) is LOAD-BEARING: the utf8-text default corrupts binary .git objects
    // (proven in git-spike-scenario.ts) — the typing still says string|null, hence the cast.
    const snapshot = this.vol.toJSON('/', undefined, false, true) as Record<string, string | Uint8Array | null>;
    const files: Record<string, string | { b64: string }> = {};
    for (const [path, content] of Object.entries(snapshot)) {
      if (content === null) {
        continue; // Empty directory — parents of files are recreated by Volume.fromJSON on restore.
      }
      files[path] = typeof content === 'string' ? content : { b64: Buffer.from(content).toString('base64') };
    }
    const envelope = { files, projects: Object.fromEntries(this.projects) };
    await this.snapshotStore.save(GIT_HISTORY_SNAPSHOT_KEY, JSON.stringify(envelope));
  }

  async restore(): Promise<boolean> {
    const raw = await this.snapshotStore.load(GIT_HISTORY_SNAPSHOT_KEY);
    if (raw === null) {
      return false;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return false;
    }
    const validated = storedEnvelope(parsed);
    if (validated instanceof type.errors) {
      return false;
    }
    const volumeJson: Record<string, string | Buffer> = {};
    for (const [path, content] of Object.entries(validated.files)) {
      volumeJson[path] = typeof content === 'string' ? content : Buffer.from(content.b64, 'base64');
    }
    const volume = Volume.fromJSON(volumeJson as unknown as DirectoryJSON);
    const fs = createFsFromVolume(volume);
    // Schema-valid is not repo-valid: prove the object store answers before adopting anything.
    // A snapshot whose .git bytes rotted returns false here, and the caller re-seeds via init().
    try {
      await git.log({ fs, dir: DIR, ref: BASELINE_PROJECT_ID });
    } catch {
      return false;
    }
    // Only replace state once the WHOLE snapshot validated AND the repo proved itself — never partial.
    this.vol = volume;
    this.fs = fs;
    this.projects = new Map(Object.entries(validated.projects));
    return true;
  }

  /** Writes `rootKey`'s text on the project's branch and commits it with the root-key trailer. */
  private async commitOnBranch(
    projectId: string,
    rootKey: string,
    text: string,
    message: string,
  ): Promise<HistoryCommitRef> {
    // Every provider operation leaves the tree clean and matching HEAD, so this checkout never conflicts.
    await this.ensureCheckedOut(this.refFor(projectId));
    const filepath = rootPath(rootKey);
    await this.fs.promises.mkdir(`${DIR}/${ROOTS_DIR}`, { recursive: true });
    await this.fs.promises.writeFile(`${DIR}/${filepath}`, text, { encoding: 'utf8' });
    await git.add({ fs: this.fs, dir: DIR, filepath });
    const author = { ...AUTHOR, timestamp: Math.floor(this.now() / 1000), timezoneOffset: 0 };
    const oid = await git.commit({
      fs: this.fs,
      dir: DIR,
      message: `${message}\n\nRoot-Key: ${rootKey}`,
      author,
    });
    return { id: oid, message, timestampMs: author.timestamp * 1000, rootKey };
  }

  /** Checks the branch out only when HEAD is elsewhere — a no-op on the fresh (pre-commit) repo. */
  private async ensureCheckedOut(ref: string): Promise<void> {
    const current = await git.currentBranch({ fs: this.fs, dir: DIR, fullname: false });
    if (current !== ref) {
      await git.checkout({ fs: this.fs, dir: DIR, ref });
    }
  }

  /** Whether the baseline branch has at least one commit — the "has init run" probe. */
  private async baselineExists(): Promise<boolean> {
    try {
      await git.resolveRef({ fs: this.fs, dir: DIR, ref: `refs/heads/${BASELINE_PROJECT_ID}` });
      return true;
    } catch {
      return false;
    }
  }

  /** The git ref behind a project id — `'baseline'` maps to itself, everything else under `project/`. */
  private refFor(projectId: string): string {
    return projectId === BASELINE_PROJECT_ID ? BASELINE_PROJECT_ID : `project/${projectId}`;
  }

  /** The commit oid at a project's branch head. */
  private headOid(projectId: string): Promise<string> {
    return git.resolveRef({ fs: this.fs, dir: DIR, ref: this.refFor(projectId) });
  }

  /** Mirrors the in-memory name map to {@link META_FILE} so the volume snapshot is self-describing. */
  private async writeMeta(): Promise<void> {
    await this.fs.promises.mkdir(META_FILE.slice(0, META_FILE.lastIndexOf('/')), { recursive: true });
    await this.fs.promises.writeFile(META_FILE, JSON.stringify(Object.fromEntries(this.projects), null, 2), {
      encoding: 'utf8',
    });
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

  private requireProject(id: string): void {
    if (id !== BASELINE_PROJECT_ID && !this.projects.has(id)) {
      throw new Error(`Unknown project "${id}".`);
    }
  }

  private requireMutableProject(id: string, verb: string): void {
    if (id === BASELINE_PROJECT_ID) {
      throw new Error(`Cannot ${verb} the immutable baseline.`);
    }
    this.requireProject(id);
  }
}

/** The factory `history-factory.ts`'s lazy `loadGitProvider` hook constructs the provider through. */
export function createGitHistoryProvider(store: SnapshotStore, options?: GitHistoryProviderOptions): HistoryProvider {
  return new GitHistoryProvider(store, options);
}
