/**
 * Pure file-map serializer/deserializer for the OBSERVED prompt model
 * (`PromptTree`, ADR-200) into the ADR-202 §9 blueprint export layout.
 *
 * A serialized blueprint is a plain `path → text` record whose paths form a
 * diffable overlay on this repository: everything is rooted at
 * `packages/prompts/src/blueprints/<root>/…`, so unzipping an export at the
 * repo root produces reviewable files in a stable, conventional location.
 * This module deliberately knows NOTHING about zip bytes — a sibling task
 * wraps `BlueprintFileMap`s in an archive. Keeping the map pure, synchronous,
 * and deterministic is what makes it trivially testable and reusable from
 * both the SPA and workers.
 *
 * THE LOAD-BEARING INVARIANT — byte transparency. `tree.text` is the
 * complete, unmodified prompt source (see `PromptTree.text`), and each
 * top-level node's `range` covers its full extent as offsets into that
 * string. The serializer splits the source into top-level section files
 * (`tree.text.slice(range.start, range.end)`, byte-exact, never trimmed or
 * normalized) plus `gaps` — the EXACT interstitial bytes before, between, and
 * after the top-level ranges, stored in `blueprint.json`. Reassembly is then
 * pure concatenation: `gaps[0] + section₀ + gaps[1] + … + gaps[n]`, and
 * `deserializeBlueprint(serializeBlueprint(x)).text === x.tree.text` holds
 * for every parseable prompt. Nested children stay INSIDE their parent's
 * section file (a parent range includes its descendants); they never get a
 * file of their own.
 *
 * Other constraints this module upholds:
 * - `promptSha256` is caller-supplied. Hashing needs WebCrypto and an await;
 *   this serializer stays sync and WebCrypto-free so it can run anywhere
 *   (tests, workers, SPA) with no async ceremony. The caller hashes.
 * - `layout.json` is the ONLY file that may carry canvas positions — layout
 *   is non-semantic, and isolating it means two exports differing only in
 *   node positions diff in exactly one file.
 * - No emitted path ever contains `..`, a leading `/`, or `\`. Every path is
 *   built from fixed literals, a validated root segment, zero-padded digits,
 *   and slugs restricted to `[a-z0-9-]`, so traversal sequences cannot occur.
 * - All JSON files are emitted as `JSON.stringify(value, null, 2) + '\n'` so
 *   exports are stable under re-serialization and diff cleanly.
 * - Deserialization validates EVERY JSON file with ArkType using
 *   `'+': 'reject'` (ADR-066) — an unknown key anywhere is a hard error, not
 *   silently ignored drift.
 */

import { type Type, type } from 'arktype';
import { parsePromptDesign, type PromptDesign } from '../prompt-design';
import type { PromptTree } from './types';

// ── Public types ─────────────────────────────────────────────────────────────

/**
 * A blueprint rendered as `path → text content`. All files are text (the
 * JSON documents included) — there are deliberately no binary entries, which
 * is what lets the sibling zip task treat every entry uniformly.
 */
export type BlueprintFileMap = Readonly<Record<string, string>>;

/**
 * One `{{variable}}` declaration carried alongside the prompt text. This is
 * export metadata, not a `PromptVariablePolicy` from
 * `../composition-contracts` — lifecycle/encoding/schema are authored
 * decisions that do not exist yet in the observed model (see the module doc
 * on `./types`), so the export carries only what an operator can state about
 * a variable today.
 */
export interface BlueprintVariableDeclaration {
  readonly name: string;
  readonly purpose: string;
  readonly sample: string;
  readonly required: boolean;
  readonly source: 'builtin' | 'session';
}

