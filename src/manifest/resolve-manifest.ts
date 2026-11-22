import * as fs from 'node:fs/promises';
import path from 'node:path';
import { type } from 'arktype';
import { DEFAULT_MANIFEST } from './default-manifest';
import { type StudioManifestParsed, validateStudioManifest } from './manifest-schema';

/**
 * Resolves the ACTIVE studio manifest (ADR-235). Node-only — imported by the standalone server
 * (`server/app.ts`) and the Vite dev plugin (`src/bridge/fs-bridge.ts`), never by SPA code (the
 * SPA receives the already-resolved manifest over `GET /__studio/manifest`).
 *
 * Resolution order, highest precedence first — the first candidate that EXISTS is used; a
 * candidate that exists but is unreadable or fails schema validation makes the whole resolution
 * INVALID rather than silently falling through (an operator who mounted a broken manifest wants
 * the failure visible, not a quiet downgrade to the baked default):
 *
 *   1. `manifestPath` — `STUDIO_MANIFEST_PATH` (explicit operator override, any location).
 *      If set, a missing file is ALSO invalid: naming a path that doesn't exist is a
 *      misconfiguration, not an absence.
 *   2. The baked image copy at `/studio-manifest/manifest.json` (exists only in the container;
 *      a file bind-mount at exactly that path shadows the baked file — a DIRECTORY mount would
 *      hide it entirely, which is why the Dockerfile declares no VOLUME and the run docs say
 *      "mount a file").
 *   3. The app-tree fallback `apps/prompt-studio/src/manifest/default.manifest.json` — the dev
 *      server path, and identical to the baked copy by construction.
 *
 * INVALID never crashes the boot: callers log the reason server-side, `/__studio/manifest`
 * returns 500 so the operator notices, and the bridge allowlist falls back to
 * `DEFAULT_MANIFEST.contentRoots` (equal to the pre-manifest `ALLOWED_ROOTS`), so the studio
 * keeps working with its shipped configuration. A manifest can widen the roots; a broken
 * manifest can never widen anything.
 */

/** Where the Docker image bakes the manifest (see the module doc and the Dockerfile). */
export const BAKED_MANIFEST_PATH = '/studio-manifest/manifest.json';

export type ResolvedManifestSource = 'env' | 'baked' | 'app';

export type ResolvedManifest =
  | { readonly status: 'ok'; readonly manifest: StudioManifestParsed; readonly source: ResolvedManifestSource }
  | {
      readonly status: 'invalid';
      readonly source: ResolvedManifestSource;
      /** Server-side logging only — may quote the validation error; never sent to the client. */
      readonly detail: string;
    };

export interface ResolveManifestOptions {
  /** Absolute app root (`apps/prompt-studio`) — anchors the app-tree fallback. */
  appRoot: string;
  /** Explicit operator override (`STUDIO_MANIFEST_PATH`); absolute or resolved against cwd. */
  manifestPath?: string;
  /** Override for tests; defaults to the container's baked path. */
  bakedManifestPath?: string;
}

interface ManifestCandidate {
  source: ResolvedManifestSource;
  /** Absolute path to a file that must exist and validate. */
  filePath: string;
  /** A missing file at this candidate is a misconfiguration (invalid), not an absence. */
  required: boolean;
}

async function tryReadManifest(filePath: string): Promise<StudioManifestParsed | string> {
  let text: string;
  try {
    text = await fs.readFile(filePath, 'utf8');
  } catch (error) {
    return `unreadable: ${String(error)}`;
  }
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (error) {
    return `not valid JSON: ${String(error)}`;
  }
  const parsed = validateStudioManifest(json);
  if (parsed instanceof type.errors) {
    const fields = [...parsed]
      .map((error) => (error.path.length > 0 ? error.path.join('.') : '(root)'))
      .sort()
      .join(', ');
    return `failed schema validation at: ${fields}`;
  }
  return parsed;
}

/**
 * Resolves the active manifest per the precedence chain in the module doc. Pure with respect to
 * its options (every path is injected), so the precedence table is directly unit-testable.
 */
export async function resolveActiveManifest(options: ResolveManifestOptions): Promise<ResolvedManifest> {
  const { appRoot, manifestPath, bakedManifestPath = BAKED_MANIFEST_PATH } = options;

  const candidates: ManifestCandidate[] = [];
  if (manifestPath !== undefined && manifestPath.length > 0) {
    candidates.push({ source: 'env', filePath: path.resolve(manifestPath), required: true });
  }
  candidates.push({ source: 'baked', filePath: bakedManifestPath, required: false });
  candidates.push({
    source: 'app',
    filePath: path.resolve(appRoot, 'src/manifest/default.manifest.json'),
    required: true,
  });

  for (const candidate of candidates) {
    const exists = await fs
      .access(candidate.filePath)
      .then(() => true)
      .catch(() => false);
    if (!exists) {
      if (candidate.required) {
        return {
          status: 'invalid',
          source: candidate.source,
          detail: `manifest file does not exist: ${candidate.filePath}`,
        };
      }
      continue; // absent optional candidate (the baked path outside the container) — try the next
    }

    const outcome = await tryReadManifest(candidate.filePath);
    if (typeof outcome === 'string') {
      return { status: 'invalid', source: candidate.source, detail: `manifest ${outcome} (${candidate.filePath})` };
    }
    return { status: 'ok', manifest: outcome, source: candidate.source };
  }

  // Unreachable in practice: the app-tree candidate is `required`, so the loop either resolved a
  // candidate or returned invalid. Kept as an exhaustive fallback rather than a thrown error so a
  // future edit to the chain can't turn "no manifest found" into a boot crash.
  return {
    status: 'invalid',
    source: 'app',
    detail: 'no manifest candidate resolved',
  };
}

/**
 * The bridge allowlist for a resolution outcome: the active manifest's roots when valid, the
 * shipped default's roots when not — so an invalid operator manifest can only ever SHRINK the
 * bridge back to what the studio shipped with, never widen or crash it.
 */
export function allowedRootsFor(resolved: ResolvedManifest): readonly string[] {
  return resolved.status === 'ok' ? [...resolved.manifest.contentRoots] : [...DEFAULT_MANIFEST.contentRoots];
}
