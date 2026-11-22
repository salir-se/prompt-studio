import { type } from 'arktype';

/**
 * The studio manifest schema (ADR-235).
 *
 * The manifest is the studio's declarative editor configuration: it names the content roots the
 * bridge may read, where skills live, where exports overlay, how the catalog is built, and which
 * starting configurations ("baselines") a developer can seed a new project from. It is METADATA
 * ONLY — never prompt prose. ADR-204 Option 3 rejected baking prompt content into the image; the
 * manifest is deliberately shaped so that baking it violates none of that rationale: a manifest
 * can point AT prose in the operator's mounted repo, but carries none itself.
 *
 * Untrusted input discipline: the active manifest can be operator-supplied (a file bind-mounted
 * over the baked copy, or `STUDIO_MANIFEST_PATH`), so it parses through arktype with `'+': 'reject'`
 * — anything the schema does not declare is rejected outright, per the repo's runtime-validation
 * rule (ADR-066). This module is browser-safe (no node imports): the SPA validates manifests it
 * fetches from `/__studio/manifest` with the same schema the server used before serving them.
 */

/** Hard cap on `contentRoots` — bounds how far an operator manifest can widen the bridge. */
export const MAX_CONTENT_ROOTS = 8;

/** A repo TS constant the studio reads document text from (e.g. `SCOUT_PROMPT`). */
export interface StudioManifestSymbolSource {
  readonly kind: 'symbol';
  readonly module: string;
  readonly symbol: string;
}

/** A plain repo file the studio reads document text from (third-party manifests: `.md` files). */
export interface StudioManifestFileSource {
  readonly kind: 'file';
  readonly path: string;
}

export type StudioManifestDocumentSource = StudioManifestSymbolSource | StudioManifestFileSource;

/** One editable document the studio's catalog exposes. `id` is the provider rootKey — flat, no `/`. */
export interface StudioManifestDocument {
  readonly id: string;
  readonly title: string;
  readonly group?: 'prompts' | 'fragments' | 'skills';
  readonly source: StudioManifestDocumentSource;
  readonly editableKeys?: readonly string[];
}

/**
 * A starting configuration offered by "New configuration from …". `positioning: 'reference'`
 * marks sales-mode calibration references (ADR-205 Option 3 rejected hard-coded *product*
 * presets; these are developer-side starting points in a dev tool, and the UI must label them
 * as references, never presets).
 */
export interface StudioManifestBaseline {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  readonly positioning?: 'shipped' | 'reference';
  readonly source: StudioManifestBaselineSource;
}

export type StudioManifestBaselineSource =
  { readonly kind: 'shipped' } | { readonly kind: 'sales-mode-approach'; readonly approachId: string };

export interface StudioManifest {
  readonly schemaVersion: 1;
  /** Identifies the prompt tree this manifest describes (informational). */
  readonly name: string;
  /** Repo-relative directories the bridge may read. Widens the ROOTS, never the RULES. */
  readonly contentRoots: readonly string[];
  /** Repo-relative root containing `SKILL.md` trees. */
  readonly skillsRoot: string;
  /** Repo-relative prefix export overlay ZIPs are shaped against. */
  readonly exportRoot: string;
  readonly catalog: StudioManifestCatalog;
  /** Additional documents appended to the catalog (fragment documents like icp/persona). */
  readonly extraDocuments?: readonly StudioManifestDocument[];
  readonly baselines: readonly StudioManifestBaseline[];
}

export type StudioManifestCatalog =
  | { readonly source: 'legacy-inventory' }
  | { readonly source: 'explicit'; readonly documents: readonly StudioManifestDocument[] };

/**
 * A repo-relative directory path, validated WITHOUT `node:path` so this module stays
 * browser-safe: no leading `/`, no drive letter, no backslashes, at least one non-empty
 * segment, and not `.` (the repo root itself is never an allowed root).
 */
export function isRelativeDirPath(value: string): boolean {
  if (value.length === 0 || value === '.') {
    return false;
  }
  if (value.startsWith('/') || value.startsWith('\\') || /^[a-zA-Z]:/.test(value)) {
    return false;
  }
  // Split on a SINGLE separator: a `+` quantifier would collapse 'a//b' before the empty-segment
  // check below could see it (verified — 'a//b' passed with `[\\/]+`), letting doubled separators
  // smuggle through as if they were one.
  const rawSegments = value.split(/[\\/]/);
  const segments = rawSegments.filter(Boolean);
  if (segments.length !== rawSegments.length) {
    return false; // contained an empty segment (leading/trailing/doubled separator)
  }
  return segments.every((segment) => segment !== '.' && segment !== '..');
}