/** Everything `serializeBlueprint` needs; see the field docs for provenance. */
export interface SerializeBlueprintInput {
  /** The parsed prompt. `tree.text` MUST be the complete original source (guaranteed by `parsePromptTree`). */
  readonly tree: PromptTree;
  /** Variable declarations to export; emitted sorted by `name` for determinism. */
  readonly variables: readonly BlueprintVariableDeclaration[];
  /** Canvas positions keyed by node id — non-semantic, isolated into `layout.json` and nowhere else. */
  readonly layout: Readonly<Record<string, { readonly x: number; readonly y: number }>>;
  /** Caller-computed SHA-256 of the prompt text — supplied, not computed, to keep this module sync + WebCrypto-free. */
  readonly promptSha256: string;
  /** Present when the export bypassed a gate; defaults to `forced: false`, `overriddenReasons: []`. */
  readonly exportRecord?: { readonly forced: boolean; readonly overriddenReasons: readonly string[] };
  /** Complete Studio-authored contract and verification configuration, when this is an authored prompt. */
  readonly design?: PromptDesign;
}

/** Shape of `manifest.json` — the export's integrity/provenance summary. */
export interface BlueprintManifest {
  readonly format: typeof BLUEPRINT_FORMAT;
  readonly root: string;
  readonly promptSha256: string;
  readonly sectionCount: number;
  readonly variableCount: number;
  readonly forced: boolean;
  readonly overriddenReasons: readonly string[];
}

/** The result of `deserializeBlueprint`: everything needed to reconstruct the export's inputs. */
export interface DeserializedBlueprint {
  /** The `<root>` directory segment the file map was rooted under (equals the serialized `tree.key`). */
  root: string;
  /** The reassembled prompt source — byte-identical to the `tree.text` that was serialized. */
  text: string;
  variables: readonly BlueprintVariableDeclaration[];
  layout: Readonly<Record<string, { readonly x: number; readonly y: number }>>;
  manifest: BlueprintManifest;
  design?: PromptDesign;
}

/**
 * Thrown by `deserializeBlueprint` for any malformed input. Always names the
 * offending `file` (a map path, or the `'<file-map>'` sentinel when the
 * problem is the map as a whole, e.g. zero/multiple roots) and a stable,
 * machine-matchable `reason` code — match on `reason`, never on `message`,
 * which is free-text and may change wording.
 */
export class BlueprintParseError extends Error {
  readonly file: string;
  readonly reason: string;

  constructor(file: string, reason: string, message: string) {
    super(message);
    this.name = 'BlueprintParseError';
    this.file = file;
    this.reason = reason;
  }
}

// ── Layout constants ─────────────────────────────────────────────────────────

/** Format discriminator stamped into `blueprint.json` and `manifest.json`. Bump only with a migration story. */
const BLUEPRINT_FORMAT = 'salir-prompt-blueprint@1' as const;

/** Fixed repo-overlay prefix every blueprint file lives under (ADR-202 §9). */
const BLUEPRINT_PATH_PREFIX = 'packages/prompts/src/blueprints/';

/**
 * A root directory segment must be a single safe path segment: no `/`, no
 * `\`, no `.` at all (which rules out `..` traversal by construction). Every
 * real prompt key (`scout`, `researcher`, `critic-inbound`, …) satisfies this.
 */
const SAFE_ROOT_RE = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;

/** Extracts the `<root>` segment from a blueprint file path; non-matching paths are foreign to the overlay. */
const ROOT_PATH_RE = /^packages\/prompts\/src\/blueprints\/([A-Za-z0-9][A-Za-z0-9_-]*)\//;

/** Sentinel `file` value on `BlueprintParseError` when no single path is at fault. */
const FILE_MAP_SENTINEL = '<file-map>';

// ── Serialization helpers ────────────────────────────────────────────────────

/** Canonical JSON emission: 2-space pretty print + trailing newline, so files diff cleanly. */
function toJsonFile(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

/**
 * Filename slug: lowercased, runs of non-alphanumerics collapsed to a single
 * `-`, trimmed of leading/trailing `-`, capped at 40 chars (re-trimmed in
 * case the cap cut mid-run). May legitimately come out empty (e.g. a title
 * of pure punctuation) — callers must supply a fallback.
 */
function sanitizeSlug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/g, '');
}

