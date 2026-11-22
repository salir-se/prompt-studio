import { useEffect, useRef } from 'react';

/** Options for {@link useHelpHotkey} — keyboard activation of the help panel (ADR-089). */
export interface UseHelpHotkeyOptions {
  /** Key (compared against KeyboardEvent.key) that toggles help. Default '?'. `false` disables the custom key. */
  hotkey?: string | false;
  /** Called when the hotkey fires. */
  onToggle: () => void;
  /** Master enable. Default true. When false, no key toggles help. */
  enabled?: boolean;
}

/** True when the keystroke targets a text-editing element, where '?' is a character, not a command. */
function isTypingTarget(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null;
  if (!element) return false;
  if (element.isContentEditable) return true;
  const tag = element.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}

/**
 * Binds a global `keydown` listener that toggles the help panel. `F1` always
 * toggles (even while typing — it is a command key, not a character); the custom
 * `hotkey` (default '?') toggles only when the user is NOT typing in an editable
 * element, so pressing "?" inside a search box does not pop the panel open.
 * `onToggle` is read through a ref so it stays fresh without re-binding the
 * listener on every render.
 */
export function useHelpHotkey(options: UseHelpHotkeyOptions): void {
  const { hotkey = '?', onToggle, enabled = true } = options;

  const onToggleRef = useRef(onToggle);
  onToggleRef.current = onToggle;

  useEffect(() => {
    if (!enabled) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'F1') {
        // A command key — always toggles, including from within text inputs.
        event.preventDefault();
        onToggleRef.current();
        return;
      }

      if (hotkey !== false && event.key === hotkey && !isTypingTarget(event.target)) {
        event.preventDefault();
        onToggleRef.current();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [hotkey, enabled]);
}
