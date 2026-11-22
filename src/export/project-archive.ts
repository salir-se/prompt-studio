/**
 * Project archives — ADR-203 decision 5's SECOND archive flavor, "the zip of the repo": a complete
 * portable save-file of one prompt project, as opposed to the per-root blueprint OVERLAY
 * (`export-flow.ts`) that unzips clean at the monorepo root. Every entry nests under a single
 * top-level `prompt-project-<slug>/` directory precisely so the two flavors are structurally
 * impossible to confuse — a bare `.git/` unzipped at the monorepo root would corrupt the real
 * repository, so a project archive's `.git` always arrives fenced inside its own directory, and
 * `isProjectArchive` detects the flavor from that structure alone.
 *
 * The provider archive layouts this module bridges (both provider-specific by the
 * `HistoryProvider.exportArchive` contract — see each provider's own doc):
 *  - **git** (`git-history-provider.ts`) — already nested under `prompt-project-<slug>/`: the
 *    working tree (`roots/<rootKey>.md`) PLUS `.git` (binary objects base64-encoded under a `.b64`
 *    filename suffix), with `project.json` = `{ id, name, head }`.
 *  - **simple** (`simple-history-provider.ts`) — UNprefixed: `project.json` =
 *    `{ id, name, heads: { rootKey: blobSha } }`, `history/commits.json`, `history/blobs.json`.
 *    `buildProjectArchive` adds the `prompt-project-<slug>/` prefix so both flavors nest
 *    identically (normalized HERE — the providers are not modified).
 *
 * IMPORT IS HEADS-ONLY BY DESIGN: `readProjectArchiveHeads` recovers the project name and each
 * root's newest committed text — enough to recreate the project's current state. Importing the
 * FULL history would need a provider interface addition (an `importArchive` counterpart to
 * `exportArchive`) and is deferred; meanwhile a git-flavor archive's `.git` stays fully
 * inspectable offline with ordinary git tooling (unzip, then `git log`/`git show` inside
 * `prompt-project-<slug>/` after decoding the `.b64` entries).
 */

import { type } from 'arktype';
import type { HistoryProvider } from '../vcs/history-provider';
import { packZip, type ZipLimits } from './zip';

const MIB = 1024 * 1024;

/**
 * Resource bounds for PROJECT archives (ADR-203 decision 5's "own, larger entry-count limit"):
 * git's loose-object churn makes a repo zip entry-HEAVY — every commit lands blob/tree/commit
 * objects as separate files under `.git/objects/`, so the overlay tier's 256-entry
 * `DEFAULT_ZIP_LIMITS` would reject a modest project's history. Only archives detected as
 * project-shaped benefit from this headroom: overlay imports keep the strict `DEFAULT_ZIP_LIMITS`
 * entry bound (re-checked after flavor detection — see `App.tsx`'s single-unpack note).
 */
export const PROJECT_ARCHIVE_ZIP_LIMITS: ZipLimits = {
  maxEntries: 4096,
  maxEntryBytes: 8 * MIB,
  maxTotalBytes: 64 * MIB,
};

/** Thrown for every malformed-project-archive rejection — the message names the offending file. */
export class ProjectArchiveError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProjectArchiveError';
  }
}

/** The archive's top-level directory name for a project slug — also the download filename's stem. */
function archiveDirFor(projectId: string): string {
  return `prompt-project-${projectId}`;
}

/**
 * The two providers' ACTUAL `project.json` shapes, validated strictly per flavor as a union —
 * `'+': 'reject'` on each branch so an unknown-shape descriptor fails loudly instead of importing.
 * The `head` (git: head commit oid) vs `heads` (simple: rootKey → blobSha) field is also what
 * discriminates the flavors after validation.
 */
const gitProjectDescriptor = type({ id: 'string', name: 'string', head: 'string', '+': 'reject' });
const simpleProjectDescriptor = type({
  id: 'string',
  name: 'string',
  heads: { '[string]': 'string' },
  '+': 'reject',
});
const projectDescriptor = gitProjectDescriptor.or(simpleProjectDescriptor);

/** `history/blobs.json`'s shape — the simple provider's content-addressed `{ sha: text }` map. */
const blobsFile = type({ '[string]': 'string' });

/**
 * Builds the downloadable project archive for `projectId`: the provider's `exportArchive` map,
 * normalized so EVERY path nests under `prompt-project-<slug>/` (the git provider already
 * prefixes; the simple provider's unprefixed paths gain the prefix here), packed into ZIP bytes.
 * `projectName` backstops a `project.json` for a provider archive that carries none (both real
 * providers include one, so this only guards a future provider against producing an archive
 * `readProjectArchiveHeads` would reject as malformed).
 */
export async function buildProjectArchive(
  provider: HistoryProvider,
  projectId: string,
  projectName: string,
): Promise<{ bytes: Uint8Array; filename: string }> {
  const exported = await provider.exportArchive(projectId);
  const topDir = archiveDirFor(projectId);
  const nested: Record<string, string> = {};
  for (const [path, content] of Object.entries(exported)) {
    nested[path.startsWith(`${topDir}/`) ? path : `${topDir}/${path}`] = content;
  }
  const descriptorPath = `${topDir}/project.json`;
  if (nested[descriptorPath] === undefined) {
    nested[descriptorPath] = JSON.stringify({ id: projectId, name: projectName, heads: {} }, null, 2);
  }
  return { bytes: packZip(nested), filename: `${topDir}.zip` };
}