/** Slug for a section filename: the title's slug, falling back to the node id sanitized the same way. */
function sectionSlug(title: string, nodeId: string): string {
  return sanitizeSlug(title) || sanitizeSlug(nodeId) || 'section';
}

/** Declarations re-emitted with a fixed key order and sorted by `name` (code-unit order — locale-independent). */
function sortedDeclarations(variables: readonly BlueprintVariableDeclaration[]): BlueprintVariableDeclaration[] {
  return variables
    .map((d) => ({ name: d.name, purpose: d.purpose, sample: d.sample, required: d.required, source: d.source }))
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

/** Positions re-keyed in sorted order so `layout.json` is deterministic regardless of caller insertion order. */
function sortedPositions(
  layout: Readonly<Record<string, { readonly x: number; readonly y: number }>>,
): Record<string, { x: number; y: number }> {
  const positions: Record<string, { x: number; y: number }> = {};
  for (const key of Object.keys(layout).sort()) {
    positions[key] = { x: layout[key].x, y: layout[key].y };
  }
  return positions;
}

// ── serializeBlueprint ───────────────────────────────────────────────────────

/**
 * Serializes a parsed prompt into its blueprint file map. Pure, synchronous,
 * deterministic — same input, same map, byte for byte.
 *
 * Emits, all under `packages/prompts/src/blueprints/${tree.key}/`:
 * - `blueprint.json` — top-level section index (source order) + the exact
 *   interstitial `gaps` (always `sections.length + 1` entries; `[tree.text]`
 *   when there are zero sections).
 * - `sections/NN-<slug>.md` — one file per TOP-LEVEL node, content
 *   byte-exact from `tree.text`. Nested children ride inside their parent's
 *   file (a node's range includes its descendants). The 1-based, zero-padded
 *   `NN` prefix alone already makes every filename unique — two sections with
 *   identical titles (identical slugs) still get distinct `NN`s — so no
 *   further collision handling is needed or performed.
 * - `variables/variables.json`, `layout.json`, `manifest.json` — see the
 *   module doc for each file's contract.
 *
 * Throws a plain `Error` (not `BlueprintParseError` — that is reserved for
 * deserialization) when `tree.key` is not a safe path segment, since a bad
 * key would break the no-`..`/no-`/`/no-`\` path guarantee.
 */
export function serializeBlueprint(input: SerializeBlueprintInput): BlueprintFileMap {
  const { tree, variables, layout, promptSha256 } = input;
  const forced = input.exportRecord?.forced ?? false;
  const overriddenReasons = input.exportRecord?.overriddenReasons ?? [];

  const root = tree.key;
  if (!SAFE_ROOT_RE.test(root)) {
    throw new Error(
      `serializeBlueprint: tree.key ${JSON.stringify(root)} is not a safe path segment (${SAFE_ROOT_RE.source})`,
    );
  }
  const base = `${BLUEPRINT_PATH_PREFIX}${root}/`;

  const files: Record<string, string> = {};
  const sections: Array<{ id: string; title: string; file: string }> = [];
  const gaps: string[] = [];
  let cursor = 0;
  tree.children.forEach((node, index) => {
    gaps.push(tree.text.slice(cursor, node.range.start));
    const file = `sections/${String(index + 1).padStart(2, '0')}-${sectionSlug(node.title, node.id)}.md`;
    sections.push({ id: node.id, title: node.title, file });
    files[`${base}${file}`] = tree.text.slice(node.range.start, node.range.end);
    cursor = node.range.end;
  });
  // Final gap: everything after the last top-level range. With zero sections
  // the loop never ran and this line alone yields gaps === [tree.text].
  gaps.push(tree.text.slice(cursor));

  files[`${base}blueprint.json`] = toJsonFile({
    format: BLUEPRINT_FORMAT,
    root,
    maxDepth: tree.maxDepth,
    sections,
    gaps,
  });
  files[`${base}variables/variables.json`] = toJsonFile({ declarations: sortedDeclarations(variables) });
  files[`${base}layout.json`] = toJsonFile({ positions: sortedPositions(layout) });
  if (input.design) files[`${base}design.json`] = toJsonFile(input.design);
  files[`${base}manifest.json`] = toJsonFile({
    format: BLUEPRINT_FORMAT,
    root,
    promptSha256,
    sectionCount: tree.children.length,
    variableCount: variables.length,
    forced,
    overriddenReasons: [...overriddenReasons],
  });
  return files;
}

// ── Deserialization schemas (ArkType, `'+': 'reject'` throughout) ────────────
//
// Hoisted to module scope: constructing a Type JIT-compiles a validator, so
// these must never be rebuilt per call. Every object level rejects unknown
// keys — types are not proof; `'+': 'reject'` proves nothing else slipped in.

const SectionEntrySchema = type({
  id: 'string > 0',
  title: 'string',
  file: 'string > 0',
  '+': 'reject',
});

const BlueprintJsonSchema = type({
  format: `'${BLUEPRINT_FORMAT}'`,
  root: 'string > 0',
  maxDepth: 'number.integer >= 0',
  sections: SectionEntrySchema.array(),
  gaps: 'string[]',
  '+': 'reject',
});

const VariableDeclarationSchema = type({
  name: 'string > 0',
  purpose: 'string',
  sample: 'string',
  required: 'boolean',
  source: "'builtin' | 'session'",
  '+': 'reject',
});

const VariablesJsonSchema = type({
  declarations: VariableDeclarationSchema.array(),
  '+': 'reject',
});

const PositionSchema = type({ x: 'number', y: 'number', '+': 'reject' });

const LayoutJsonSchema = type({
  positions: type({ '[string]': PositionSchema }),
  '+': 'reject',
});

const ManifestJsonSchema = type({
  format: `'${BLUEPRINT_FORMAT}'`,
  root: 'string > 0',
  promptSha256: 'string',
  sectionCount: 'number.integer >= 0',
  variableCount: 'number.integer >= 0',
  forced: 'boolean',
  overriddenReasons: 'string[]',
  '+': 'reject',
});

// ── Deserialization helpers ──────────────────────────────────────────────────

/**
 * Reads + JSON-parses + schema-validates one file, converting every failure
 * mode into a `BlueprintParseError` naming the file and a stable reason:
 * `'missing-file'`, `'malformed-json'`, or `'invalid-schema'` (which is also
 * what an unknown key surfaces as, via `'+': 'reject'`).
 */
function validateJsonFile<t>(files: BlueprintFileMap, path: string, schema: Type<t>): t {
  const raw = files[path];
  if (raw === undefined) {
    throw new BlueprintParseError(path, 'missing-file', `Blueprint file is missing: ${path}`);
  }
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new BlueprintParseError(path, 'malformed-json', `Blueprint file is not valid JSON: ${path}`);
  }
  const out: unknown = schema(data);
  if (out instanceof type.errors) {
    throw new BlueprintParseError(path, 'invalid-schema', `${path}: ${out.summary}`);
  }
  return out as t;
}

