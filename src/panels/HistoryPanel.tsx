import { TimelineScrollRegion } from '@prompt-studio/ui/timeline-scroll-region';
import { useEffect } from 'react';
import { CloseButton } from '../components/CloseButton';
import type { HistoryCommitRef } from '../vcs/history-provider';

/**
 * Top-bar "History" drawer (ADR-203 Stage C2) — the active project's committed history for the
 * loaded constant root, newest-first, with per-commit Restore. Pure and prop-driven like the other
 * panels: `App.tsx` owns the provider, loads `provider.history(projectId, rootKey)` into
 * `commits`, and funnels `onRestore` through its transactional `replaceDocumentText` write path —
 * this component never imports a provider. `commits` is expected in the provider's contract order
 * (newest-first — `history()`'s doc), so index 0 IS the current committed head: its Restore is
 * disabled because restoring the current text would only append a no-op commit.
 *
 * Timestamps render as absolute `YYYY-MM-DD HH:mm` (local time) — deliberately no live-ticking
 * "3 minutes ago" so the rendering is deterministic for tests and stable on screen.
 */

/** Formats a commit's epoch-ms timestamp as absolute local-time `YYYY-MM-DD HH:mm`. */
export function formatCommitTimestamp(timestampMs: number): string {
  const date = new Date(timestampMs);
  const pad = (value: number): string => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(
    date.getMinutes(),
  )}`;
}

/** First 7 characters of a commit id — the short id shown in rows and echoed in restore commit messages. */
function shortIdOf(commitId: string): string {
  return commitId.slice(0, 7);
}

export interface HistoryPanelProps {
  /** Display title of the root whose history is shown (drawer heading). */
  rootTitle: string;
  /** The active project's commits for this root, NEWEST-FIRST (the provider's `history()` order). */
  commits: readonly HistoryCommitRef[];
  /** True while `App.tsx` is (re)loading the list — shows a loading note instead of the empty state. */
  busy: boolean;
  /** Restore this commit's text — receives the FULL commit id (`readTextAt`'s `commitId`). */
  onRestore: (commitId: string) => void;
  /** "Reset this prompt to starting text" (ADR-235) — an append-only commit, like restore. */
  onResetToShipped: () => void;
  onClose: () => void;
  error?: string | null;
  onRetry?: () => void;
}

/** Top-bar "History" drawer. */
export function HistoryPanel({
  rootTitle,
  commits,
  busy,
  onRestore,
  onResetToShipped,
  onClose,
  error,
  onRetry,
}: HistoryPanelProps): React.JSX.Element {
  // Escape closes — kept in the panel itself so the close contract holds even standalone (pure
  // tests); when mounted by `App.tsx` its central `activePanel` Escape handler fires too, and both
  // funnel into the same idempotent close.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  return (
    <aside
      aria-label="History"
      data-testid="history-drawer"
      className="fixed inset-y-0 right-0 z-40 flex w-[480px] max-w-full flex-col border-l border-border bg-card shadow-xl"
    >
      <header className="flex shrink-0 items-center justify-between gap-2 border-b border-border px-4 py-2">
        <h2 className="min-w-0 truncate text-sm font-semibold">History — {rootTitle}</h2>
        <div className="flex shrink-0 items-center gap-1">
          <CloseButton onClick={onClose} />
        </div>
      </header>
      {error && (
        <div className="space-y-2 border-b border-destructive/30 bg-destructive/5 px-4 py-3">
          <p role="alert" className="text-xs leading-5 text-destructive">
            {error}
          </p>
          {onRetry && (
            <button
              type="button"
              disabled={busy}
              onClick={onRetry}
              className="rounded-md border border-border bg-background px-3 py-1 text-xs disabled:opacity-50"
            >
              Retry history
            </button>
          )}
        </div>
      )}
      <div className="space-y-2 border-b border-border bg-muted/20 px-4 py-3">
        <p className="text-xs font-medium">History for this prompt only</p>
        <p className="text-xs leading-5 text-muted-foreground">
          Restore replaces “{rootTitle}” with an earlier revision and creates a new commit. Other prompts and previous
          history stay intact. Project checkpoints are in Project → Versions.
        </p>
      </div>
      <TimelineScrollRegion className="min-h-0 flex-1" viewportClassName="p-3">
        {busy && (
          <p data-testid="history-loading" className="p-2 text-xs text-muted-foreground">
            Loading history…
          </p>
        )}
        {!busy && !error && commits.length === 0 && (
          <p data-testid="history-empty" className="p-2 text-xs text-muted-foreground">
            No history for this section root yet.
          </p>
        )}
        {commits.length > 0 && (
          <ul aria-label="Commit list" className="flex flex-col gap-2">
            {commits.map((commit, index) => {
              const shortId = shortIdOf(commit.id);
              const isCurrent = index === 0;
              return (
                <li
                  key={commit.id}
                  data-testid="history-commit-row"
                  className="flex flex-col gap-1.5 rounded-lg border border-border bg-background p-2.5 text-xs"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="min-w-0 truncate font-medium text-foreground" title={commit.message}>
                      {commit.message}
                    </span>
                    <div className="flex shrink-0 items-center gap-2">
                      {isCurrent && <span className="rounded-full bg-muted px-2 py-0.5 text-[10px]">Current</span>}
                      <span className="font-mono text-muted-foreground">{shortId}</span>
                    </div>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <span data-testid="history-commit-timestamp" className="text-muted-foreground">
                      {formatCommitTimestamp(commit.timestampMs)}
                    </span>
                    <button
                      type="button"
                      aria-label={`Restore ${shortId}`}
                      disabled={isCurrent}
                      title={
                        isCurrent
                          ? 'Already the current text'
                          : `Replace only ${rootTitle} with revision ${shortId}; creates a new commit`
                      }
                      onClick={() => onRestore(commit.id)}
                      className="rounded-md border border-border px-2 py-0.5 text-xs hover:bg-muted disabled:pointer-events-none disabled:opacity-50"
                    >
                      Restore
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </TimelineScrollRegion>
      <footer className="shrink-0 space-y-2 border-t border-border bg-muted/20 px-4 py-3">
        <p className="text-xs text-muted-foreground">Return this prompt to its starting text. History is preserved.</p>
        <button
          type="button"
          aria-label="Reset this prompt to starting text"
          title="Restore the starting text for this prompt in a new commit"
          onClick={onResetToShipped}
          className="rounded-md border border-border px-2 py-1 text-xs hover:bg-muted"
        >
          Reset to starting text
        </button>
      </footer>
    </aside>
  );
}
