import { useEffect, useRef } from 'react';
import { matchesShortcut, type ShortcutId } from '../shortcuts/shortcuts';

/** Scoped accelerators leave ordinary editing and browser shortcuts with their owners. */
export function useStudioShortcuts(commands: {
  enabled: boolean;
  addExisting?: () => void;
  explorer: () => void;
  changeView: (view: 'write' | 'graph') => boolean;
  verify: () => void;
}) {
  const current = useRef(commands);
  current.current = commands;
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (
        !current.current.enabled ||
        event.defaultPrevented ||
        event.isComposing ||
        !event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        event.shiftKey
      )
        return;
      if (event.target instanceof Element) {
        const overlay = event.target.closest('[role="dialog"], [role="menu"]');
        if (overlay && !overlay.hasAttribute('data-studio-panels')) return;
        const inPanel = event.target.closest('[data-studio-panels]');
        const toggleEvaluations =
          matchesShortcut(event, 'evaluations') && event.target.closest('[data-evaluation-dock]');
        if (inPanel && !toggleEvaluations) return;
      }
      function show(view: 'write' | 'graph') {
        if (!current.current.changeView(view)) return;
        const selector =
          view === 'write'
            ? 'textarea[aria-label="Prompt markdown"]'
            : '[data-testid="prompt-graph-canvas"] .react-flow__node';
        const focusTarget = () => document.querySelector<HTMLElement>(selector)?.focus();
        requestAnimationFrame(() => {
          if (view === 'write') {
            // Focusing the existing automatic tab reveals source without remounting its Undo owner.
            document.querySelector<HTMLElement>('[data-prompt-markdown-tab]')?.focus();
            requestAnimationFrame(focusTarget);
          } else focusTarget();
        });
      }
      function nextReference() {
        const focused = document.activeElement;
        if (!current.current.changeView('graph')) return;
        requestAnimationFrame(() => {
          const files = [
            ...document.querySelectorAll<HTMLElement>('[data-testid="prompt-graph-canvas"] [data-id^="file:"]'),
          ];
          if (files.length > 0) files[(files.indexOf(focused as HTMLElement) + 1) % files.length]?.focus();
        });
      }
      const actions: Partial<Record<ShortcutId, (() => void) | undefined>> = {
        addExisting: current.current.addExisting,
        explorer: current.current.explorer,
        write: () => show('write'),
        graph: () => show('graph'),
        design: () => {
          document.querySelector<HTMLButtonElement>('button[aria-keyshortcuts="Alt+3"]')?.click();
          requestAnimationFrame(() =>
            document.querySelector<HTMLElement>('[data-studio-panels] [data-workflow-picker]')?.focus(),
          );
        },
        evaluations: () => document.querySelector<HTMLButtonElement>('button[aria-keyshortcuts="Alt+5"]')?.click(),
        run: () => document.querySelector<HTMLButtonElement>('button[aria-keyshortcuts="Alt+4"]')?.click(),
        reference: nextReference,
        verify: current.current.verify,
      };
      const id = (Object.keys(actions) as ShortcutId[]).find((id) => matchesShortcut(event, id));
      const action = id && actions[id];
      if (action) {
        event.preventDefault();
        action();
      }
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);
}
