/**
 * Pure attribution of verification findings onto parsed prompt-tree nodes
 * (ADR-202 Stage D): given a `PromptTree` (the ADR-200 observed model from
 * `./parse-tree.ts`) and the findings produced by a verification run
 * (`runLegacyVerificationProfile` / `runPromptVerificationProfile` in
 * `../verification-profiles.ts`), decide which graph node each finding should
 * be pinned to — so a canvas can badge the exact section a problem lives in
 * instead of dumping every finding into one undifferentiated list.
 *
 * No React, no DOM, no I/O — a single pass over the findings against a
 * precomputed index of the tree.
 *
 * WHY subject-based matching works: today's LEGACY profiles are all
 * `scope: 'consolidated'` (see `verification-profiles.ts`), so no finding
 * carries a `sectionId` yet — the only per-finding locator is the optional
 * deterministic `subject`. `evaluateRule` emits it BARE (no `{{ }}`), and what
 * it names depends on the rule kind:
 *
 * - `required-placeholder` / `known-placeholder` — a bare placeholder name
 *   (e.g. `icp_text`), matchable against `PromptTreeNode.variables`.
 * - `required-tool` — a bare tool name (e.g. `web_search`), matchable against
 *   `PromptTreeNode.toolMentions`.
 * - `required-output-literal` — the missing literal (e.g. a JSON key), which
 *   MAY coincide with a section title but usually matches nothing.
 * - `non-empty` / `valid-rubric` / `minimum-length` — structural labels
 *   (`'non-empty'`, `'rubric'`, `'minimum-length'`), never node-addressable.
 * - `forbidden-combination` — `"<first> + <second>"`, never node-addressable.
 * - `identity-in-prompt` — `"line <n>: <masked text>"`, never node-addressable.
 *
 * Attribution rules, applied in priority order — FIRST match wins:
 *
 * 1. `scope === 'section'` and `sectionId` equals a tree node id → that node.
 *    Future-proofing: the ADR-200 branch ships per-section profiles whose
 *    `sectionId`s are expected to be node/section ids; consolidated legacy
 *    findings never take this path today.
 * 2. Deterministic `subject` naming a variable → EVERY node whose `variables`
 *    includes the (normalized) subject.
 * 3. Deterministic `subject` naming a tool → EVERY node whose `toolMentions`
 *    includes the subject.
 * 4. Deterministic `subject` equal to a node title, case-insensitively after
 *    trimming → that node (the first such node in tree order — titles are
 *    near-unique in practice because node ids already slug-disambiguate).
 * 5. Everything else → `documentLevel` (semantic findings without a section,
 *    structural-label subjects, subjects the tree no longer references, …).
 *
 * A finding attributed to N nodes appears in each node's list (same shared
 * reference) and then never ALSO in `documentLevel`. Ordering is fully
 * deterministic: `byNodeId` iterates in tree (preorder) source order, and each
 * node's list preserves the input `findings` order.
 */

import {
  derivePromptVerificationState,
  type PromptVerificationFinding,
  type PromptVerificationState,
} from '../verification-contracts';
import type { PromptTree, PromptTreeNode } from './types';

/** The result of pinning one findings list onto one parsed tree — see the module doc for the rules. */
export interface AttributedFindings {
  /**
   * Findings per node id, keyed in tree (preorder) order; a node with no
   * findings has NO entry (never an empty array), so `byNodeId.size` counts
   * affected nodes directly.
   */
  readonly byNodeId: ReadonlyMap<string, readonly PromptVerificationFinding[]>;
  /** Findings no node could claim (attribution rule 5). Preserves input order. */
  readonly documentLevel: readonly PromptVerificationFinding[];
}

/**
 * One full surrounding `{{ name }}` wrapper, inner whitespace tolerated —
 * matched against an already-trimmed subject to recover the bare name.
 */
const BRACED_SUBJECT_RE = /^\{\{\s*(.*?)\s*\}\}$/;

/**
 * Normalizes a finding `subject` to the bare-name form the tree indexes use.
 * `evaluateRule` in `../verification-profiles.ts` already emits bare names
 * (verified against every rule kind — braces appear only inside `message`),
 * so today this is trim-only; the `{{ }}` strip future-proofs against a
 * producer that echoes prompt syntax (`{{icp_text}}`) into `subject`.
 */
function normalizeSubject(subject: string): string {
  const trimmed = subject.trim();
  const braced = BRACED_SUBJECT_RE.exec(trimmed);
  return braced ? braced[1] : trimmed;
}

/** Flattens the tree's nodes into preorder (source) order — the canonical iteration order for `byNodeId`. */
function flattenPreorder(nodes: readonly PromptTreeNode[], out: PromptTreeNode[] = []): PromptTreeNode[] {
  for (const node of nodes) {
    out.push(node);
    flattenPreorder(node.children, out);
  }
  return out;
}

