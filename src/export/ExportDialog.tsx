/**
 * ExportDialog — the confirm/refuse modal behind the top bar's Export button (ADR-202 §9 gate UI).
 *
 * Pure, prop-driven: the gate result is computed by the caller (`buildExportPlan`) and rendered
 * here verbatim. Allowed → a green-path summary and an enabled "Export ZIP". Refused → every
 * refusal reason listed (via `describeRefusalReason`, the same wording the manifest records) plus
 * an explicit "Export anyway" checkbox that must be checked before "Export ZIP" enables — the
 * accountability half of the override lives in `buildForceRecord`, not here.
 *
 * A second, UNGATED action — "Project archive" (ADR-203 decision 5) — downloads the active
 * project's save-file including its full history. The gate + force semantics apply to the repo
 * OVERLAY only: an overlay lands in the real repository, so it must pass (or explicitly force) the
 * quality gate, whereas a save-file of the user's own project needs no gate. Rendered only when the
 * caller wires `onExportProjectArchive` (i.e. once the history provider booted).
 *
 * The studio cannot import `@prompt-studio/ui`'s Dialog (see `App.tsx`'s `cn` doc — `@prompt-studio/ui` is a
 * transitive dependency Bun's isolated linker does not resolve for this app), so this mirrors the
 * app's own plain-element modal vocabulary: fixed overlay + card, Escape handled with the same
 * document-level keydown pattern the drawer effect in `App.tsx` uses. Escape and Cancel both
 * discard; only "Export ZIP" calls `onExport`.
 */

import { TimelineScrollRegion } from '@prompt-studio/ui/timeline-scroll-region';
import { useEffect, useRef, useState } from 'react';
import { describeRefusalReason, type ExportGateResult } from './export-gate';

/** Same button vocabulary `App.tsx` uses for its top bar (kept private there — see its `cn` doc). */
const BUTTON_CLASSES =
  'inline-flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-md text-xs font-medium transition-colors disabled:pointer-events-none disabled:opacity-50 h-7 px-2.5';
const BUTTON_OUTLINE_CLASSES = 'border border-border bg-card hover:bg-muted';
const BUTTON_DEFAULT_CLASSES = 'bg-primary text-primary-foreground hover:bg-primary/90';

export interface ExportDialogProps {
  open: boolean;
  rootTitle: string;
  gate: ExportGateResult;
  sectionCount: number;
  /** Count of variables `selectExportVariables` will actually export — not the whole registry. */
  variableCount: number;
  /** Exact paths the overlay ZIP will contain, produced by the real file-map builder. */
  archivePaths: readonly string[];
  onCancel: () => void;
  onExport: (force: boolean) => void | Promise<void>;
  /**
   * Ungated project-archive download (ADR-203 — see module doc). Optional: absent while the
   * history provider is still booting, and the button simply does not render then.
   */
  onExportProjectArchive?: () => void | Promise<void>;
}

interface ArchiveTreeNode {
  name: string;
  children: Map<string, ArchiveTreeNode>;
}

function buildArchiveTree(paths: readonly string[]): readonly ArchiveTreeNode[] {
  const root = new Map<string, ArchiveTreeNode>();
  for (const path of paths) {
    let branch = root;
    for (const name of path.split('/').filter(Boolean)) {
      let node = branch.get(name);
      if (!node) {
        node = { name, children: new Map() };
        branch.set(name, node);
      }
      branch = node.children;
    }
  }
  const sort = (nodes: ReadonlyMap<string, ArchiveTreeNode>): ArchiveTreeNode[] =>
    [...nodes.values()]
      .sort((left, right) => {
        const folderOrder = Number(right.children.size > 0) - Number(left.children.size > 0);
        return folderOrder || left.name.localeCompare(right.name);
      })
      .map((node) => ({ ...node, children: new Map(sort(node.children).map((child) => [child.name, child])) }));
  return sort(root);
}

function ArchiveTree({ nodes, nested = false }: { nodes: readonly ArchiveTreeNode[]; nested?: boolean }) {
  return (
    <ul aria-label={nested ? undefined : 'ZIP archive file tree'} className="pl-3">
      {nodes.map((node) => {
        const folder = node.children.size > 0;
        return (
          <li key={node.name}>
            <span>
              {folder ? '▾' : '·'} {node.name}
            </span>
            {folder && <ArchiveTree nodes={[...node.children.values()]} nested />}
          </li>
        );
      })}
    </ul>
  );
}

