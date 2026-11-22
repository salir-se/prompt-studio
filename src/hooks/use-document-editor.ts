/**
 * The working document editor — the studio's core capability (ADR-200/ADR-202/ADR-203). Owns the
 * loaded `WorkingDocument` (markdown is source of truth; the graph is a projection), the undo
 * stack, the current verification run, and the selected root id; derives the parse tree and graph
 * model from the document; and exposes ONE transactional write path (`replaceDocumentText`) that
 * every text change funnels through — it applies the new text, clears the verification run (the
 * staleness guard: borders never describe text that no longer exists), and auto-commits to the
 * active project (fire-and-forget). Also owns the project-heads effect that swaps a PRISTINE
 * document's text to the active project's committed head. All logic moved verbatim from App.tsx.
 */

import {
  attributeFindingsToTree,
  nodeVerificationSummary,
  parsePromptTree,
  projectCanonicalPromptTree,
  type PromptDesign,
  type PromptGraphModel,
  type PromptTree,
  type PromptVerificationState,
  toGraphModel,
} from '@prompt-studio/prompts';
import { useEffect, useMemo, useState } from 'react';
import { ensureSectionedTree } from '../catalog/prose-tree';
import type { CatalogRoot, CatalogVariant } from '../catalog/root-catalog';
import { promptDesignProviderKey, serializePromptDesign, withPromptStructure } from '../design/prompt-design-project';
import { runRootVerification, type VerificationRunResult } from '../panels/VerificationPanel';
import { providerKeyFor } from '../vcs/provider-keys';
import type { CommitSignal } from './use-commit-signal';
import type { HistoryBoot } from './use-history-boot';

/** Working, in-memory copy of one root's markdown — never written back to the catalog. */
export interface WorkingDocument {
  rootId: string;
  /** Set only when the loaded text came from a resolver-variants root's variant picker. */
  variantSymbol?: string;
  /** Current (possibly edited) text. */
  text: string;
  /** Text as originally loaded — compared against `text` to derive the dirty-state chip. */
  originalText: string;
}

const MAX_UNDO_ENTRIES = 50;

export { spliceSectionBody } from './section-edit';

/**
 * Canvas-facing projection of a Verify run (ADR-202 Stage D): pins each finding onto the section
 * node it belongs to (`attributeFindingsToTree`) and summarizes per node (`nodeVerificationSummary`)
 * into the record `PromptGraphCanvas` takes, plus the count of findings NO node could claim
 * (`documentLevel` — surfaced by the status bar's doc-level chip). Call with the DISPLAYED
 * (session-declaration-filtered) result so canvas borders, the status bar's finding count, and
 * the Verify drawer always agree on the same findings list.
 *
 * Deliberately sparse: a section with no findings gets NO entry — no border treatment at all —
 * rather than a fabricated `'valid'` entry. `'valid'` renders as the default border anyway, and
 * an all-clear run is already communicated by the status bar's "0 findings", so per-node 'valid'
 * entries would add nothing but noise.
 */
export function attributeVerificationToGraphModel(
  tree: PromptTree,
  result: VerificationRunResult,
): {
  verificationByNodeId: Record<string, { state: PromptVerificationState; findingCount: number }>;
  documentLevelCount: number;
} {
  const { byNodeId, documentLevel } = attributeFindingsToTree(tree, result.findings, result.sectionNodeIds);
  const verificationByNodeId: Record<string, { state: PromptVerificationState; findingCount: number }> = {};
  // `attributeFindingsToTree` keys by TREE node id; the canvas keys by GRAPH node id, which
  // `toGraphModel` derives as `section:${treeNodeId}` — translate while summarizing.
  for (const [nodeId, findings] of byNodeId) {
    verificationByNodeId[`section:${nodeId}`] = nodeVerificationSummary(findings);
  }
  return { verificationByNodeId, documentLevelCount: documentLevel.length };
}

export interface DocumentEditorDeps {
  saveDocument?: (root: CatalogRoot, text: string) => Promise<void>;
  /** The booted history layer — commits go to its active project; heads come back from it. */
  boot: HistoryBoot;
  /** Bumped every time a fire-and-forget commit lands (see `use-commit-signal.ts`). */
  signal: CommitSignal;
  /** Stable `useState` setter from `useBanners` — history failures land in the error banner. */
  setErrorMessage: (message: string | null) => void;
}

