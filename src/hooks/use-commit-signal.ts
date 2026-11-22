/**
 * The history layer's "a commit just landed" signal (ADR-203): a monotonic token bumped by every
 * fire-and-forget commit writer (`useDocumentEditor`'s `commitToActiveProject`,
 * `useProjectActions`' `resetConfiguration`) once its commit+persist settled, and read by the
 * History drawer effect (`useHistoryDrawer`) so an open drawer reloads with the new head on top.
 * Its own hook because the writers and the reader are separate capabilities — this token is the
 * one thing they share.
 */

import { useState } from 'react';

export function useCommitSignal() {
  const [historyRefreshToken, setHistoryRefreshToken] = useState(0);
  return {
    historyRefreshToken,
    markCommitLanded() {
      setHistoryRefreshToken((token) => token + 1);
    },
  };
}

export type CommitSignal = ReturnType<typeof useCommitSignal>;
