/**
 * The History drawer's contents (ADR-203 Stage C2): the active project's commit list for the
 * loaded root, loaded while the drawer is open and reloaded whenever the document, the project, or
 * the commit-landed signal changes. Extracted verbatim from App.tsx; restore/reset actions live
 * with the document editor (`restoreCommit`/`resetToShipped`).
 */

import { useEffect, useState } from 'react';
import type { HistoryCommitRef } from '../vcs/history-provider';
import { providerKeyFor } from '../vcs/provider-keys';
import type { Banners } from './use-banners';
import type { CommitSignal } from './use-commit-signal';
import type { DocumentEditor } from './use-document-editor';
import type { HistoryBoot } from './use-history-boot';
import type { PanelState } from './use-panel-state';

export function useHistoryDrawer({
  boot,
  editor,
  panels,
  signal,
  banners,
}: {
  boot: HistoryBoot;
  editor: DocumentEditor;
  panels: PanelState;
  signal: CommitSignal;
  banners: Banners;
}) {
  const { doc } = editor;
  // The stable `useState` setter off the banners object (the object itself is fresh each render,
  // so it must NOT sit in the effect deps below).
  const { setErrorMessage } = banners;
  // History drawer contents: the active project's commits for the loaded constant root, plus a busy
  // flag while (re)loading. Reloaded by the effect below; the signal's token bumps every time a
  // fire-and-forget commit LANDS so an open drawer refreshes with the new head on top.
  const [historyCommits, setHistoryCommits] = useState<readonly HistoryCommitRef[]>([]);
  const [historyBusy, setHistoryBusy] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);

  // History drawer contents (ADR-203): loaded when the drawer is open and reloaded whenever the
  // document or project changes — and, via `historyRefreshToken`, after every fire-and-forget
  // commit LANDS — so the newest commit (including a just-created `restore <shortId>` one) always
  // tops the list and its row disables as the current text. Failures land in the error banner.
  useEffect(() => {
    // Pure re-run trigger — bumped by the commit writers once their commit+persist settled.
    void signal.historyRefreshToken;
    void reloadToken;
    if (panels.activePanel !== 'history' || !boot.history || !doc) return;
    const { provider, activeProjectId } = boot.history;
    let cancelled = false;
    setHistoryBusy(true);
    provider
      .history(activeProjectId, providerKeyFor(doc.rootId, doc.variantSymbol))
      .then((commits) => {
        if (!cancelled) setHistoryCommits(commits);
      })
      .catch((error) => {
        if (!cancelled) {
          setErrorMessage(`Could not load history: ${error instanceof Error ? error.message : String(error)}`);
        }
      })
      .finally(() => {
        if (!cancelled) setHistoryBusy(false);
      });
    return () => {
      cancelled = true;
    };
  }, [panels.activePanel, boot.history, doc, signal.historyRefreshToken, reloadToken, setErrorMessage]);

  /** Opens the History drawer, dropping the previous root/project's rows so they never flash. */
  function openHistory(): void {
    setHistoryCommits([]);
    setErrorMessage(null);
    setReloadToken((token) => token + 1);
    panels.openPanel('history');
  }

  return { commits: historyCommits, busy: historyBusy, openHistory };
}

export type HistoryDrawer = ReturnType<typeof useHistoryDrawer>;
