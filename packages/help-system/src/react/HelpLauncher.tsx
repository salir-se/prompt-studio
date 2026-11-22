/**
 * The floating "?" help launcher button (FAB) — the always-on entry point that
 * toggles the in-app help panel open and closed (ADR-089). Anchored to the
 * bottom-left corner of the viewport, it shows a "?" glyph while the panel is
 * closed and a "×" glyph while it is open, so the single button both opens and
 * dismisses the panel.
 *
 * Read-only / presentational: it holds NO internal state, reads NO context and
 * fetches NO data — it is purely a function of its props. No `@prompt-studio/ui` /
 * Radix / lucide — plain HTML + theme CSS vars, mirroring `FaqVideoPreview`.
 */

export interface HelpLauncherProps {
  /** Toggle the help panel open/closed. */
  onClick: () => void;
  /** Whether the help panel is currently open (drives aria-expanded + the icon). */
  isOpen: boolean;
  /** Accessible label / tooltip. Default 'Help'. */
  label?: string;
}

// Floats above app chrome but BELOW the help panel, which sits above this value.
const LAUNCHER_Z_INDEX = 2147482000;

export function HelpLauncher({ onClick, isOpen, label = 'Help' }: HelpLauncherProps): React.JSX.Element {
  return (
    <button
      type="button"
      data-help-launcher
      onClick={onClick}
      aria-label={label}
      aria-haspopup="dialog"
      aria-expanded={isOpen}
      title={label}
      style={{
        position: 'fixed',
        left: 16,
        bottom: 'var(--help-launcher-bottom, 16px)',
        zIndex: LAUNCHER_Z_INDEX,
        width: 48,
        height: 48,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 0,
        borderRadius: '50%',
        border: '1px solid var(--border, #d4d4d8)',
        background: 'var(--primary, #2563eb)',
        color: 'var(--primary-foreground, #fff)',
        boxShadow: '0 4px 14px rgba(0,0,0,0.25)',
        cursor: 'pointer',
        font: '22px/1 system-ui, sans-serif',
      }}
    >
      {/* Decorative glyph — the accessible name comes from `aria-label`. */}
      <span aria-hidden="true">{isOpen ? '×' : '?'}</span>
    </button>
  );
}