/**
 * Locates the single `<root>` every path in the map must share. A path
 * outside the overlay prefix is its own error (named by path); an empty map
 * or a map straddling two roots faults the map as a whole (sentinel file).
 */
function requireSingleRoot(paths: readonly string[]): string {
  const roots = new Set<string>();
  for (const path of paths) {
    const match = ROOT_PATH_RE.exec(path);
    if (!match) {
      throw new BlueprintParseError(
        path,
        'file-outside-blueprint-root',
        `File is not under ${BLUEPRINT_PATH_PREFIX}<root>/: ${path}`,
      );
    }
    roots.add(match[1]);
  }
  if (roots.size === 0) {
    throw new BlueprintParseError(FILE_MAP_SENTINEL, 'no-blueprint-root', 'File map contains no blueprint files.');
  }
  if (roots.size > 1) {
    throw new BlueprintParseError(
      FILE_MAP_SENTINEL,
      'multiple-blueprint-roots',
      `File map contains multiple blueprint roots: ${[...roots].sort().join(', ')}`,
    );
  }
  const [root] = roots;
  return root;
}

// ── deserializeBlueprint ─────────────────────────────────────────────────────

/**
 * Inverse of `serializeBlueprint`: validates a blueprint file map and
 * reassembles the original prompt source byte-identically as
 * `gaps[0] + section₀ + gaps[1] + … + gaps[n]`.
 *
 * Strict by design — an export is an interchange artifact, so every
 * inconsistency is a hard `BlueprintParseError` (never a best-effort guess):
 * exactly one root, all four JSON files present/parseable/schema-valid with
 * unknown keys rejected, `gaps.length === sections.length + 1`, every listed
 * section file present, and no unlisted stragglers under `sections/`.
 */