/**
 * The single `prompt-project-*` top-level directory ALL of `files` nests under, or `null` when the
 * map is empty, carries a top-level file, mixes top directories, or uses any other top name — the
 * structural test that makes the save-file flavor impossible to confuse with a repo overlay.
 */
function projectArchiveTopDir(files: Readonly<Record<string, string>>): string | null {
  const paths = Object.keys(files);
  if (paths.length === 0) return null;
  let topDir: string | null = null;
  for (const path of paths) {
    const slash = path.indexOf('/');
    if (slash === -1) return null; // A top-level FILE — overlay-shaped, not a nested save-file.
    const top = path.slice(0, slash);
    if (!top.startsWith(archiveDirFor(''))) return null;
    if (topDir === null) topDir = top;
    else if (top !== topDir) return null;
  }
  return topDir;
}

/** True when `files` is project-archive-shaped: every path under one `prompt-project-*` top dir. */
export function isProjectArchive(files: Readonly<Record<string, string>>): boolean {
  return projectArchiveTopDir(files) !== null;
}

/** Parses and validates `<topDir>/project.json`, throwing a named error for every malformed shape. */
function parseProjectDescriptor(files: Readonly<Record<string, string>>, topDir: string) {
  const path = `${topDir}/project.json`;
  const raw = files[path];
  if (raw === undefined) {
    throw new ProjectArchiveError(`Project archive is missing '${path}'.`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new ProjectArchiveError(`'${path}' is not valid JSON.`);
  }
  const validated = projectDescriptor(parsed);
  if (validated instanceof type.errors) {
    throw new ProjectArchiveError(`'${path}' is not a valid project descriptor: ${validated.summary}`);
  }
  return validated;
}

/**
 * Git flavor heads: the working tree files `roots/<rootKey>.md` at the archive root — the export
 * checked the project's branch out before snapshotting, so the working tree IS the project's
 * heads. Prompt texts are utf8, so a root stored under the provider's binary `.b64` suffix can
 * only mean corruption — rejected by name rather than silently dropping the root.
 */
function readGitHeads(files: Readonly<Record<string, string>>, topDir: string): Map<string, string> {
  const rootsPrefix = `${topDir}/roots/`;
  const heads = new Map<string, string>();
  for (const [path, content] of Object.entries(files)) {
    if (!path.startsWith(rootsPrefix)) continue;
    const rel = path.slice(rootsPrefix.length);
    if (rel.includes('/')) continue; // rootKeys are flat by construction (the provider's rootPath).
    if (rel.endsWith('.md.b64')) {
      throw new ProjectArchiveError(`'${path}' is not utf-8 text — a prompt root must be readable text.`);
    }
    if (rel.endsWith('.md')) heads.set(rel.slice(0, -'.md'.length), content);
  }
  return heads;
}

/**
 * Simple flavor heads: `project.json`'s `heads` already records each root's newest blob sha (the
 * provider walked to each root's newest commit at EXPORT time), so import resolves it directly
 * against `history/blobs.json` instead of re-walking `history/commits.json` — same result, one hop.
 */
function readSimpleHeads(
  files: Readonly<Record<string, string>>,
  topDir: string,
  headShas: Readonly<Record<string, string>>,
): Map<string, string> {
  const heads = new Map<string, string>();
  if (Object.keys(headShas).length === 0) {
    return heads; // Zero heads need zero blobs — e.g. the synthesized fallback descriptor.
  }
  const path = `${topDir}/history/blobs.json`;
  const raw = files[path];
  if (raw === undefined) {
    throw new ProjectArchiveError(`Project archive is missing '${path}'.`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new ProjectArchiveError(`'${path}' is not valid JSON.`);
  }
  const validated = blobsFile(parsed);
  if (validated instanceof type.errors) {
    throw new ProjectArchiveError(`'${path}' is not a valid blob map: ${validated.summary}`);
  }
  for (const [rootKey, blobSha] of Object.entries(headShas)) {
    const text = validated[blobSha];
    if (text === undefined) {
      throw new ProjectArchiveError(`'${path}' is missing blob ${blobSha} for root "${rootKey}".`);
    }
    heads.set(rootKey, text);
  }
  return heads;
}

/**
 * Reads a project archive's display name and per-root HEAD texts (heads-only by design — see the
 * module doc), throwing `ProjectArchiveError` (message naming the offending file) on every
 * malformed shape. The flavor is discriminated by the validated `project.json`: `head` → git
 * (texts from the working tree), `heads` → simple (texts from the blob map).
 */
export function readProjectArchiveHeads(files: Readonly<Record<string, string>>): {
  name: string;
  heads: ReadonlyMap<string, string>;
} {
  const topDir = projectArchiveTopDir(files);
  if (topDir === null) {
    throw new ProjectArchiveError(
      'Not a project archive — expected every entry under a single prompt-project-<slug>/ directory.',
    );
  }
  const descriptor = parseProjectDescriptor(files, topDir);
  const heads = 'head' in descriptor ? readGitHeads(files, topDir) : readSimpleHeads(files, topDir, descriptor.heads);
  return { name: descriptor.name, heads };
}
