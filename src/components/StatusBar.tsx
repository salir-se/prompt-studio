/**
 * The studio's status bar (ADR-200/ADR-202): parse/node/edge counts plus the Verify finding count,
 * the amber doc-level chip (findings no section border can carry — ADR-202 Stage D) and the
 * "declare before use" undeclared chip. Findings are loud and clickable, never gates
 * (ADR-151/ADR-202 advisory posture — see App.tsx's module doc). Pure and prop-driven.
 */

import { promptMetrics } from '../prompt-metrics';

export interface StatusBarProps {
  diagnosticsCount: number;
  nodeCount: number;
  edgeCount: number;
  /** Current authored prompt source. */
  text: string;
  /** `null` until a Verify run has happened for the current document — then the finding count. */
  verificationFindingsCount: number | null;
  /** Count from `undeclaredVariables()` against the current document — the "declare before use" finding. */
  undeclaredCount: number;
  onOpenUndeclared: () => void;
  /**
   * Findings the current Verify run could pin to NO section node (`attributeFindingsToTree`'s
   * `documentLevel` — ADR-202 Stage D). `0` both when a run is all-attributed and when no run
   * exists, so the chip only renders while there is genuinely something section borders can't show.
   */
  docLevelFindingsCount: number;
  onOpenVerifyDrawer: () => void;
}

export function StatusBar({
  diagnosticsCount,
  nodeCount,
  edgeCount,
  text,
  verificationFindingsCount,
  undeclaredCount,
  onOpenUndeclared,
  docLevelFindingsCount,
  onOpenVerifyDrawer,
}: StatusBarProps): React.JSX.Element {
  const metrics = promptMetrics(text);
  return (
    <footer className="flex shrink-0 flex-wrap items-center justify-between gap-x-4 gap-y-1 border-t border-border bg-card px-4 py-1.5 text-xs text-muted-foreground">
      <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-1">
        <span data-testid="status-diagnostics-count">
          {diagnosticsCount} parse diagnostic{diagnosticsCount === 1 ? '' : 's'}
        </span>
        <span className="hidden sm:inline" data-testid="status-node-count">
          {nodeCount} nodes
        </span>
        <span className="hidden sm:inline" data-testid="status-edge-count">
          {edgeCount} edges
        </span>
        <span data-testid="status-character-count">{metrics.characters.toLocaleString()} characters</span>
        <span className="hidden sm:inline" data-testid="status-byte-count">
          {metrics.bytes.toLocaleString()} UTF-8 bytes
        </span>
        <span
          data-testid="status-estimated-token-count"
          title="Estimate only: roughly four UTF-8 bytes per token; actual usage depends on the selected provider and model."
        >
          ≈{metrics.estimatedTokens.toLocaleString()} tokens
        </span>
        {verificationFindingsCount !== null && (
          <span data-testid="status-verification-count">
            {verificationFindingsCount} finding{verificationFindingsCount === 1 ? '' : 's'}
          </span>
        )}
        {/* Doc-level findings have no section border to live on — this amber chip is their only surface;
            clicking it opens the Verify drawer where the full findings list (including these) renders. */}
        {docLevelFindingsCount > 0 && (
          <button
            type="button"
            data-testid="status-doc-level-count"
            onClick={onOpenVerifyDrawer}
            className="rounded-sm px-1.5 py-0.5 font-medium text-amber-700 hover:underline dark:text-amber-300"
          >
            {docLevelFindingsCount} doc-level finding{docLevelFindingsCount === 1 ? '' : 's'}
          </button>
        )}
        {/* Never a gate — a loud, clickable finding only (ADR-151/ADR-202 advisory posture; see App.tsx's module doc). */}
        {undeclaredCount > 0 && (
          <button
            type="button"
            data-testid="status-undeclared-count"
            onClick={onOpenUndeclared}
            className="rounded-sm px-1.5 py-0.5 font-medium text-destructive hover:underline"
          >
            {undeclaredCount} undeclared
          </button>
        )}
      </div>
      <span className="hidden lg:inline">Markdown is source of truth — canvas is a projection.</span>
    </footer>
  );
}