export function ExportDialog({
  open,
  rootTitle,
  gate,
  sectionCount,
  variableCount,
  archivePaths,
  onCancel,
  onExport,
  onExportProjectArchive,
}: ExportDialogProps): React.JSX.Element | null {
  const [force, setForce] = useState(false);

  // Reset the override checkbox on every OPEN transition (same edge-detection pattern as
  // `FragmentEditDialog`) — a previous session's "Export anyway" must never carry over.
  const wasOpenRef = useRef(open);
  useEffect(() => {
    if (open && !wasOpenRef.current) setForce(false);
    wasOpenRef.current = open;
  }, [open]);

  // Escape cancels — same document-level keydown pattern App.tsx's drawer effect uses.
  useEffect(() => {
    if (!open) return;
    function onKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape') onCancel();
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, onCancel]);

  if (!open) return null;

  const canExport = gate.allowed || force;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <TimelineScrollRegion
        role="dialog"
        aria-modal="true"
        aria-label={`Export ${rootTitle}`}
        data-testid="export-dialog"
        className="max-h-[calc(100dvh-32px)] w-full max-w-lg rounded-lg border border-border bg-card shadow-xl"
        viewportClassName="flex flex-col gap-3 p-4"
      >
        <h2 className="text-base font-semibold">Export developer package — {rootTitle}</h2>
        <p className="text-xs leading-5 text-muted-foreground">
          The developer ZIP contains the selected prompt and its supporting files for use in a repository. Review the
          included paths before export.
        </p>
        {onExportProjectArchive && (
          <p className="text-xs leading-5 text-muted-foreground">
            Project archive is a separate save-file of the active developer configuration, including its history.
          </p>
        )}

        {gate.allowed ? (
          <p className="text-sm text-muted-foreground" data-testid="export-summary">
            Ready to export: {sectionCount} section{sectionCount === 1 ? '' : 's'}, {variableCount} variable
            {variableCount === 1 ? '' : 's'}.
          </p>
        ) : (
          <>
            <p className="text-sm font-medium text-destructive">Export refused:</p>
            <ul aria-label="Refusal reasons" className="flex flex-col gap-1" data-testid="export-refusal-reasons">
              {gate.reasons.map((reason) => {
                const description = describeRefusalReason(reason);
                return (
                  <li key={description} className="rounded-md bg-destructive/10 px-2 py-1 text-xs text-destructive">
                    {description}
                  </li>
                );
              })}
            </ul>
            <label className="flex items-center gap-2 text-xs text-foreground">
              <input
                type="checkbox"
                checked={force}
                data-testid="export-force-checkbox"
                onChange={(event) => setForce(event.target.checked)}
              />
              Export anyway (recorded in manifest)
            </label>
          </>
        )}

        <details data-testid="export-zip-preview" className="rounded-md border border-border bg-muted/20 text-xs">
          <summary className="cursor-pointer select-none px-3 py-2 font-medium">
            ZIP contents ({archivePaths.length} files)
          </summary>
          <div className="max-h-64 overflow-auto border-t border-border px-2 py-2 font-mono text-[11px] leading-5">
            <ArchiveTree nodes={buildArchiveTree(archivePaths)} />
          </div>
        </details>

        <div className="flex justify-end gap-2">
          {/* Deliberately outside the gate: `canExport` never touches this button (see module doc). */}
          {onExportProjectArchive && (
            <button
              type="button"
              title="Full project save-file including history — not a repo overlay"
              onClick={() => void onExportProjectArchive()}
              className={`${BUTTON_CLASSES} ${BUTTON_OUTLINE_CLASSES} mr-auto`}
            >
              Project archive
            </button>
          )}
          <button type="button" onClick={onCancel} className={`${BUTTON_CLASSES} ${BUTTON_OUTLINE_CLASSES}`}>
            Cancel
          </button>
          <button
            type="button"
            disabled={!canExport}
            onClick={() => void onExport(force)}
            className={`${BUTTON_CLASSES} ${BUTTON_DEFAULT_CLASSES}`}
          >
            Export ZIP
          </button>
        </div>
      </TimelineScrollRegion>
    </div>
  );
}
