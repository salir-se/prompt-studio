import { useCallback, useEffect, useRef, useState } from 'react';
import type { WorkingDocument } from './use-document-editor';

interface PromptDraft {
  key: string;
  source: string;
  text: string;
}

/** Unapplied writing belongs to this editor; applied changes use its existing transactional writer. */
export function usePromptDraft({
  document,
  onApply,
  onError,
}: {
  document: WorkingDocument | null;
  onApply: (text: string, message: string) => void;
  onError: (message: string | null) => void;
}) {
  const [draft, setDraft] = useState<PromptDraft | null>(null);
  const key = document ? `${document.rootId}@${document.variantSymbol ?? ''}` : null;
  const active = draft?.key === key ? draft : null;
  const text = active?.text ?? document?.text ?? '';
  const dirty = document !== null && text !== document.text;
  const stale = active !== null && document !== null && active.source !== document.text;
  const discard = useCallback(() => setDraft(null), []);

  return {
    key,
    text,
    dirty,
    stale,
    discard,
    change(text: string) {
      if (document && key) setDraft({ key, source: active?.source ?? document.text, text });
    },
    apply() {
      if (!dirty) return;
      if (stale) {
        onError(
          'This prompt changed while you were writing. Copy your draft before discarding it and loading the latest text.',
        );
        return;
      }
      onApply(text, 'edit prompt instructions');
      discard();
    },
  };
}

/** The active writing workspace owns Save even after focus returns from Explorer. */
export function usePromptSaveShortcut(enabled: boolean, command: { stale: boolean; apply: () => void }) {
  const current = useRef(command);
  current.current = command;
  useEffect(() => {
    if (!enabled) return;
    function onKeyDown(event: KeyboardEvent) {
      if (
        event.defaultPrevented ||
        event.isComposing ||
        event.repeat ||
        !(event.ctrlKey || event.metaKey) ||
        event.key.toLowerCase() !== 's'
      )
        return;
      if (
        event.target instanceof Element &&
        event.target.closest('[role="dialog"], [role="menu"], [data-studio-panels]')
      )
        return;
      event.preventDefault();
      if (!current.current.stale) current.current.apply();
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [enabled]);
}