export function useDocumentEditor({ boot, signal, setErrorMessage, saveDocument }: DocumentEditorDeps) {
  const [selectedRootId, setSelectedRootId] = useState<string | null>(null);
  const [doc, setDoc] = useState<WorkingDocument | null>(null);
  const [undoStack, setUndoStack] = useState<string[]>([]);
  const [verificationResult, setVerificationResult] = useState<VerificationRunResult | null>(null);

  const catalogRoot = useMemo(
    () => boot.allRoots.find((root) => root.id === selectedRootId),
    [boot.allRoots, selectedRootId],
  );
  const selectedRoot = useMemo(
    () => (catalogRoot && doc?.rootId === catalogRoot.id ? withPromptStructure(catalogRoot, doc.text) : catalogRoot),
    [catalogRoot, doc],
  );

  const tree = useMemo<PromptTree | null>(() => {
    if (!doc) return null;
    const parsed = parsePromptTree({ key: doc.rootId, text: doc.text, toolNames: selectedRoot?.toolNames ?? [] });
    if (selectedRoot?.verification) {
      const canonical = projectCanonicalPromptTree(parsed, selectedRoot.verification.sections);
      if (canonical.children.length > 0) return canonical;
    }
    // Prose fallback (task #17): a parse with zero sections gets one synthetic full-range
    // section, so fragment documents (icp/persona/discovery_protocol) render a card and are
    // editable through the same dialog/inspector paths sectioned prompts use.
    return ensureSectionedTree(parsed);
  }, [doc, selectedRoot]);

  const model = useMemo<PromptGraphModel>(() => (tree ? toGraphModel(tree) : { nodes: [], edges: [] }), [tree]);

  // Project-switch semantics (ADR-203): whenever the provider boots, the selection changes, or the
  // active project changes, the selected root's working text comes from the active project's
  // committed heads — constant roots under their id, variant documents under the composite
  // `rootId@variantSymbol` key (ADR-235). The functional `setDoc` only replaces a PRISTINE
  // document (`text === originalText`, i.e. the just-loaded baseline) whose head actually differs
  // — a late-resolving `heads()` can never clobber an in-flight user edit — and `originalText`
  // stays the baseline so the dirty chip keeps meaning "differs from the shipped baseline".
  // `doc?.variantSymbol` participates in the deps (via selectedDocVariant) so switching the
  // variant picker re-targets the head lookup at the new key.
  const selectedDocVariant = doc?.rootId === catalogRoot?.id ? doc?.variantSymbol : undefined;
  useEffect(() => {
    if (!boot.history || !catalogRoot) return;
    if (catalogRoot.loadability !== 'constant' && catalogRoot.loadability !== 'resolver-variants') return;
    const { provider, activeProjectId } = boot.history;
    let cancelled = false;
    provider
      .heads(activeProjectId)
      .then((heads) => {
        if (cancelled) return;
        const head = heads.get(providerKeyFor(catalogRoot.id, selectedDocVariant));
        if (head === undefined) return;
        setDoc((current) =>
          current !== null &&
          current.rootId === catalogRoot.id &&
          current.variantSymbol === selectedDocVariant &&
          current.text === current.originalText &&
          head !== current.text
            ? { ...current, text: head }
            : current,
        );
      })
      .catch((error) => setErrorMessage(error instanceof Error ? error.message : String(error)));
    return () => {
      cancelled = true;
    };
  }, [boot.history, catalogRoot, selectedDocVariant, setErrorMessage]);

  /**
   * STALENESS GUARD — the single write path for changing the loaded document's text: section
   * apply-edit, Undo, and blueprint import all funnel through here (root/variant selection loads a
   * whole new document via the working-state reset, which clears `verificationResult` itself).
   * Clearing `verificationResult` alongside every text change guarantees canvas borders never
   * describe text that no longer exists. The Verify drawer renders the same state, so an open
   * drawer drops its result too and shows its no-result copy until Verify is pressed again —
   * intended: a stale report is worse than none.
   *
   * Being the single write path also makes it ADR-203's auto-commit hook: every text change is
   * recorded on the active project with `commitMessage` — no manual commit ceremony.
   */
  function replaceDocumentText(nextText: string, commitMessage: string): Promise<void> {
    if (!doc) return Promise.resolve();
    setDoc({ ...doc, text: nextText });
    setVerificationResult(null);
    const saved = commitToActiveProject(doc, nextText, commitMessage);
    // Existing fire-and-forget callers keep banner feedback; explicit save flows can await durability.
    void saved.catch(() => {});
    return saved;
  }

  /**
   * Fire-and-forget history write behind every text change (ADR-203 decision 2): commit to the
   * active project, then persist the provider snapshot. A failure lands in the error banner — a
   * failed history write must be VISIBLE, never silent — but never blocks the edit itself (the
   * working document already updated). Constant roots commit under their id; a resolver-VARIANT
   * document commits under the composite `rootId@variantSymbol` key (ADR-235) so the Critic
   * V1/V2/Neutral pickers keep independent histories.
   */
  function commitToActiveProject(current: WorkingDocument, nextText: string, message: string): Promise<void> {
    if (!boot.history) return Promise.resolve();
    const root = boot.allRoots.find((candidate) => candidate.id === current.rootId);
    const loadable =
      root?.loadability === 'constant' ||
      (root?.loadability === 'resolver-variants' && current.variantSymbol !== undefined);
    if (!loadable) return Promise.resolve();
    const { provider, activeProjectId } = boot.history;
    const updatedRoot = root ? withPromptStructure(root, nextText) : root;
    const durableSave = updatedRoot && saveDocument ? saveDocument(updatedRoot, nextText) : Promise.resolve();
    void durableSave.catch((error) => setErrorMessage(`Save failed: ${String(error)}`));
    return (
      provider
        .commit({
          projectId: activeProjectId,
          rootKey: providerKeyFor(current.rootId, current.variantSymbol),
          text: nextText,
          message,
        })
        .then(async () => {
          if (updatedRoot?.design && updatedRoot.design !== root?.design) {
            await provider.commit({
              projectId: activeProjectId,
              rootKey: promptDesignProviderKey(current.rootId),
              text: serializePromptDesign(updatedRoot.design),
              message: `initialize sections for ${current.rootId}`,
            });
          }
          await provider.persist();
        })
        .then(() => durableSave)
        // The commit LANDED — bump the token so an open History drawer reloads with it on top.
        .then(() => signal.markCommitLanded())
        .catch((error) => {
          setErrorMessage(`History write failed: ${error instanceof Error ? error.message : String(error)}`);
          throw error;
        })
    );
  }

  /** Shared tail of every undoable change: undo point, transactional write, staleness clear. */
  function commitUndoableEdit(nextText: string, commitMessage: string): Promise<void> {
    if (!doc) return Promise.resolve();
    const previousText = doc.text;
    setUndoStack((prev) => [...prev, previousText].slice(-MAX_UNDO_ENTRIES));
    return replaceDocumentText(nextText, commitMessage);
  }

  /**
   * Loads a root (or one of its variants) as the working document — the doc half of a sidebar
   * select; the surrounding working-state reset and registry rebuild stay with the caller.
   */
  function loadDocument(root: CatalogRoot, variant?: CatalogVariant): void {
    setSelectedRootId(root.id);
    if (root.loadability === 'constant' && variant === undefined) {
      // Load the pristine baseline immediately; the heads effect above swaps in the active
      // project's committed head (if it differs) once `heads()` resolves — `originalText` stays
      // the baseline constant so the dirty chip means "differs from the shipped baseline".
      const text = root.text ?? '';
      setDoc({ rootId: root.id, text, originalText: text });
      return;
    }
    if (variant !== undefined) {
      setDoc({ rootId: root.id, variantSymbol: variant.symbol, text: variant.text, originalText: variant.text });
      return;
    }
    // Resolver-variants root: wait for a variant pick (sidebar shows the picker row now that
    // this root is selected) before any document loads.
    setDoc(null);
  }

  /**
   * Reloads the SELECTED root's shipped baseline (or its loaded variant's shipped text) — the
   * doc half of a project activation; see `useProjectActions.activateProject`'s doc.
   */
  function reloadSelectedDocument(): void {
    if (selectedRoot?.loadability === 'constant') {
      const text = selectedRoot.text ?? '';
      setDoc({ rootId: selectedRoot.id, text, originalText: text });
    } else if (
      selectedRoot?.loadability === 'resolver-variants' &&
      doc?.rootId === selectedRoot.id &&
      doc.variantSymbol !== undefined
    ) {
      const variant = selectedRoot.variants?.find((candidate) => candidate.symbol === doc.variantSymbol);
      const text = variant?.text ?? '';
      setDoc({ rootId: selectedRoot.id, variantSymbol: doc.variantSymbol, text, originalText: text });
    }
  }

  /** Runs the automatic checks on `text` and shows the result; returns it (null when nothing is open). */
  function runVerification(text = doc?.text, design?: PromptDesign): VerificationRunResult | null {
    if (text === undefined || !selectedRoot) return null;
    const root = withPromptStructure(design ? { ...selectedRoot, design } : selectedRoot, text);
    const result = runRootVerification(root, text);
    setVerificationResult(result);
    return result;
  }

  function undo(): void {
    if (!doc || undoStack.length === 0) return;
    const previousText = undoStack[undoStack.length - 1];
    setUndoStack(undoStack.slice(0, -1));
    replaceDocumentText(previousText, 'undo');
  }

  /**
   * "Reset this document to the shipped default" (ADR-235): the same transactional write path as
   * restore, with the shipped baseline text (`originalText` is BY DEFINITION the shipped text —
   * the working document's pristine reference). Append-only: the reset is a commit, so History
   * keeps everything and the operation is itself restorable.
   */
  function resetToShipped(): void {
    if (!doc) return;
    const current = doc;
    if (current.text === current.originalText) return; // Already shipped — nothing to commit.
    commitUndoableEdit(current.originalText, 'reset to shipped default');
  }

  /**
   * Restores `commitId`'s text for the loaded root through the SAME transactional write path every
   * edit takes (`replaceDocumentText`) — the restore is itself an append-only commit
   * (`restore <shortId>`, ADR-203), the staleness guard clears any verification run, and the open
   * drawer refreshes so the restored text tops the list as the new current head. A `null` read
   * (commit doesn't touch this root) or any provider failure lands in the error banner.
   */
  function restoreCommit(commitId: string): void {
    if (!boot.history || !doc) return;
    const current = doc;
    const shortId = commitId.slice(0, 7);
    boot.history.provider
      .readTextAt(boot.history.activeProjectId, commitId, providerKeyFor(current.rootId, current.variantSymbol))
      .then((restoredText) => {
        if (restoredText === null) {
          setErrorMessage(`Commit ${shortId} carries no text for "${current.rootId}" — nothing was restored.`);
          return;
        }
        commitUndoableEdit(restoredText, `restore ${shortId}`);
      })
      .catch((error) => setErrorMessage(error instanceof Error ? error.message : String(error)));
  }

  /** Clears the undo stack and any verification run — the editor half of the working-state reset. */
  function discardWorkingState(): void {
    setUndoStack([]);
    setVerificationResult(null);
  }

  function clearDocument(): void {
    setSelectedRootId(null);
    setDoc(null);
    discardWorkingState();
  }

  return {
    doc,
    selectedRootId,
    selectedRoot,
    tree,
    model,
    verificationResult,
    canUndo: undoStack.length > 0,
    loadDocument,
    reloadSelectedDocument,
    runVerification,
    openVerifiedDocument(root: CatalogRoot) {
      loadDocument(root);
      setVerificationResult(runRootVerification(root, root.text ?? ''));
    },
    replaceDocumentText,
    commitUndoableEdit,
    undo,
    resetToShipped,
    restoreCommit,
    discardWorkingState,
    clearDocument,
  };
}

export type DocumentEditor = ReturnType<typeof useDocumentEditor>;
