/** One open drawer, with a shared guard for leaving unsubmitted form edits. */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useMediaQuery } from './use-media-query';

export type PanelName =
  'design' | 'final-prompt' | 'tools' | 'variables' | 'verify' | 'history' | 'help' | 'prompts' | 'run' | 'evaluate';

export function usePanelState(
  documentDraft?: { dirty: boolean; discard: () => void },
  referenceDraft?: { dirty: boolean; discard: () => void },
) {
  const drafts = useRef({ document: documentDraft, reference: referenceDraft });
  const hasDraft = !!(documentDraft?.dirty || referenceDraft?.dirty);
  drafts.current = { document: documentDraft, reference: referenceDraft };
  const [retainedPanel, setActivePanel] = useState<PanelName | null>(null);
  const [evaluationHidden, setEvaluationHidden] = useState(false);
  const activePanel = retainedPanel === 'evaluate' && evaluationHidden ? null : retainedPanel;
  const query = activePanel === 'verify' || activePanel === 'run' ? '(max-width: 1279px)' : '(max-width: 767px)';
  const covered = useMediaQuery(query);
  const [dirty, setDirty] = useState(false);
  const dirtyRef = useRef(false);
  const onDirtyChange = useCallback((value: boolean) => {
    dirtyRef.current = value;
    setDirty(value);
  }, []);
  const guard = useCallback(
    (keepWriting: boolean): boolean => {
      if (
        !keepWriting &&
        drafts.current.document?.dirty &&
        !window.confirm('Discard unapplied prompt changes? Choose Cancel to keep writing.')
      )
        return false;
      if (
        drafts.current.reference?.dirty &&
        !window.confirm('Discard unsaved referenced-file changes? Choose Cancel to keep editing.')
      )
        return false;
      if (dirtyRef.current && !window.confirm('Discard unsaved changes in this panel? Choose Cancel to keep editing.'))
        return false;
      if (!keepWriting) drafts.current.document?.discard();
      drafts.current.reference?.discard();
      onDirtyChange(false);
      return true;
    },
    [onDirtyChange],
  );
  const confirmDiscard = useCallback(() => {
    const discardEvaluation = retainedPanel === 'evaluate' && dirtyRef.current;
    if (!guard(false)) return false;
    if (discardEvaluation) setActivePanel(null);
    return true;
  }, [guard, retainedPanel]);
  const dismissPanel = useCallback((): boolean => {
    if (!guard(activePanel === 'run' || activePanel === 'evaluate')) return false;
    setActivePanel(null);
    return true;
  }, [guard, activePanel]);
  const closePanel = useCallback((): boolean => {
    if (!guard(false)) return false;
    setActivePanel(null);
    return true;
  }, [guard]);
  const closePanelKeepingWriting = useCallback((): boolean => {
    if (!guard(true)) return false;
    setActivePanel(null);
    return true;
  }, [guard]);
  useEffect(() => {
    if (!activePanel) return;
    const opener = document.activeElement as HTMLElement | null;
    document.querySelector<HTMLElement>('[data-studio-panels] button:not(:disabled)')?.focus();
    function onKeyDown(event: KeyboardEvent): void {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      if (event.target instanceof Element) {
        const overlay = event.target.closest('[role="dialog"], [role="menu"]');
        if (overlay && !overlay.hasAttribute('data-studio-panels')) return;
      }
      dismissPanel();
    }
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      if (opener?.isConnected) opener.focus();
      // A rapid view shortcut or resize can hide the original opener before the panel closes.
      if (document.activeElement !== opener) {
        const writer = document.querySelector<HTMLTextAreaElement>('textarea[aria-label="Prompt markdown"]');
        if (writer?.getClientRects().length) writer.focus();
        else document.querySelector<HTMLElement>('[data-testid="prompt-graph-canvas"] .react-flow__node')?.focus();
      }
    };
  }, [activePanel, dismissPanel]);
  useEffect(() => {
    if (!dirty && !hasDraft) return;
    function beforeUnload(event: BeforeUnloadEvent): void {
      event.preventDefault();
      event.returnValue = '';
    }
    window.addEventListener('beforeunload', beforeUnload);
    return () => window.removeEventListener('beforeunload', beforeUnload);
  }, [dirty, hasDraft]);
  return {
    activePanel,
    retainedEvaluation: retainedPanel === 'evaluate',
    toggleEvaluations(): boolean {
      if (retainedPanel === 'evaluate') {
        setEvaluationHidden(!evaluationHidden);
        return true;
      }
      if (!guard(true)) return false;
      setEvaluationHidden(false);
      setActivePanel('evaluate');
      return true;
    },
    modal: activePanel !== null && covered,
    onDirtyChange,
    confirmDiscard,
    openPanel(next: PanelName | null): boolean {
      if (next === retainedPanel) {
        setEvaluationHidden(false);
        return true;
      }
      if (!guard(next === 'run' || next === 'evaluate')) return false;
      setEvaluationHidden(false);
      setActivePanel(next);
      return true;
    },
    closePanel,
    closePanelKeepingWriting,
    dismissPanel,
  };
}

export type PanelState = ReturnType<typeof usePanelState>;
