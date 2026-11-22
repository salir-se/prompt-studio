// Reserve layout space so feedback cannot cover editing actions. State belongs to useBanners.

export interface AppBannersProps {
  errorMessage: string | null;
  noticeMessage: string | null;
  degradedReason: string | null;
  onDismissDegraded: () => void;
  onDismissNotice?: () => void;
  onDismissError?: () => void;
}

export function AppBanners({
  errorMessage,
  noticeMessage,
  degradedReason,
  onDismissDegraded,
  onDismissNotice,
  onDismissError,
}: AppBannersProps) {
  if (!errorMessage && !noticeMessage && !degradedReason) return null;
  return (
    <section aria-label="Workspace feedback" className="studio-feedback shrink-0 border-t border-border bg-card">
      {errorMessage && (
        <div
          role="alert"
          data-testid="edit-error-banner"
          className="flex items-center justify-between gap-4 px-4 py-2 text-sm text-destructive"
        >
          <span>{errorMessage}</span>
          {onDismissError && (
            <button
              type="button"
              onClick={onDismissError}
              className="shrink-0 rounded px-2 py-1 text-xs hover:bg-muted"
            >
              Dismiss error
            </button>
          )}
        </div>
      )}

      {degradedReason && (
        <div
          role="status"
          data-testid="history-degraded-banner"
          className="flex items-center justify-between gap-4 px-4 py-2 text-sm text-amber-700 dark:text-amber-300"
        >
          <span>History running in fallback mode: {degradedReason}</span>
          <button
            type="button"
            aria-label="Dismiss history fallback notice"
            onClick={onDismissDegraded}
            className="rounded-md px-2 py-0.5 text-xs font-medium hover:bg-amber-500/20"
          >
            Dismiss
          </button>
        </div>
      )}

      {noticeMessage && (
        <div
          role="status"
          data-testid="import-success-banner"
          className="flex items-center justify-between gap-4 px-4 py-2 text-xs text-muted-foreground"
        >
          <span>{noticeMessage}</span>
          {onDismissNotice && (
            <button
              type="button"
              aria-label="Dismiss notification"
              onClick={onDismissNotice}
              className="shrink-0 rounded px-2 py-1 text-xs hover:bg-muted"
            >
              Dismiss
            </button>
          )}
        </div>
      )}
    </section>
  );
}