/** Precomputed lookup structures for one tree — built once, then shared across all findings. */
interface TreeIndex {
  /** Every node, preorder. */
  readonly all: readonly PromptTreeNode[];
  /** Node id → node, for rule 1's `sectionId` lookup. */
  readonly byId: ReadonlyMap<string, PromptTreeNode>;
  /** Variable name → every node declaring it, in tree order (rule 2). */
  readonly byVariable: ReadonlyMap<string, readonly PromptTreeNode[]>;
  /** Tool name → every node mentioning it, in tree order (rule 3). */
  readonly byTool: ReadonlyMap<string, readonly PromptTreeNode[]>;
  /** Trimmed, lowercased title → the FIRST node in tree order bearing it (rule 4). */
  readonly byTitle: ReadonlyMap<string, PromptTreeNode>;
}

function appendTo(index: Map<string, PromptTreeNode[]>, name: string, node: PromptTreeNode): void {
  const nodes = index.get(name);
  if (nodes) nodes.push(node);
  else index.set(name, [node]);
}

function indexTree(tree: PromptTree): TreeIndex {
  const all = flattenPreorder(tree.children);
  const byId = new Map<string, PromptTreeNode>();
  const byVariable = new Map<string, PromptTreeNode[]>();
  const byTool = new Map<string, PromptTreeNode[]>();
  const byTitle = new Map<string, PromptTreeNode>();

  for (const node of all) {
    byId.set(node.id, node);
    // De-duplicate per node so a name repeated within one node's list can
    // never register the same node twice for one subject.
    for (const name of new Set(node.variables)) appendTo(byVariable, name, node);
    for (const name of new Set(node.toolMentions)) appendTo(byTool, name, node);
    const titleKey = node.title.trim().toLowerCase();
    if (!byTitle.has(titleKey)) byTitle.set(titleKey, node);
  }
  return { all, byId, byVariable, byTool, byTitle };
}

/**
 * Pins each finding onto the tree per the module-doc attribution rules.
 * Pure: neither input is mutated; findings are attached by reference (a
 * finding on N nodes is the same object N times).
 */
export function attributeFindingsToTree(
  tree: PromptTree,
  findings: readonly PromptVerificationFinding[],
  sectionNodeIds: Readonly<Record<string, string>> = {},
): AttributedFindings {
  const index = indexTree(tree);
  const buckets = new Map<string, PromptVerificationFinding[]>();
  const documentLevel: PromptVerificationFinding[] = [];

  const attach = (node: PromptTreeNode, finding: PromptVerificationFinding): void => {
    const bucket = buckets.get(node.id);
    if (bucket) bucket.push(finding);
    else buckets.set(node.id, [finding]);
  };

  for (const finding of findings) {
    // Rule 1 — an explicit section id beats any subject heuristic.
    const sectionNode =
      finding.scope === 'section' ? index.byId.get(sectionNodeIds[finding.sectionId] ?? finding.sectionId) : undefined;
    if (sectionNode) {
      attach(sectionNode, finding);
      continue;
    }

    // Rules 2–4 need a deterministic subject; semantic findings have none.
    const rawSubject = finding.source === 'deterministic' ? finding.subject : undefined;
    if (rawSubject !== undefined) {
      const subject = normalizeSubject(rawSubject);

      const variableNodes = index.byVariable.get(subject);
      if (variableNodes) {
        for (const node of variableNodes) attach(node, finding);
        continue;
      }

      const toolNodes = index.byTool.get(subject);
      if (toolNodes) {
        for (const node of toolNodes) attach(node, finding);
        continue;
      }

      const titleNode = index.byTitle.get(subject.toLowerCase());
      if (titleNode) {
        attach(titleNode, finding);
        continue;
      }
    }

    // Rule 5 — nothing claimed it.
    documentLevel.push(finding);
  }

  // Assemble in tree order so map iteration is deterministic regardless of
  // the order findings happened to arrive in.
  const byNodeId = new Map<string, readonly PromptVerificationFinding[]>();
  for (const node of index.all) {
    const bucket = buckets.get(node.id);
    if (bucket) byNodeId.set(node.id, bucket);
  }
  return { byNodeId, documentLevel };
}

/**
 * Summarizes one node's (or the document-level) findings list into the badge
 * state a renderer shows. Delegates to the REAL
 * `derivePromptVerificationState` — never a re-derivation — with
 * `semanticStatus` pinned to `'not-run'` because attribution happens on
 * deterministic-verification output before any semantic pass. That pin means
 * `'verified'` (requires `'passed'`) and `'degraded'` (requires
 * `'unavailable'`) are unreachable here: the summary reports
 * `'invalid' | 'warning' | 'valid'` only.
 */
export function nodeVerificationSummary(findings: readonly PromptVerificationFinding[]): {
  state: PromptVerificationState;
  findingCount: number;
} {
  return { state: derivePromptVerificationState('not-run', findings), findingCount: findings.length };
}