const documentIdType = type('string').narrow(
  (id, ctx) => (id.length > 0 && !id.includes('/')) || ctx.reject({ expected: 'a flat id with no "/"', actual: '' }),
);

// Every nested object repeats the top level's `'+': 'reject'`: arktype applies it per object
// type, so a single top-level declaration would let an unknown key slip through any nested
// object (silently STRIPPED, not rejected) — verified by the recursive-strictness tests.
const symbolSourceType = type({
  '+': 'reject',
  kind: "'symbol'",
  module: 'string > 0',
  symbol: 'string > 0',
});

const fileSourceType = type({
  '+': 'reject',
  kind: "'file'",
  // The same segment rules as a content root (relative-only, no `.`/`..` segments, no empty
  // segments): `isRelativeDirPath` checks segment STRUCTURE, which a file path satisfies exactly
  // as a directory path does — its final segment just happens to carry an extension.
  path: type('string > 0').narrow(
    (p, ctx) => isRelativeDirPath(p) || ctx.reject({ expected: 'a repo-relative file path', actual: '' }),
  ),
});

const documentType = type({
  '+': 'reject',
  id: documentIdType,
  title: 'string > 0',
  'group?': "'prompts' | 'fragments' | 'skills'",
  source: symbolSourceType.or(fileSourceType),
  'editableKeys?': 'string[]',
});

const baselineSourceType = type({
  '+': 'reject',
  kind: "'shipped'",
}).or({
  '+': 'reject',
  kind: "'sales-mode-approach'",
  approachId: 'string > 0',
});

const baselineType = type({
  '+': 'reject',
  id: documentIdType,
  label: 'string > 0',
  description: 'string > 0',
  'positioning?': "'shipped' | 'reference'",
  source: baselineSourceType,
});

const catalogType = type({
  '+': 'reject',
  source: "'legacy-inventory'",
}).or({
  '+': 'reject',
  source: "'explicit'",
  documents: type(documentType).array(),
});

/**
 * The single validation boundary for manifests. `'+': 'reject'` — undeclared keys are rejected,
 * not ignored, because the manifest is operator-influenced input (the same discipline as every
 * other arktype boundary in this repo). The returned errors' `path` values name the offending
 * field for the boot-time log; never echo the input itself into a client-visible surface.
 */
export const STUDIO_MANIFEST_SCHEMA = type({
  // The manifest is operator-influenced input — undeclared keys are REJECTED, not ignored
  // (the repo-wide arktype boundary rule; this line is the one the "rejects an unknown
  // top-level key" test guards, and the one a lazy edit would drop).
  '+': 'reject',
  schemaVersion: '1',
  name: 'string > 0',
  contentRoots: type('string')
    .array()
    .narrow((roots, ctx) => roots.length > 0 || ctx.reject({ expected: 'at least one content root', actual: '' }))
    .narrow(
      (roots, ctx) =>
        roots.length <= MAX_CONTENT_ROOTS ||
        ctx.reject({ expected: `at most ${MAX_CONTENT_ROOTS} content roots`, actual: '' }),
    )
    .narrow((roots, ctx) => {
      const offenders = roots.filter((root) => !isRelativeDirPath(root));
      return offenders.length === 0 || ctx.reject({ expected: 'repo-relative directory paths', actual: '' });
    })
    .narrow((roots, ctx) => {
      const seen = new Set<string>();
      for (const root of roots) {
        if (seen.has(root)) {
          return ctx.reject({ expected: 'unique content roots', actual: '' });
        }
        seen.add(root);
      }
      return true;
    }),
  skillsRoot: type('string').narrow(
    (root, ctx) => isRelativeDirPath(root) || ctx.reject({ expected: 'a repo-relative directory path', actual: '' }),
  ),
  exportRoot: type('string').narrow(
    (root, ctx) => isRelativeDirPath(root) || ctx.reject({ expected: 'a repo-relative directory path', actual: '' }),
  ),
  catalog: catalogType,
  'extraDocuments?': type(documentType).array(),
  baselines: type(baselineType)
    .array()
    .narrow((baselines, ctx) => baselines.length > 0 || ctx.reject({ expected: 'at least one baseline', actual: '' }))
    .narrow((baselines, ctx) => {
      const seen = new Set<string>();
      for (const baseline of baselines) {
        if (seen.has(baseline.id)) {
          return ctx.reject({ expected: 'unique baseline ids', actual: '' });
        }
        seen.add(baseline.id);
      }
      return true;
    }),
});

export type StudioManifestParsed = typeof STUDIO_MANIFEST_SCHEMA.infer;

/** Parses and validates a raw manifest value. Returns the manifest, or arktype errors. */
export function validateStudioManifest(input: unknown): StudioManifestParsed | type.errors {
  return STUDIO_MANIFEST_SCHEMA(input);
}
