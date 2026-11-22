/**
 * Export/import orchestration for the studio top bar — the testable core behind Stage C's real
 * Export/Import buttons (ADR-202 §9). `App.tsx` stays thin: it gathers the working state (tree,
 * registry, fresh findings) and calls into this module; everything decidable without React state
 * is decided HERE, in pure(ish) functions a node-level test can drive without mounting anything.
 *
 * Nothing in this module re-implements a building block: the gate is `export-gate.ts`, the file
 * layout is `serializeBlueprint`/`deserializeBlueprint` (`@prompt-studio/prompts`), the bytes are
 * `packZip` (`./zip.ts`), and canvas positions come from `layoutGraph` (`@prompt-studio/prompt-graph-ui`).
 */

import { layoutGraph } from '@prompt-studio/prompt-graph-ui';
import {
  type BlueprintVariableDeclaration,
  deserializeBlueprint,
  extractPlaceholderNames,
  type PromptDesign,
  type PromptTree,
  type PromptVerificationFinding,
  serializeBlueprint,
  toGraphModel,
} from '@prompt-studio/prompts';
import { undeclaredVariables, type VariablesRegistry } from '../registry/variables-registry';
import { buildForceRecord, describeRefusalReason, evaluateExportGate, type ExportGateResult } from './export-gate';
import { packZip } from './zip';

/** SHA-256 of `text` as lowercase hex, via WebCrypto — the hash `manifest.json` records as `promptSha256`. */
export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export interface ExportPlanInput {
  /** The parsed working document the plan is for — the same tree `buildExportZip` will serialize. */
  readonly tree: PromptTree;
  readonly registry: VariablesRegistry;
  /** The live document text (equals `tree.text` for a freshly parsed doc) the undeclared-use check runs against. */
  readonly docText: string;
  /** FRESH verification findings — computed at export-click time, never a stale panel result. */
  readonly findings: readonly PromptVerificationFinding[];
}

/**
 * Assembles the export gate's inputs in ONE place — `undeclaredVariables()` over the live doc text
 * plus the caller's fresh findings — so App never hand-wires `evaluateExportGate` itself.
 */
export function buildExportPlan(input: ExportPlanInput): { gate: ExportGateResult } {
  return {
    gate: evaluateExportGate({
      undeclaredVariables: undeclaredVariables(input.registry, input.docText),
      findings: input.findings,
    }),
  };
}

/**
 * VARIABLES-EXPORT RULE (decided here, nowhere else): a registry entry is exported iff it is
 * SESSION-declared OR its name is actually referenced by the document text. Session entries always
 * travel with the blueprint — the operator authored them for this prompt, even when (not yet)
 * referenced. Builtin entries export only when referenced: shipping the entire hand-curated
 * builtin catalog (`PROMPT_VARIABLE_DOCS`) with every blueprint would be noise, and builtins
 * re-derive on import anyway. "Referenced" = appears in `extractPlaceholderNames(docText)` — the
 * exact `{{name}}` extraction `undeclaredVariables()` already uses, and a superset of unioning
 * per-node `variables` across the tree (it also covers interstitial gap text outside any section).
 */
export function selectExportVariables(
  registry: VariablesRegistry,
  docText: string,
): readonly BlueprintVariableDeclaration[] {
  const referenced = new Set(extractPlaceholderNames(docText));
  return registry.entries.filter((entry) => entry.source === 'session' || referenced.has(entry.name));
}

/**
 * Base positions for `layout.json` — the deterministic `layoutGraph` projection of the tree.
 * Browser-measured label gutters and temporary node resizing are presentation state, not exported;
 * the canvas measures again when opened. Imported positions are currently ignored (see below).
 */
function canvasLayout(tree: PromptTree): Record<string, { x: number; y: number }> {
  const positions: Record<string, { x: number; y: number }> = {};
  for (const [id, position] of layoutGraph(toGraphModel(tree))) {
    positions[id] = { x: position.x, y: position.y };
  }
  return positions;
}

export interface BuildExportZipInput {
  readonly tree: PromptTree;
  readonly registry: VariablesRegistry;
  /** The gate `buildExportPlan` produced for THIS document state — recorded via `buildForceRecord`. */
  readonly gate: ExportGateResult;
  /** True when the operator checked "Export anyway" on a refused gate. */
  readonly force: boolean;
  readonly design?: PromptDesign;
}

function buildExportFileMap(input: BuildExportZipInput, promptSha256: string): Readonly<Record<string, string>> {
  return serializeBlueprint({
    tree: input.tree,
    variables: selectExportVariables(input.registry, input.tree.text),
    layout: canvasLayout(input.tree),
    promptSha256,
    exportRecord: buildForceRecord(input.gate, input.force),
    design: input.design,
  });
}

/** Exact paths produced by the same file-map builder as the ZIP; contents are intentionally hidden. */
export function buildExportPreviewPaths(input: Omit<BuildExportZipInput, 'force'>): readonly string[] {
  return Object.keys(buildExportFileMap({ ...input, force: false }, '<computed on export>')).sort();
}

/**
 * Serializes the working document into blueprint ZIP bytes plus a download filename. Defensive
 * throw on a refused, unforced gate — the dialog already prevents this, but the invariant that a
 * refused export never silently produces bytes must not depend on UI wiring alone.
 */
export async function buildExportZip(input: BuildExportZipInput): Promise<{ bytes: Uint8Array; filename: string }> {
  const { tree, gate, force } = input;
  if (!gate.allowed && !force) {
    throw new Error(`Export refused: ${gate.reasons.map(describeRefusalReason).join(' ')}`);
  }
  const files = buildExportFileMap(input, await sha256Hex(tree.text));
  return { bytes: packZip(files), filename: `${tree.key}-blueprint.zip` };
}

export interface ApplyImportedBlueprintInput {
  /** The file map `unpackZip` produced from the untrusted archive bytes. */
  readonly files: Readonly<Record<string, string>>;
  /** The currently selected root's key — an import never silently retargets a different root. */
  readonly expectedRoot: string;
}

/**
 * Validates an unpacked blueprint against the selected root and extracts what the studio applies:
 * the reassembled document text plus the SESSION-declared variables only. Builtin declarations in
 * the archive are dropped — builtins always re-derive from `buildBuiltinRegistry()`, so a stale
 * archived copy can never shadow the live curated set (mirrors `registry-persistence.ts`).
 * `layout.json` is deliberately IGNORED: the studio has no drag persistence yet — positions are
 * recomputed deterministically by `layoutGraph` on every render, so there is nothing for imported
 * positions to apply to.
 */
export function applyImportedBlueprint(input: ApplyImportedBlueprintInput): {
  text: string;
  variables: readonly BlueprintVariableDeclaration[];
  design?: PromptDesign;
} {
  const result = deserializeBlueprint(input.files);
  if (result.root !== input.expectedRoot) {
    throw new Error(
      `This blueprint was exported for root '${result.root}', but '${input.expectedRoot}' is selected — ` +
        `select '${result.root}' in the sidebar and import again.`,
    );
  }
  return {
    text: result.text,
    variables: result.variables.filter((variable) => variable.source === 'session'),
    ...(result.design ? { design: result.design } : {}),
  };
}