export function deserializeBlueprint(files: BlueprintFileMap): DeserializedBlueprint {
  const paths = Object.keys(files);
  const root = requireSingleRoot(paths);
  const base = `${BLUEPRINT_PATH_PREFIX}${root}/`;
  const blueprintPath = `${base}blueprint.json`;

  const blueprint = validateJsonFile(files, blueprintPath, BlueprintJsonSchema);
  const variablesDoc = validateJsonFile(files, `${base}variables/variables.json`, VariablesJsonSchema);
  const layoutDoc = validateJsonFile(files, `${base}layout.json`, LayoutJsonSchema);
  const manifest = validateJsonFile(files, `${base}manifest.json`, ManifestJsonSchema);
  let design: PromptDesign | undefined;
  const designPath = `${base}design.json`;
  if (files[designPath] !== undefined) {
    try {
      design = parsePromptDesign(files[designPath]);
    } catch (error) {
      throw new BlueprintParseError(
        designPath,
        'invalid-schema',
        error instanceof Error ? error.message : String(error),
      );
    }
    if (design.id !== root) {
      throw new BlueprintParseError(
        designPath,
        'root-mismatch',
        `design.json declares root '${design.id}' but lives under '${root}'.`,
      );
    }
  }

  if (blueprint.root !== root) {
    throw new BlueprintParseError(
      blueprintPath,
      'root-mismatch',
      `blueprint.json declares root '${blueprint.root}' but lives under '${root}'.`,
    );
  }
  if (manifest.root !== root) {
    throw new BlueprintParseError(
      `${base}manifest.json`,
      'root-mismatch',
      `manifest.json declares root '${manifest.root}' but lives under '${root}'.`,
    );
  }
  if (blueprint.gaps.length !== blueprint.sections.length + 1) {
    throw new BlueprintParseError(
      blueprintPath,
      'gap-count-mismatch',
      `Expected ${blueprint.sections.length + 1} gaps for ${blueprint.sections.length} sections, got ${blueprint.gaps.length}.`,
    );
  }

  const listedSectionPaths = new Set(blueprint.sections.map((section) => `${base}${section.file}`));
  for (const section of blueprint.sections) {
    if (files[`${base}${section.file}`] === undefined) {
      throw new BlueprintParseError(
        `${base}${section.file}`,
        'missing-section-file',
        `Section '${section.id}' lists a file that is absent from the map: ${base}${section.file}`,
      );
    }
  }
  for (const path of paths) {
    if (path.startsWith(`${base}sections/`) && !listedSectionPaths.has(path)) {
      throw new BlueprintParseError(
        path,
        'unexpected-section-file',
        `File under sections/ is not listed in blueprint.json: ${path}`,
      );
    }
  }

  let text = blueprint.gaps[0];
  blueprint.sections.forEach((section, index) => {
    text += files[`${base}${section.file}`] + blueprint.gaps[index + 1];
  });

  return {
    root,
    text,
    variables: variablesDoc.declarations,
    layout: layoutDoc.positions,
    manifest,
    ...(design ? { design } : {}),
  };
}
